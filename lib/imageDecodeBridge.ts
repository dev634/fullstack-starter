import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

// The parent side of the image decoder. No code of the application imports sharp
// (tests/runtime-dependencies.test.ts), and `next-server` does not load it through
// its image optimizer either (next.config.ts: `images.unoptimized`): every call
// (`metadata()` included) runs in a child process started from
// scripts/image-decode-child.mjs, and what bounds a task is that this process is
// KILLED when the deadline passes. A native decode cannot be interrupted from JS —
// a progressive JPEG of 3,529 scans (525 KB) is absorbed by one call,
// `jpeg_start_decompress`, a 100-page TIFF of 4,000 tags each spends 28 s in
// `metadata()` (Windows, in process) — so nothing inside the process that runs it can
// bound it; the operating system can. The JS checks of lib/imageFrameCount.ts and
// lib/pngTextChunks.ts remain, as cheap early refusals of the amplifiers already
// known; they bound nothing by themselves.
//
// WHAT THIS IS, AND IS NOT. A bound on DURATION (the kill) and, on Linux, on MEMORY
// (the data-segment limit below). It is NOT a confinement: the child runs as the same
// user as the server, can read /proc/<ppid>/environ (so the server's secrets), write
// in /app (its own script, the chunks of .next), signal its parent and send it invalid
// frames. A code-execution flaw in libvips is, as before, a compromise of the server.
// The environment allowlist below only removes ACCIDENTAL inheritance (NODE_OPTIONS,
// `--inspect`, a secret that would end up in the child's logs). Hardening (read-only
// /app, another uid) is a separate batch (docs/CONVENTIONS.md, open points).
//
// Policy (queue, pixel ceiling, decoded-bytes budget, qualities) stays in
// lib/imageMetadata.ts: this module only knows how to run a task against a child
// and what the two operations of the child look like.

/** One bound for a whole task, in real time (see docs/CONVENTIONS.md for its calibration). */
export const DECODE_DEADLINE_SECONDS = 20;

// Starting the child (process + importing sharp) has its own delay: it is not decode
// time, and a deadline that included it would refuse the first upload after a deploy.
const CHILD_STARTUP_SECONDS = 30;

// The memory bound of the child on Linux: `ulimit -d` (RLIMIT_DATA: heap and private
// anonymous mappings). The kill bounds time, not the peak: a 1-pixel PNG with 40 zTXt
// chunks of 40 MB each took the child to 5.8 GB (Windows) and the container has no
// memory limit, Postgres sharing the host. The heaviest legitimate file at the real
// ceilings (12-bit AVIF at the budget: 710 MB of RSS) passes with room, as do the GIF
// 6000x6600 (608 MB) and the 40 Mpx WebP (424 MB), measured in the production image. A
// bomb that goes past the limit dies on an allocation failure.
// The limit is on VIRTUAL memory (VmData: heap and private anonymous mappings), not on
// the RSS: the same files measure VmData 884 / 721 / 700 MB for RSS 703 / 414 / 604 MB,
// so the real margin is 1,536 / 884 = 1.74, not "twice the RSS".
export const CHILD_DATA_LIMIT_MB = 1536;

/** Which of the application's paths a task belongs to: only used to say what was killed. */
export type DecodeOperation = "strip" | "convert" | "model";

/** The header read by `metadata()`: nothing is decoded. The parent applies its budget to it. */
export type ImageHeader = { format?: string; width?: number; height?: number; channels?: number; depth?: string };

export type EncodeOutput = { format: "jpeg"; quality: number } | { format: "png" | "webp" | "gif" };

/** What a task may ask of the child: two operations, nothing else exists on the other side. */
export type DecodeSession = {
  readHeader: (input: Buffer, limitInputPixels: number) => Promise<ImageHeader>;
  /**
   * Orientation applied, optional resize to a long edge, then `output`; metadata is never carried over.
   * An output beyond `maxOutputBytes` is refused by the child BEFORE it is sent.
   */
  encode: (input: Buffer, limitInputPixels: number, maxLongEdge: number | null, maxOutputBytes: number, output: EncodeOutput) => Promise<Buffer>;
};

/** What goes over the channel (the id is added when it is sent). Kept in step with scripts/image-decode-child.mjs. */
type ChildRequest =
  | { op: "metadata"; input: Buffer; limitInputPixels: number }
  | { op: "encode"; input: Buffer; limitInputPixels: number; maxLongEdge: number | null; maxOutputBytes: number; output: EncodeOutput };

