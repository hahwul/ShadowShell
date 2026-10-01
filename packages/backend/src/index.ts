import { spawn, type ChildProcess } from "child_process";
import { homedir, platform, tmpdir } from "os";
import { mkdirSync } from "fs";
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
  splitUtf8Tail,
  writeFileAtomic,
} from "./utils";

// --- Embedded Python PTY relay (TCP mode, no WebSocket) ---

const RELAY_SCRIPT = `#!/usr/bin/env python3
"""ShadowShell PTY relay over raw TCP."""
import sys, os, pty, select, signal, struct, socket, fcntl, termios, json, traceback, secrets, hmac, time

SHELL = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SHELL", "/bin/zsh")
CWD = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("HOME", "/")
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "relay.log")
LOG_CAP = 1024 * 1024
ACCEPT_TIMEOUT = 30
AUTH_TIMEOUT = 1

def log(msg):
    try:
        with open(LOG, "a") as f:
            f.write(f"[{os.getpid()}] {msg}\\n")
    except:
        pass

child_pid = None
master_fd = None

def create_pty():
    global child_pid, master_fd
    master_fd, slave_fd = pty.openpty()
    child_pid = os.fork()
    if child_pid == 0:
        # Never let an exception escape the child: it would unwind into the
        # parent's code paths. Report on the PTY (the user sees it) and exit.
        try:
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)
            # Python ignores SIGPIPE/SIGXFSZ and ignored dispositions survive
            # exec; restore defaults so pipelines like "seq 1e9 | head" behave.
            for sig in (signal.SIGPIPE, signal.SIGXFSZ, signal.SIGINT, signal.SIGTERM):
                signal.signal(sig, signal.SIG_DFL)
            env = os.environ.copy()
            env["TERM"] = "xterm-256color"
            env["COLORTERM"] = "truecolor"
            env["LANG"] = env.get("LANG", "en_US.UTF-8")
            try:
                os.chdir(CWD)
            except OSError as e:
                fallback = env.get("HOME") or "/"
                os.write(2, f"[ShadowShell] cannot cd to {CWD}: {e.strerror}; using {fallback}\\r\\n".encode())
                os.chdir(fallback)
            os.execvpe(SHELL, [SHELL, "-i", "-l"], env)
        except BaseException:
            try:
                msg = "[ShadowShell] failed to start shell:\\n" + traceback.format_exc()
                os.write(2, msg.replace("\\n", "\\r\\n").encode())
            except BaseException:
                pass
        os._exit(127)
    os.close(slave_fd)
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

def set_pty_size(fd, cols, rows):
    s = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, s)

def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError
        buf += chunk
    return buf

def authenticate(conn, token):
    # The first frame must be {"type":"auth","token":<token>}. The token is
    # only ever written to our stdout pipe, which only the backend can read,
    # so other local processes racing to connect cannot obtain the shell.
    try:
        conn.settimeout(AUTH_TIMEOUT)
        msg_len = struct.unpack(">I", recv_exact(conn, 4))[0]
        if msg_len > 4096:
            return False
        msg = json.loads(recv_exact(conn, msg_len))
        if not isinstance(msg, dict) or msg.get("type") != "auth":
            return False
        supplied = msg.get("token")
        return isinstance(supplied, str) and hmac.compare_digest(supplied.encode(), token.encode())
    except Exception:
        return False

def accept_client(srv, token):
    deadline = time.monotonic() + ACCEPT_TIMEOUT
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        srv.settimeout(remaining)
        try:
            conn, addr = srv.accept()
        except socket.timeout:
            return None
        if authenticate(conn, token):
            log(f"accepted from {addr}")
            return conn
        log(f"rejected unauthenticated client {addr}")
        try: conn.close()
        except OSError: pass

def drain(conn, out_buf):
    # Best-effort flush of pending output before disconnecting.
    try:
        conn.setblocking(True)
        conn.settimeout(1.0)
        while out_buf:
            sent = conn.send(out_buf)
            if sent <= 0: break
            out_buf = out_buf[sent:]
    except Exception:
        pass

def run():
    global child_pid
    try:
        if os.path.getsize(LOG) > LOG_CAP:
            os.remove(LOG)
    except OSError:
        pass
    log(f"relay starting: shell={SHELL} cwd={CWD}")
    try:
        create_pty()
        log("pty created")
    except Exception:
        log(f"pty error: {traceback.format_exc()}")
        cleanup()
        sys.exit(1)

    # Bind an OS-assigned port so we never collide with other applications.
    token = secrets.token_hex(32)
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        srv.bind(("127.0.0.1", 0))
        srv.listen(4)
        port = srv.getsockname()[1]
        log(f"listening on {port}")
        sys.stdout.write(f"READY:{port}:{token}\\n")
        sys.stdout.flush()
        conn = accept_client(srv, token)
    finally:
        # Only one client per relay.
        try: srv.close()
        except: pass
    if conn is None:
        log("accept timeout")
        cleanup()
        sys.exit(1)

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
                            return
                    except BlockingIOError:
                        pass
                    except (OSError, EOFError):
                        # PTY hung up (Linux reports EIO once the shell exits).
                        drain(conn, out_buf)
                        return

                elif fd == conn:
                    try:
                        chunk = conn.recv(65536)
                        if not chunk:
                            return
                        in_buf += chunk
                        while in_buf:
                            if len(in_buf) < 4:
                                break
                            msg_len = struct.unpack(">I", in_buf[:4])[0]
                            # Guard against absurd lengths (e.g., a corrupted stream).
                            if msg_len > 16 * 1024 * 1024:
                                log(f"oversized frame ({msg_len} bytes); dropping connection")
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
                                    if 0 < cols < 65536 and 0 < rows < 65536:
                                        set_pty_size(master_fd, cols, rows)
                                elif isinstance(msg, dict) and msg.get("type") == "input":
                                    data = msg.get("data", "")
                                    if isinstance(data, str):
                                        pty_buf += data.encode("utf-8", "replace")
                            except (json.JSONDecodeError, UnicodeDecodeError):
                                pty_buf += payload
                    except BlockingIOError:
                        pass
                    except Exception:
                        log(f"client error: {traceback.format_exc()}")
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
                        return
                elif fd == master_fd and pty_buf:
                    try:
                        n = os.write(master_fd, pty_buf)
                        if n > 0:
                            pty_buf = pty_buf[n:]
                    except BlockingIOError:
                        pass
                    except OSError:
                        return

            try:
                pid, status = os.waitpid(child_pid, os.WNOHANG)
            except ChildProcessError:
                child_pid = None
                break
            if pid != 0:
                # Reaped: forget the pid so cleanup() never signals a pid the
                # kernel may already have recycled.
                child_pid = None
                # Flush any remaining PTY output before disconnecting.
                try:
                    while True:
                        data = os.read(master_fd, 65536)
                        if not data: break
                        out_buf += data
                except (OSError, BlockingIOError):
                    pass
                drain(conn, out_buf)
                break
    except Exception:
        log(f"loop error: {traceback.format_exc()}")
    finally:
        try:
            conn.close()
        except:
            pass
        cleanup()

def reap(pid):
    # Closing the master hangs up the shell, but interactive shells ignore
    # SIGTERM and a job may ignore SIGHUP. Never block forever in waitpid:
    # give the child a moment to exit, then SIGKILL it.
    for sig in (signal.SIGHUP, signal.SIGTERM):
        try:
            os.kill(pid, sig)
        except OSError:
            pass
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            return
        if done:
            return
        time.sleep(0.02)
    try:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    except OSError:
        pass

def cleanup():
    global child_pid, master_fd
    fd, master_fd = master_fd, None
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass
    pid, child_pid = child_pid, None
    if pid is not None:
        reap(pid)

def handle_signal(sig, frame):
    cleanup()
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGHUP, handle_signal)

if __name__ == "__main__":
    run()
`;

