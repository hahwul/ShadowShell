import { spawn, type ChildProcess } from "child_process";
import { homedir, platform, tmpdir } from "os";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { connect, type Socket } from "net";
import { SDK, DefineAPI, DefineEvents } from "caido:plugin";
import {
  pathExists,
  isDirectory,
  loadSettings as _loadSettings,
  saveSettings as _saveSettings,
  findPython3 as _findPython3,
  getDefaultShell,
  frameSend,
} from "./utils";

// --- Embedded Python PTY relay (TCP mode, no WebSocket) ---

const RELAY_SCRIPT = `#!/usr/bin/env python3
"""ShadowShell PTY relay over raw TCP."""
import sys, os, pty, select, signal, struct, socket, fcntl, termios, json, traceback

PORT = int(sys.argv[1])
SHELL = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("SHELL", "/bin/zsh")
CWD = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("HOME", "/")
LOG = os.path.join(os.environ.get("TMPDIR", "/tmp"), "shadowshell", f"relay-{PORT}.log")

def log(msg):
    try:
        with open(LOG, "a") as f:
            f.write(msg + "\\n")
    except:
        pass

child_pid = None
master_fd = None

def create_pty():
    global child_pid, master_fd
    master_fd, slave_fd = pty.openpty()
    child_pid = os.fork()
    if child_pid == 0:
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["LANG"] = env.get("LANG", "en_US.UTF-8")
        os.chdir(CWD)
        os.execvpe(SHELL, [SHELL, "-i", "-l"], env)
    os.close(slave_fd)
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

def set_pty_size(fd, cols, rows):
    s = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, s)

def run():
    log(f"relay starting: port={PORT} shell={SHELL} cwd={CWD}")
    try:
        create_pty()
        log("pty created")
    except Exception:
        log(f"pty error: {traceback.format_exc()}")
        sys.exit(1)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", PORT))
    srv.listen(1)
    srv.settimeout(30)
    log(f"listening on {PORT}")
    sys.stdout.write(f"READY:{PORT}\\n")
    sys.stdout.flush()

    try:
        conn, addr = srv.accept()
        log(f"accepted from {addr}")
    except socket.timeout:
        log("accept timeout")
        cleanup()
        sys.exit(1)
    finally:
        # Stop accepting further connections; only one client per relay.
        try: srv.close()
        except: pass

    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    conn.setblocking(False)
    set_pty_size(master_fd, 80, 24)
    log("main loop starting")

    # Inbound: framed messages from client. Outbound: raw PTY bytes to client.
    # PTY write buffer: data the client sent as "input" but we couldn't fully
    # write to the PTY yet because the kernel buffer was full.
    # OUT_CAP bounds the outbound buffer so a stuck/slow client can't grow
    # this relay's memory without limit.
    OUT_CAP = 8 * 1024 * 1024
    in_buf = b""
    out_buf = b""
    pty_buf = b""
    try:
        while True:
            rlist = [master_fd, conn]
            wlist = []
            if out_buf:
                wlist.append(conn)
            if pty_buf:
                wlist.append(master_fd)
            try:
                readable, writable, _ = select.select(rlist, wlist, [], 0.05)
            except (select.error, ValueError):
                break

            for fd in readable:
                if fd == master_fd:
                    try:
                        data = os.read(master_fd, 65536)
                        if not data:
                            raise EOFError
                        out_buf += data
                        if len(out_buf) > OUT_CAP:
                            log(f"out_buf exceeded {OUT_CAP} bytes; dropping client")
                            cleanup()
                            return
                    except BlockingIOError:
                        pass
                    except (OSError, EOFError):
                        cleanup()
                        return

                elif fd == conn:
                    try:
                        chunk = conn.recv(65536)
                        if not chunk:
                            cleanup()
                            return
                        in_buf += chunk
                        while in_buf:
                            if len(in_buf) < 4:
                                break
                            msg_len = struct.unpack(">I", in_buf[:4])[0]
                            # Guard against absurd lengths (e.g., a corrupted stream).
                            if msg_len > 16 * 1024 * 1024:
                                log(f"oversized frame ({msg_len} bytes); dropping connection")
                                cleanup()
                                return
                            if len(in_buf) < 4 + msg_len:
                                break
                            payload = in_buf[4:4+msg_len]
                            in_buf = in_buf[4+msg_len:]
                            try:
                                msg = json.loads(payload)
                                if isinstance(msg, dict) and msg.get("type") == "resize":
                                    try:
                                        cols = int(msg.get("cols", 80))
                                        rows = int(msg.get("rows", 24))
                                    except (TypeError, ValueError):
                                        cols, rows = 80, 24
                                    if cols > 0 and rows > 0:
                                        set_pty_size(master_fd, cols, rows)
                                elif isinstance(msg, dict) and msg.get("type") == "input":
                                    data = msg.get("data", "")
                                    if isinstance(data, str):
                                        pty_buf += data.encode("utf-8")
                            except (json.JSONDecodeError, UnicodeDecodeError):
                                pty_buf += payload
                    except BlockingIOError:
                        pass
                    except Exception:
                        cleanup()
                        return

            for fd in writable:
                if fd == conn and out_buf:
                    try:
                        sent = conn.send(out_buf)
                        if sent > 0:
                            out_buf = out_buf[sent:]
                    except BlockingIOError:
                        pass
                    except Exception:
                        cleanup()
                        return
                elif fd == master_fd and pty_buf:
                    try:
                        n = os.write(master_fd, pty_buf)
                        if n > 0:
                            pty_buf = pty_buf[n:]
                    except BlockingIOError:
                        pass
                    except OSError:
                        cleanup()
                        return

            try:
                pid, status = os.waitpid(child_pid, os.WNOHANG)
                if pid != 0:
                    # Flush any remaining PTY output before disconnecting.
                    try:
                        while True:
                            data = os.read(master_fd, 65536)
                            if not data: break
                            out_buf += data
                    except (OSError, BlockingIOError):
                        pass
                    # Best-effort drain to the client.
                    try:
                        conn.setblocking(True)
                        conn.settimeout(1.0)
                        while out_buf:
                            sent = conn.send(out_buf)
                            if sent <= 0: break
                            out_buf = out_buf[sent:]
                    except Exception:
                        pass
                    break
            except ChildProcessError:
                break
    except Exception:
        log(f"loop error: {traceback.format_exc()}")
    finally:
        try:
            conn.close()
        except:
            pass
        cleanup()

def cleanup():
    global child_pid, master_fd
    if master_fd is not None:
        try:
            os.close(master_fd)
        except OSError:
            pass
        master_fd = None
    if child_pid is not None:
        try:
            os.kill(child_pid, signal.SIGTERM)
            os.waitpid(child_pid, 0)
        except (OSError, ChildProcessError):
            pass
        child_pid = None

def handle_signal(sig, frame):
    cleanup()
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

if __name__ == "__main__":
    run()
`;