export type BridgeOptions = { deadlineMs?: number; startupMs?: number };

// --- Environment of the child --------------------------------------------------

// The child needs Node and sharp, nothing else. Built from an allowlist (see the
// header for what that does and does not give): DATABASE_URL, AUTH_*, CLOUDINARY_*,
// RESEND_*, ANTHROPIC_*, OPENAI_* are never named, and never copied.
const CHILD_ENV_KEYS: readonly string[] = ["PATH", "NODE_ENV"];
// Windows (development) cannot start a process, or give it a temp directory, without these.
const CHILD_ENV_KEYS_WIN32: readonly string[] = ["SystemRoot", "TEMP", "TMP"];

function nodeEnvOf(value: string | undefined): "development" | "production" | "test" {
  return value === "development" || value === "test" ? value : "production";
}

/**
 * The environment of the decode child: the allowlisted variables of `source` that are
 * set, and nothing else. NODE_ENV is always present (an unknown or missing value reads
 * as "production", the safe default).
 */
export function buildChildEnv(source: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const keys = platform === "win32" ? [...CHILD_ENV_KEYS, ...CHILD_ENV_KEYS_WIN32] : CHILD_ENV_KEYS;
  const lookup = (key: string): string | undefined => {
    // Windows names are case-insensitive (`Path`, `SYSTEMROOT`); a plain object is not.
    const sourceKey = platform === "win32" ? Object.keys(source).find((k) => k.toLowerCase() === key.toLowerCase()) : key;
    return sourceKey === undefined ? undefined : source[sourceKey];
  };
  const env: NodeJS.ProcessEnv = { NODE_ENV: nodeEnvOf(lookup("NODE_ENV")) };
  for (const key of keys) {
    const value = lookup(key);
    if (key !== "NODE_ENV" && value !== undefined) env[key] = value;
  }
  return env;
}

// --- How the child is started ---------------------------------------------------

// Run by /bin/sh, arguments POSITIONAL (never interpolated into this text):
//   $1 = the data limit in KB, then the command to exec (node, the script).
// 1. oom_score_adj = 1000: when the host runs out of memory, the child is the victim
//    designated for the whole system, before `next-server` or Postgres. Best effort
//    (a failure is ignored): raising one's own score needs no privilege on Linux.
// 2. `ulimit -d`: the memory bound. CLOSED BY DEFAULT: if it fails there is no exec, the child
//    never says "ready", the task is refused and a line is logged; it never runs unbounded.
//
// THIS LAUNCHER MUST NEVER TOUCH RLIMIT_CORE (`ulimit -c`). A bomb stopped by the limit dies
// of SIGABRT (a failed g_malloc, or a fatal V8 out-of-memory), where the OOM killer used to send
// a SIGKILL without a core, and the host of the VPS pipes cores to apport
// (`core_pattern = |/usr/share/apport/apport ...`). With a PIPE core pattern the kernel
// (fs/coredump.c) IGNORES RLIMIT_CORE, except for the value 1 byte, which means "no dump":
// under `ulimit -c 0` an abort() still wrote a 261 MB core (proved by the audit), and a `-c 0`
// set UNDER a limit of 1 rewrites one. busybox cannot even set 1 byte (it counts in blocks of
// 512). The protection therefore lives at the container, `ulimits: core: 1` in
// docker-compose.prod.yml, and the child simply INHERITS it (tests/image-decode-launcher.test.ts
// compares the two). Observed on the VPS: an abort() in a throwaway container of the production
// image prints "core dumped", /var/crash and /var/lib/apport/coredump stay empty (apport drops
// the crashes of containers), but the kernel still hands apport the whole core: up to 1.5 GB of
// I/O per bomb.
const LINUX_LAUNCHER =
  '{ echo 1000 > /proc/self/oom_score_adj; } 2>/dev/null || true; ' +
  'ulimit -d "$1" || { echo "[image-decode] ulimit -d failed: the child is not started" >&2; exit 97; }; ' +
  'shift; exec "$@"';

export type ChildLaunch = { command: string; args: string[] };

/**
 * What to start. Linux: /bin/sh with the memory bound and the OOM priority above, then
 * node on the script. Anywhere else (Windows, macOS: development) node directly, WITHOUT
 * a memory bound — only the deadline applies there.
 */
