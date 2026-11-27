import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";

// The parent side of the image decoder. sharp is NEVER imported by the server
// process: every call (`metadata()` included) runs in a child process forked from
// scripts/image-decode-child.mjs, and what bounds a task is that this process is
// KILLED when the deadline passes. A native decode cannot be interrupted from JS —
// a progressive JPEG of 3,529 scans (525 KB) is absorbed by one call,
// `jpeg_start_decompress`, a 100-page TIFF of 4,000 tags each spends 28 s in
// `metadata()` — so nothing inside the process that runs it can bound it; the
// operating system can. The JS checks of lib/imageFrameCount.ts remain, as cheap
// early refusals of the amplifiers already known; they bound nothing by themselves.
//
// Policy (queue, pixel ceiling, decoded-bytes budget, qualities) stays in
// lib/imageMetadata.ts: this module only knows how to run a task against a child
// and what the two operations of the child look like.

/** One bound for a whole task, in real time (see docs/CONVENTIONS.md for its calibration). */
export const DECODE_DEADLINE_SECONDS = 20;

// Starting the child (fork + importing sharp) has its own delay: it is not decode
// time, and a deadline that included it would refuse the first upload after a deploy.
export const CHILD_STARTUP_SECONDS = 30;

/** Which of the application's paths a task belongs to: only used to say what was killed. */
export type DecodeOperation = "strip" | "convert" | "model";

/** The header read by `metadata()`: nothing is decoded. The parent applies its budget to it. */
export type ImageHeader = { format?: string; width?: number; height?: number; channels?: number; depth?: string };

export type EncodeOutput = { format: "jpeg"; quality: number } | { format: "png" | "webp" | "gif" };

/** What a task may ask of the child: two operations, nothing else exists on the other side. */
export type DecodeSession = {
  readHeader: (input: Buffer, limitInputPixels: number) => Promise<ImageHeader>;
  /** Orientation applied, optional resize to a long edge, then `output`; metadata is never carried over. */
  encode: (input: Buffer, limitInputPixels: number, maxLongEdge: number | null, output: EncodeOutput) => Promise<Buffer>;
};

export type BridgeOptions = { deadlineMs?: number; startupMs?: number };

// --- Environment of the child --------------------------------------------------

// The child needs Node and sharp, nothing else. Built from an allowlist, so a
// secret added to the server's environment tomorrow does not reach the process
// that decodes what a user uploaded (DATABASE_URL, AUTH_*, CLOUDINARY_*, RESEND_*,
// ANTHROPIC_*, OPENAI_* are never named, and never copied).
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

// --- The child, one per process ------------------------------------------------

type Pending = { resolve: (message: ChildResult) => void; reject: (error: Error) => void };
type Worker = { process: ChildProcess; pending: Map<number, Pending>; nextId: number; alive: boolean };
type BridgeState = { worker: Worker | null; starting: Promise<Worker> | null };

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
  const created: BridgeState = { worker: null, starting: null };
  Reflect.set(globalThis, STATE_KEY, created);
  return created;
}

/** The pid of the running decode child, or null when none is running (the next task starts one). */
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
// Built with a path join on process.cwd(), which the bundler cannot follow.
function childScriptPath(): string {
  return join(/*turbopackIgnore: true*/ process.cwd(), "scripts", "image-decode-child.mjs");
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return signal !== null ? `signal ${signal}` : `code ${code}`;
}

function failPending(worker: Worker, error: Error): void {
  for (const pending of worker.pending.values()) pending.reject(error);
  worker.pending.clear();
}

/** SIGKILL, and forget it at once: the next task starts a fresh child, it never waits for this one to be reaped. */
function killWorker(worker: Worker): void {
  const state = bridgeState();
  worker.alive = false;
  if (state.worker === worker) state.worker = null;
  worker.process.kill("SIGKILL");
  failPending(worker, new Error("decode child killed"));
}

function startWorker(startupMs: number): Promise<Worker> {
  return new Promise<Worker>((resolve, reject) => {
    const child = fork(childScriptPath(), [], {
      env: buildChildEnv(process.env, process.platform),
      // Never inherit `--inspect` or a loader of the server.
      execArgv: [],
      // Buffers cross the channel as such.
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    // An idle child holds nothing alive: not the server, not a test runner.
    child.unref();
    child.channel?.unref();

    const worker: Worker = { process: child, pending: new Map(), nextId: 0, alive: true };
    let ready = false;
    const startupTimer = setTimeout(() => {
      console.error(`[image-decode] child not ready after ${startupMs} ms, killed`);
      killWorker(worker);
      reject(new Error("decode child startup timed out"));
    }, startupMs);

    const lost = (error: Error): void => {
      clearTimeout(startupTimer);
      const state = bridgeState();
      worker.alive = false;
      if (state.worker === worker) state.worker = null;
      failPending(worker, error);
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
      return worker;
    },
    (error: unknown) => {
      state.starting = null;
      throw error;
    },
  );
  state.starting = starting;
  return starting;
}

// --- A task --------------------------------------------------------------------

function send(worker: Worker, body: Record<string, unknown>): Promise<ChildResult> {
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

function isHeader(value: unknown): value is ImageHeader {
  if (typeof value !== "object" || value === null) return false;
  const text = (key: string) => !(key in value) || Reflect.get(value, key) === undefined || typeof Reflect.get(value, key) === "string";
  const num = (key: string) => !(key in value) || Reflect.get(value, key) === undefined || typeof Reflect.get(value, key) === "number";
  return text("format") && text("depth") && num("width") && num("height") && num("channels");
}

function sessionFor(worker: Worker): DecodeSession {
  return {
    readHeader: async (input, limitInputPixels) => {
      const result = await send(worker, { op: "metadata", input, limitInputPixels });
      if (!result.ok || !isHeader(result.header)) throw new Error("metadata refused by the decode child");
      return result.header;
    },
    encode: async (input, limitInputPixels, maxLongEdge, output) => {
      const result = await send(worker, { op: "encode", input, limitInputPixels, maxLongEdge, output });
      if (!result.ok || !(result.output instanceof Uint8Array)) throw new Error("encode refused by the decode child");
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
 */
export async function runInChild<T>(
  operation: DecodeOperation,
  task: (session: DecodeSession) => Promise<T>,
  options: BridgeOptions = {},
): Promise<T> {
  const deadlineMs = options.deadlineMs ?? DECODE_DEADLINE_SECONDS * 1000;
  const worker = await ensureWorker(options.startupMs ?? CHILD_STARTUP_SECONDS * 1000);
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
  }
}