// --- Types ---

interface TerminalSession {
  id: string;
  process: ChildProcess;
  socket: Socket | null;
  port: number;
  presetName: string;
  cwd: string;
  isTerminating: boolean;
  connected: boolean;
}

interface TerminalOutputEvent {
  terminalId: string;
  data: string;
}

interface TerminalExitEvent {
  terminalId: string;
  code: number;
}

// --- State ---

const terminals = new Map<string, TerminalSession>();
let terminalCounter = 0;
let relayScriptPath: string | null = null;
const MIN_PORT = 18500;
const MAX_PORT = 32767;
let nextPort = MIN_PORT;
let pythonPath: string | null = null;
const SETTINGS_DIR = join(homedir() || "/", ".config", "shadowshell");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

// Picks the next port in [MIN_PORT, MAX_PORT] that no live session is using,
// advancing the rolling counter. Wraps around on overflow.
function allocatePort(): number {
  const used = new Set<number>();
  for (const s of terminals.values()) used.add(s.port);
  let p = nextPort;
  if (p < MIN_PORT || p > MAX_PORT) p = MIN_PORT;
  const span = MAX_PORT - MIN_PORT + 1;
  for (let i = 0; i < span; i++) {
    if (!used.has(p)) {
      nextPort = p + 1 > MAX_PORT ? MIN_PORT : p + 1;
      return p;
    }
    p = p + 1 > MAX_PORT ? MIN_PORT : p + 1;
  }
  // Every port in range is held by an active session — extremely unlikely.
  // Fall back to the next sequential value; the bind will fail and surface.
  nextPort = p + 1 > MAX_PORT ? MIN_PORT : p + 1;
  return p;
}