// --- Types ---

interface TerminalSession {
  id: string;
  process: ChildProcess;
  socket: Socket | null;
  presetName: string;
  cwd: string;
  isTerminating: boolean;
  // A TCP connect has been initiated (READY was seen).
  connected: boolean;
  // The relay connection is gone for good (closed or errored).
  closed: boolean;
  exited: boolean;
  // Latest size requested by the frontend; sent as soon as the socket opens.
  size: { cols: number; rows: number };
  // Input typed before the relay connection was established.
  pendingInput: string[];
  pendingChars: number;
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
let pythonPath: string | null = null;
const SETTINGS_DIR = join(homedir() || "/", ".config", "shadowshell");
const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");
// The relay prints its OS-assigned port and a one-time auth token.
const READY_RE = /READY:(\d+):([0-9a-f]+)\r?\n/;
const MAX_PENDING_INPUT = 1024 * 1024; // UTF-16 code units
const RELAY_EXIT_GRACE_MS = 2000;

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
  // Written once per backend lifetime (so plugin updates are picked up on
  // reload) and atomically, so a relay that is still starting never reads a
  // truncated script. Prefer the user's private config directory over a shared
  // temp directory another local user could tamper with; fall back to the temp
  // directory when HOME is missing or read-only so terminals still work.
  if (relayScriptPath && pathExists(relayScriptPath)) return relayScriptPath;
  let lastError: unknown;
  for (const dir of [SETTINGS_DIR, join(tmpdir(), "shadowshell")]) {
    try {
      if (!pathExists(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      const scriptPath = join(dir, "relay.py");
      writeFileAtomic(scriptPath, RELAY_SCRIPT);
      relayScriptPath = scriptPath;
      return scriptPath;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
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
  const scriptPath = ensureRelayScript();

  const proc = spawn(findPython3Local(), [scriptPath, shell, workingDir]);

  const session: TerminalSession = {
    id,
    process: proc,
    socket: null,
    presetName: presetName || "",
    cwd: workingDir,
    isTerminating: false,
    connected: false,
    closed: false,
    exited: false,
    size: { cols: 80, rows: 24 },
    pendingInput: [],
    pendingChars: 0,
  };

  terminals.set(id, session);

  let stdoutBuf = "";
  if (proc.stdout) {
    proc.stdout.on("data", (data: Buffer) => {
      if (session.connected || session.isTerminating) return;
      stdoutBuf += data.toString();
      const ready = READY_RE.exec(stdoutBuf);
      if (!ready) return;
      stdoutBuf = "";
      session.connected = true;
      const port = Number(ready[1]);
      const token = ready[2]!;

      // Relay is ready, connect via TCP
      const sock = connect(port, "127.0.0.1", () => {
        if (session.isTerminating) {
          // Socket connected after termination, just destroy it
          sock.destroy();
          return;
        }
        session.socket = sock;
        sdk.console.log(`[relay] connected to port ${port}`);

        // Authenticate first; the relay drops connections that don't.
        frameSend(sock, { type: "auth", token });
        frameSend(sock, { type: "resize", ...session.size });
        for (const data of session.pendingInput) {
          frameSend(sock, { type: "input", data });
        }
        session.pendingInput = [];
        session.pendingChars = 0;

        // Send preset command if any
        if (command) {
          setTimeout(() => {
            if (!session.isTerminating && session.socket) {
              frameSend(session.socket, { type: "input", data: command + "\n" });
            }
          }, 500);
        }
      });

      // Carry incomplete UTF-8 sequences across chunks; decoding each chunk
      // on its own corrupts multi-byte characters split by TCP.
      let carry: Buffer | null = null;
      sock.on("data", (chunk: Buffer) => {
        const [complete, rest] = splitUtf8Tail(carry ? Buffer.concat([carry, chunk]) : chunk);
        carry = rest.length ? rest : null;
        if (complete.length === 0) return;
        // Raw PTY output -> forward to frontend
        sdk.api.send("terminalOutput", {
          terminalId: id,
          data: complete.toString("utf-8"),
        });
      });

      const onDisconnect = () => {
        if (carry) {
          // Emit a dangling partial sequence (as U+FFFD) rather than drop it.
          sdk.api.send("terminalOutput", { terminalId: id, data: carry.toString("utf-8") });
          carry = null;
        }
        session.socket = null;
        session.closed = true;
      };
      const killRelay = () => {
        if (!session.exited) {
          try { proc.kill(); } catch { /* ignore */ }
        }
      };

      sock.on("close", () => {
        onDisconnect();
        // Normally the relay closed the socket because the shell exited and
        // is about to exit itself; only stop it if it lingers.
        setTimeout(killRelay, RELAY_EXIT_GRACE_MS);
      });

      sock.on("error", (err) => {
        sdk.console.log(`[relay] socket error: ${err.message}`);
        onDisconnect();
        // Without a connection the relay is useless; stop it so the exit is
        // reported now instead of after its 30s accept timeout.
        killRelay();
      });
    });
  }

  if (proc.stderr) {
    proc.stderr.on("data", (data: Buffer) => {
      sdk.console.log(`[relay stderr] ${data.toString()}`);
    });
  }

  // "exit" may or may not follow "error" (e.g. a missing python binary only
  // emits "error"), so report the exit exactly once from either path.
  const finish = (code: number) => {
    if (session.exited) return;
    session.exited = true;
    session.closed = true;
    if (terminals.get(id) === session) terminals.delete(id);
    sdk.api.send("terminalExit", { terminalId: id, code });
  };

  proc.on("exit", (code) => finish(code ?? -1));

  proc.on("error", (err) => {
    sdk.console.log(`[relay error] ${err.message}`);
    finish(-1);
  });

  sdk.console.log(`Terminal ${id} starting`);
  return id;
}

function writeTerminal(
  sdk: SDK<API, BackendEvents>,
  terminalId: string,
  data: string
): boolean {
  const session = terminals.get(terminalId);
  if (!session || session.isTerminating || session.closed) return false;
  if (session.socket) return frameSend(session.socket, { type: "input", data });
  // Not connected yet: queue so keystrokes typed while the relay starts are
  // not silently dropped.
  if (session.pendingChars + data.length > MAX_PENDING_INPUT) return false;
  session.pendingInput.push(data);
  session.pendingChars += data.length;
  return true;
}

function resizeTerminal(
  sdk: SDK<API, BackendEvents>,
  terminalId: string,
  cols: number,
  rows: number
): boolean {
  const session = terminals.get(terminalId);
  if (!session || session.isTerminating || session.closed) return false;
  const c = Math.floor(cols);
  const r = Math.floor(rows);
  if (!Number.isFinite(c) || !Number.isFinite(r) || c < 1 || r < 1) return false;
  // Remember the size even before the socket is up; otherwise a resize that
  // races the relay startup is lost and the PTY stays at 80x24.
  session.size = { cols: c, rows: r };
  if (!session.socket) return true;
  return frameSend(session.socket, { type: "resize", ...session.size });
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