export function buildChildLaunch(platform: NodeJS.Platform, nodePath: string, scriptPath: string, dataLimitMb: number = CHILD_DATA_LIMIT_MB): ChildLaunch {
  if (platform !== "linux") return { command: nodePath, args: [scriptPath] };
  return {
    command: "/bin/sh",
    args: ["-c", LINUX_LAUNCHER, "image-decode-child", String(Math.round(dataLimitMb * 1024)), nodePath, scriptPath],
  };
}

// --- The child, one per process ------------------------------------------------

type Pending = { resolve: (message: ChildResult) => void; reject: (error: Error) => void };
type Worker = { process: ChildProcess; pending: Map<number, Pending>; nextId: number; alive: boolean; busy: boolean };
type StartOutcome = "ready" | "failed";
type BridgeState = {
  worker: Worker | null;
  starting: Promise<Worker> | null;
  lastStart: StartOutcome | null;
  // Background retries after a failed start: the failures in a row, and the pending timer.
  failures: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

// A singleton of the PROCESS on globalThis under a Symbol.for key, like the queue of
// lib/imageMetadata.ts: the production build bundles this module into more than one
// server chunk, and a module variable would give each chunk its own child.
const STATE_KEY = Symbol.for("fullstack-starter.imageDecodeBridge.state");

function isBridgeState(value: unknown): value is BridgeState {
  return typeof value === "object" && value !== null && "worker" in value && "starting" in value;
}

function bridgeState(): BridgeState {
  const existing: unknown = Reflect.get(globalThis, STATE_KEY);
  if (isBridgeState(existing)) return existing;
  const created: BridgeState = { worker: null, starting: null, lastStart: null, failures: 0, retryTimer: null };
  Reflect.set(globalThis, STATE_KEY, created);
  return created;
}

// After a start that fails the bridge tries again on its own, with a growing wait: 30 s, 60 s,
// 120 s ... up to 15 minutes. So that `failed` on the health probe describes the PRESENT: the
// last start failed AND a new attempt is scheduled, not a verdict frozen at boot. Never
// triggered by the probe, which only reads. The timers do not keep the process alive.
const RETRY_FIRST_SECONDS = 30;
const RETRY_MAX_SECONDS = 15 * 60;

/** The wait before retry number `failures` (1 = after the first failure): 30, 60, 120, ... capped at 900 s. */
export function retryDelayMs(failures: number): number {
  return Math.min(RETRY_FIRST_SECONDS * 2 ** Math.max(failures - 1, 0), RETRY_MAX_SECONDS) * 1000;
}

function scheduleRetry(state: BridgeState): void {
  if (state.retryTimer !== null) return;
  const delay = retryDelayMs(state.failures);
  const timer = setTimeout(() => {
    state.retryTimer = null;
    // A failure schedules the next one (through ensureWorker); nothing is thrown here.
    ensureWorker(CHILD_STARTUP_SECONDS * 1000).catch(() => undefined);
  }, delay);
  timer.unref();
  state.retryTimer = timer;
}

/** Cancels the background retries (server shutdown, tests). */
export function stopDecoderRetries(): void {
  const state = bridgeState();
  if (state.retryTimer !== null) clearTimeout(state.retryTimer);
  state.retryTimer = null;
  state.failures = 0;
}

/**
 * What the public health probe may say about the decoder, and nothing more (no pid, no
 * message, no path): the outcome of the LAST start of the child. `failed` means that start
 * failed (`ulimit` refused, sharp or the script missing) and a new attempt is scheduled; image
 * uploads are refused in the meantime. `idle` means no start was attempted yet.
 */
export type ImageDecoderState = "ready" | "failed" | "idle";

export function imageDecoderState(): ImageDecoderState {
  return bridgeState().lastStart ?? "idle";
}

/**
 * Starts the child once, at server start (instrumentation.ts), so that a child that cannot
 * start shows on /api/health at once instead of at the first upload. Never throws and never
 * delays the server: a failure is the state `failed` and a log line, the next task retries.
 */
export async function warmImageDecoder(options: Pick<BridgeOptions, "startupMs"> = {}): Promise<void> {
  try {
    await ensureWorker(options.startupMs ?? CHILD_STARTUP_SECONDS * 1000);
  } catch {
    // Already logged where it failed, and recorded in lastStart.
  }
}

/** The pid of the running decode child, or null when none is running (the next task starts one). For tests and diagnosis. */
export function liveDecodeChildPid(): number | null {
  const worker = bridgeState().worker;
  return worker !== null && worker.alive ? (worker.process.pid ?? null) : null;
}

type ChildResult =
  | { ok: true; header?: unknown; output?: unknown }
  | { ok: false; reason: string };

function parseChildMessage(message: unknown): { type: "ready" } | { type: "result"; id: number; result: ChildResult } | null {
  if (typeof message !== "object" || message === null || !("type" in message)) return null;
  if (message.type === "ready") return { type: "ready" };
  if (message.type !== "result" || !("id" in message) || typeof message.id !== "number" || !("ok" in message)) return null;
  if (message.ok === true) {
    return {
      type: "result",
      id: message.id,
      result: { ok: true, header: "header" in message ? message.header : undefined, output: "output" in message ? message.output : undefined },
    };
  }
  const reason = "reason" in message && typeof message.reason === "string" ? message.reason : "unknown";
  return { type: "result", id: message.id, result: { ok: false, reason } };
}

// Resolved from the working directory: /app in the image (the WORKDIR, where the
// Dockerfile copies the script), the repository root in development and in tests.
function childScriptPath(): string {
  return join(process.cwd(), "scripts", "image-decode-child.mjs");
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return signal !== null ? `signal ${signal}` : `code ${code}`;
}

/** The worker is gone (or about to be): never served again, whatever waits on it is rejected. */
function forget(worker: Worker, error: Error): void {
  const state = bridgeState();
  worker.alive = false;
  if (state.worker === worker) state.worker = null;
  for (const pending of worker.pending.values()) pending.reject(error);
  worker.pending.clear();
}

/** SIGKILL, and forget it at once: the next task starts a fresh child, it never waits for this one to be reaped. */
function killWorker(worker: Worker): void {
  forget(worker, new Error("decode child killed"));
  worker.process.kill("SIGKILL");
}

function startWorker(startupMs: number): Promise<Worker> {
  return new Promise<Worker>((resolve, reject) => {
    const launch = buildChildLaunch(process.platform, process.execPath, childScriptPath());
    // `turbopackIgnore` on the first argument is what silences Turbopack's "Dynamic filesystem
    // access causes tracing of the whole project" warning, which would otherwise pull the
    // whole project into the traced output. Observed on this call with `next build`, all
    // four combinations: comment on the `spawn` argument (with or without one on the
    // `process.cwd()` of the path): no warning; comment on `process.cwd()` alone, or none:
    // the warning. (With the former `fork(path)` the same build FAILED without a comment,
    // "Module not found: Can't resolve '/ROOT/scripts/image-decode-child.mjs'": the form
    // of the call decides, so this is re-observed whenever it changes.)
    const child = spawn(/*turbopackIgnore: true*/ launch.command, launch.args, {
      env: buildChildEnv(process.env, process.platform),
      // Buffers cross the channel as such; stdin ignored; output visible in the container logs.
      // No exec flag of the server is passed (never `--inspect`).
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    // An idle child holds nothing alive: not the server, not a test runner.
    child.unref();
    child.channel?.unref();

    const worker: Worker = { process: child, pending: new Map(), nextId: 0, alive: true, busy: false };
    let ready = false;
    const startupTimer = setTimeout(() => {
      console.error(`[image-decode] child not ready after ${startupMs} ms, killed`);
      killWorker(worker);
      reject(new Error("decode child startup timed out"));
    }, startupMs);

    const lost = (error: Error): void => {
      clearTimeout(startupTimer);
      forget(worker, error);
      if (!ready) reject(error);
    };

    child.on("message", (raw: unknown) => {
      const message = parseChildMessage(raw);
      if (message === null) return;
      if (message.type === "ready") {
        if (ready || !worker.alive) return;
        ready = true;
        clearTimeout(startupTimer);
        resolve(worker);
        return;
      }
      const pending = worker.pending.get(message.id);
      if (pending === undefined) return;
      worker.pending.delete(message.id);
      pending.resolve(message.result);
    });
    child.on("exit", (code, signal) => {
      const how = describeExit(code, signal);
      // A kill we ordered is already logged by whoever ordered it.
      if (worker.alive) console.error(`[image-decode] child ${ready ? "died" : "failed to start"}: ${how}`);
      lost(new Error(`decode child exited (${how})`));
    });
    child.on("error", (error) => {
      console.error(`[image-decode] child error: ${error.message}`);
      lost(error);
    });
  });
}

function ensureWorker(startupMs: number): Promise<Worker> {
  const state = bridgeState();
  if (state.worker !== null && state.worker.alive) return Promise.resolve(state.worker);
  if (state.starting !== null) return state.starting;
  const starting = startWorker(startupMs).then(
    (worker) => {
      state.starting = null;
      state.worker = worker;
      state.lastStart = "ready";
      state.failures = 0;
      if (state.retryTimer !== null) clearTimeout(state.retryTimer);
      state.retryTimer = null;
      return worker;
    },
    (error: unknown) => {
      state.starting = null;
      state.lastStart = "failed";
      state.failures += 1;
      scheduleRetry(state);
      throw error;
    },
  );
  state.starting = starting;
  return starting;
}

// --- A task --------------------------------------------------------------------

function send(worker: Worker, body: ChildRequest): Promise<ChildResult> {
  return new Promise<ChildResult>((resolve, reject) => {
    if (!worker.alive) {
      reject(new Error("decode child is not running"));
      return;
    }
    const id = worker.nextId++;
    worker.pending.set(id, { resolve, reject });
    worker.process.send({ id, ...body }, (error) => {
      if (error) {
        worker.pending.delete(id);
        reject(error);
      }
    });
  });
}

/** What the child refused, as an error. `invalidRequest` is a bug of THIS side (the child validates what we send), so it is logged. */
function refusedBy(operation: string, result: { ok: false; reason: string } | { ok: true }): Error {
  const reason = result.ok ? "unexpected answer" : result.reason;
  if (reason === "invalidRequest") console.error(`[image-decode] the child refused a ${operation} request as invalid: a bug of the bridge`);
  return new Error(`${operation} refused by the decode child (${reason})`);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isHeader(value: unknown): value is ImageHeader {
  if (typeof value !== "object" || value === null) return false;
  const field = (key: string): unknown => Reflect.get(value, key);
  const optionalText = (key: string) => field(key) === undefined || typeof field(key) === "string";
  const optionalCount = (key: string) => field(key) === undefined || isPositiveInteger(field(key));
  return optionalText("format") && optionalText("depth") && optionalCount("width") && optionalCount("height") && optionalCount("channels");
}

function sessionFor(worker: Worker): DecodeSession {
  return {
    readHeader: async (input, limitInputPixels) => {
      const result = await send(worker, { op: "metadata", input, limitInputPixels });
      if (!result.ok || !isHeader(result.header)) throw refusedBy("metadata", result);
      return result.header;
    },
    encode: async (input, limitInputPixels, maxLongEdge, maxOutputBytes, output) => {
      const result = await send(worker, { op: "encode", input, limitInputPixels, maxLongEdge, maxOutputBytes, output });
      if (!result.ok || !(result.output instanceof Uint8Array)) throw refusedBy("encode", result);
      return Buffer.from(result.output.buffer, result.output.byteOffset, result.output.byteLength);
    },
  };
}

/**
 * Runs `task` against the decode child, under ONE deadline for the whole task: from
 * the moment the child is ready until the result. At the deadline the child gets
 * SIGKILL and the task is rejected; a child that dies (out of memory, native crash,
 * signal) rejects it too; the next task starts a fresh child. A child that cannot
 * start rejects the task: the decode is never done in this process instead.
 * The rejection is always a plain Error: the caller turns it into its own refusal,
 * nothing of it reaches a user. Only the operation and the duration are logged.
 *
 * One task at a time: the queue of lib/imageMetadata.ts guarantees it, and a second
 * task while one is in flight is a programming error, so it throws.
 */
export async function runInChild<T>(
  operation: DecodeOperation,
  task: (session: DecodeSession) => Promise<T>,
  options: BridgeOptions = {},
): Promise<T> {
  const deadlineMs = options.deadlineMs ?? DECODE_DEADLINE_SECONDS * 1000;
  const worker = await ensureWorker(options.startupMs ?? CHILD_STARTUP_SECONDS * 1000);
  if (worker.busy) throw new Error("a decode task is already running: tasks must go through runExclusive");
  worker.busy = true;
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.error(`[image-decode] ${operation} killed at the deadline after ${Math.round(performance.now() - startedAt)} ms`);
      killWorker(worker);
      reject(new Error("decode deadline exceeded"));
    }, deadlineMs);
  });
  try {
    return await Promise.race([task(sessionFor(worker)), deadline]);
  } finally {
    clearTimeout(timer);
    worker.busy = false;
  }
}