function loadSettings(): { pythonPath?: string; defaultDirectory?: string } {
  return _loadSettings(SETTINGS_FILE);
}

function saveSettings(settings: Record<string, unknown>): void {
  _saveSettings(SETTINGS_DIR, SETTINGS_FILE, settings);
}

function findPython3Local(): string {
  if (pythonPath) return pythonPath;
  const result = _findPython3(null, SETTINGS_FILE);
  pythonPath = result;
  return result;
}

function generateId(): string {
  return `term-${++terminalCounter}-${Date.now()}`;
}

function ensureRelayScript(): string {
  // Always rewrite to pick up updates
  const dir = join(tmpdir(), "shadowshell");
  if (!pathExists(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  relayScriptPath = join(dir, "relay.py");
  writeFileSync(relayScriptPath, RELAY_SCRIPT);
  return relayScriptPath;
}

// --- API ---

function createTerminal(
  sdk: SDK<API, BackendEvents>,
  cwd: string,
  command: string,
  presetName: string
): string {
  const id = generateId();
  const shell = getDefaultShell();
  const home = homedir() || "/";
  const workingDir = cwd || home;
  const port = allocatePort();
  const scriptPath = ensureRelayScript();

  const proc = spawn(findPython3Local(), [scriptPath, String(port), shell, workingDir]);

  const session: TerminalSession = {
    id,
    process: proc,
    socket: null,
    port,
    presetName: presetName || "",
    cwd: workingDir,
    isTerminating: false,
    connected: false,
  };

  terminals.set(id, session);

  let stdoutBuf = "";
  if (proc.stdout) {
    proc.stdout.on("data", (data: Buffer) => {
      stdoutBuf += data.toString();
      if (!session.connected && stdoutBuf.includes("READY:")) {
        if (session.isTerminating) return;
        session.connected = true;

        // Relay is ready, connect via TCP
        const sock = connect(port, "127.0.0.1", () => {
          if (session.isTerminating) {
            // Socket connected after termination, just destroy it
            sock.destroy();
            return;
          }
          session.socket = sock;
          sdk.console.log(`[relay] connected to port ${port}`);

          // Send initial resize
          frameSend(sock, { type: "resize", cols: 80, rows: 24 });

          // Send preset command if any
          if (command) {
            setTimeout(() => {
              if (!session.isTerminating) {
                frameSend(sock, { type: "input", data: command + "\n" });
              }
            }, 500);
          }
        });

        sock.on("data", (chunk: Buffer) => {
          // Raw PTY output -> forward to frontend
          sdk.api.send("terminalOutput", {
            terminalId: id,
            data: chunk.toString("utf-8"),
          });
        });

        sock.on("close", () => {
          session.socket = null;
        });

        sock.on("error", (err) => {
          sdk.console.log(`[relay] socket error: ${err.message}`);
          session.socket = null;
        });
      }
    });
  }

  if (proc.stderr) {
    proc.stderr.on("data", (data: Buffer) => {
      sdk.console.log(`[relay stderr] ${data.toString()}`);
    });
  }

  proc.on("exit", (code) => {
    sdk.api.send("terminalExit", { terminalId: id, code: code ?? -1 });
    terminals.delete(id);
  });

  proc.on("error", (err) => {
    sdk.console.log(`[relay error] ${err.message}`);
    terminals.delete(id);
  });

  sdk.console.log(`Terminal ${id} starting on port ${port}`);
  return id;
}

function writeTerminal(
  sdk: SDK<API, BackendEvents>,
  terminalId: string,
  data: string
): boolean {
  const session = terminals.get(terminalId);
  if (!session?.socket || session.isTerminating) return false;
  return frameSend(session.socket, { type: "input", data });
}

function resizeTerminal(
  sdk: SDK<API, BackendEvents>,
  terminalId: string,
  cols: number,
  rows: number
): boolean {
  const session = terminals.get(terminalId);
  if (!session?.socket || session.isTerminating) return false;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return false;
  return frameSend(session.socket, { type: "resize", cols, rows });
}

function destroyTerminal(
  sdk: SDK<API, BackendEvents>,
  terminalId: string
): boolean {
  const session = terminals.get(terminalId);
  if (!session) return false;
  session.isTerminating = true;
  if (session.socket) {
    try { session.socket.destroy(); } catch { /* ignore */ }
  }
  try { session.process.kill(); } catch { /* ignore */ }
  terminals.delete(terminalId);
  sdk.console.log(`Terminal destroyed: ${terminalId}`);
  return true;
}

function destroyAllTerminals(sdk: SDK<API, BackendEvents>): void {
  for (const [, session] of terminals) {
    session.isTerminating = true;
    if (session.socket) {
      try { session.socket.destroy(); } catch { /* ignore */ }
    }
    try { session.process.kill(); } catch { /* ignore */ }
  }
  terminals.clear();
}

function listTerminals(
  sdk: SDK<API, BackendEvents>
): Array<{ id: string; cwd: string; presetName: string }> {
  return Array.from(terminals.values()).map((s) => ({
    id: s.id,
    cwd: s.cwd,
    presetName: s.presetName,
  }));
}

function getShellInfo(sdk: SDK<API, BackendEvents>): {
  defaultShell: string;
  platform: string;
  home: string;
} {
  return {
    defaultShell: getDefaultShell(),
    platform: platform(),
    home: homedir() || "/",
  };
}

function setPythonPath(sdk: SDK<API, BackendEvents>, path: string): boolean {
  if (path && !pathExists(path)) return false;
  const settings = loadSettings();
  if (path) {
    settings.pythonPath = path;
  } else {
    delete settings.pythonPath;
  }
  saveSettings(settings);
  pythonPath = path || null;
  sdk.console.log(`Python path set to: ${path || "(auto-detect)"}`);
  return true;
}

function getPythonPath(sdk: SDK<API, BackendEvents>): string {
  return findPython3Local();
}

function setDefaultDirectory(sdk: SDK<API, BackendEvents>, path: string): boolean {
  if (path && !isDirectory(path)) return false;
  const settings = loadSettings();
  if (path) {
    settings.defaultDirectory = path;
  } else {
    delete settings.defaultDirectory;
  }
  saveSettings(settings);
  sdk.console.log(`Default directory set to: ${path || "(home)"}`);
  return true;
}

function getDefaultDirectory(sdk: SDK<API, BackendEvents>): string {
  const settings = loadSettings();
  return settings.defaultDirectory || "";
}

function validateDirectory(sdk: SDK<API, BackendEvents>, path: string): boolean {
  if (!path) return true;
  return isDirectory(path);
}

// --- Type Definitions ---

export type BackendEvents = DefineEvents<{
  terminalOutput: (event: TerminalOutputEvent) => void;
  terminalExit: (event: TerminalExitEvent) => void;
}>;

export type API = DefineAPI<{
  createTerminal: typeof createTerminal;
  writeTerminal: typeof writeTerminal;
  resizeTerminal: typeof resizeTerminal;
  destroyTerminal: typeof destroyTerminal;
  destroyAllTerminals: typeof destroyAllTerminals;
  listTerminals: typeof listTerminals;
  getShellInfo: typeof getShellInfo;
  setPythonPath: typeof setPythonPath;
  getPythonPath: typeof getPythonPath;
  setDefaultDirectory: typeof setDefaultDirectory;
  getDefaultDirectory: typeof getDefaultDirectory;
  validateDirectory: typeof validateDirectory;
}>;

// --- Init ---

export function init(sdk: SDK<API, BackendEvents>) {
  sdk.api.register("createTerminal", createTerminal);
  sdk.api.register("writeTerminal", writeTerminal);
  sdk.api.register("resizeTerminal", resizeTerminal);
  sdk.api.register("destroyTerminal", destroyTerminal);
  sdk.api.register("destroyAllTerminals", destroyAllTerminals);
  sdk.api.register("listTerminals", listTerminals);
  sdk.api.register("getShellInfo", getShellInfo);
  sdk.api.register("setPythonPath", setPythonPath);
  sdk.api.register("getPythonPath", getPythonPath);
  sdk.api.register("setDefaultDirectory", setDefaultDirectory);
  sdk.api.register("getDefaultDirectory", getDefaultDirectory);
  sdk.api.register("validateDirectory", validateDirectory);

  sdk.console.log("ShadowShell backend initialized");
}
