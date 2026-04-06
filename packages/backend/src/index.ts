import { spawn, type ChildProcess } from "child_process";
import { homedir, platform, tmpdir } from "os";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import { connect, type Socket } from "net";
import { SDK, DefineAPI, DefineEvents } from "caido:plugin";

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

    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    conn.setblocking(False)
    set_pty_size(master_fd, 80, 24)
    log("main loop starting")

    buf = b""
    try:
        while True:
            rlist = [master_fd, conn]
            try:
                readable, _, _ = select.select(rlist, [], [], 0.05)
            except (select.error, ValueError):
                break

            for fd in readable:
                if fd == master_fd:
                    try:
                        data = os.read(master_fd, 65536)
                        if not data:
                            raise EOFError
                        conn.sendall(data)
                    except (OSError, EOFError):
                        cleanup()
                        return

                elif fd == conn:
                    try:
                        chunk = conn.recv(65536)
                        if not chunk:
                            cleanup()
                            return
                        buf += chunk
                        while buf:
                            if len(buf) < 4:
                                break
                            msg_len = struct.unpack(">I", buf[:4])[0]
                            if len(buf) < 4 + msg_len:
                                break
                            payload = buf[4:4+msg_len]
                            buf = buf[4+msg_len:]
                            try:
                                msg = json.loads(payload)
                                if msg.get("type") == "resize":
                                    set_pty_size(master_fd, msg.get("cols", 80), msg.get("rows", 24))
                                elif msg.get("type") == "input":
                                    os.write(master_fd, msg["data"].encode("utf-8"))
                            except (json.JSONDecodeError, KeyError, UnicodeDecodeError):
                                os.write(master_fd, payload)
                    except BlockingIOError:
                        pass
                    except Exception:
                        cleanup()
                        return

            try:
                pid, status = os.waitpid(child_pid, os.WNOHANG)
                if pid != 0:
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
let nextPort = 18500;
const MAX_PORT = 32767;
let pythonPath: string | null = null;
const SETTINGS_DIR = join(homedir() || "/", ".config", "shadowshell");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");

function loadSettings(): { pythonPath?: string } {
  try {
    const data = readFileSync(SETTINGS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveSettings(settings: Record<string, unknown>): void {
  if (!pathExists(SETTINGS_DIR)) mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function findPython3(): string {
  if (pythonPath) return pythonPath;
  const saved = loadSettings().pythonPath;
  if (saved && pathExists(saved)) { pythonPath = saved; return saved; }
  for (const p of ["/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3"]) {
    if (pathExists(p)) { pythonPath = p; return p; }
  }
  return "/usr/bin/python3";
}

function getDefaultShell(): string {
  if (platform() === "win32") return "powershell.exe";
  for (const s of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (pathExists(s)) return s;
  }
  return "/bin/sh";
}

function generateId(): string {
  return `term-${++terminalCounter}-${Date.now()}`;
}

function pathExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
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

// --- Framed message helpers (4-byte length prefix) ---

function frameSend(sock: Socket, obj: Record<string, unknown>): boolean {
  try {
    const payload = Buffer.from(JSON.stringify(obj), "utf-8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    sock.write(Buffer.concat([header, payload]));
    return true;
  } catch {
    return false;
  }
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
  if (nextPort > MAX_PORT) nextPort = 18500;
  const port = nextPort++;
  const scriptPath = ensureRelayScript();

  const proc = spawn(findPython3(), [scriptPath, String(port), shell, workingDir]);

  const session: TerminalSession = {
    id,
    process: proc,
    socket: null,
    port,
    presetName: presetName || "",
    cwd: workingDir,
    isTerminating: false,
  };

  terminals.set(id, session);

  let stdoutBuf = "";
  if (proc.stdout) {
    proc.stdout.on("data", (data: Buffer) => {
      stdoutBuf += data.toString();
      if (stdoutBuf.includes("READY:")) {
        if (session.isTerminating) return;

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
  if (!session?.socket) return false;
  frameSend(session.socket, { type: "input", data });
  return true;
}

function resizeTerminal(
  sdk: SDK<API, BackendEvents>,
  terminalId: string,
  cols: number,
  rows: number
): boolean {
  const session = terminals.get(terminalId);
  if (!session?.socket) return false;
  frameSend(session.socket, { type: "resize", cols, rows });
  return true;
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
  return findPython3();
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

  sdk.console.log("ShadowShell backend initialized");
}
