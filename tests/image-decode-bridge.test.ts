import { describe, it, expect, vi, afterAll, afterEach, beforeEach } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { fork as realFork, spawn as realSpawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildChildEnv,
  DECODE_DEADLINE_SECONDS,
  liveDecodeChildPid,
  runInChild,
  type DecodeSession,
} from "@/lib/imageDecodeBridge";
import { stripArchivedPhotoMetadata } from "@/lib/imageMetadata";
import { auditProgressiveJpeg } from "@/tests/helpers/progressiveJpegFixture";
import { tiffWithTags } from "@/tests/helpers/tiffFixture";
import { zTxtBomb } from "@/tests/helpers/pngFixture";

// The REAL child, started from scripts/image-decode-child.mjs. Time assertions are generous.
// `spawn` is wrapped (not replaced) so the options it receives can be read.
const { spawnSpy } = vi.hoisted(() => ({ spawnSpy: vi.fn<typeof import("node:child_process").spawn>() }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  spawnSpy.mockImplementation(actual.spawn);
  return { ...actual, spawn: spawnSpy };
});

/** The starts of the decode child (not the other processes this file launches itself). */
const childStarts = () =>
  spawnSpy.mock.calls.filter(([command, args]) => [command, ...(Array.isArray(args) ? args : [])].some((part) => String(part).includes("image-decode-child.mjs")));

beforeEach(() => {
  spawnSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const LIMIT = 40_000_000;
const SLOW = 60_000;

const png = () => sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
const jpeg = () => sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();

/** The whole recipe of a strip, as a task: header, then encode. */
const decode = (buffer: Buffer) => async (session: DecodeSession) => {
  await session.readHeader(buffer, LIMIT);
  return session.encode(buffer, LIMIT, null, { format: "jpeg", quality: 90 });
};

function bytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("not bytes");
  return value;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > until) throw new Error("condition not reached in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Kills the running child from the outside and waits until the bridge has noticed (it learns it from the exit event). */
async function killFromOutside(): Promise<number> {
  const pid = liveDecodeChildPid();
  if (pid === null) throw new Error("no child is running");
  process.kill(pid, "SIGKILL");
  await waitUntil(() => liveDecodeChildPid() === null);
  return pid;
}

/** Starts from nothing: whatever child is running is killed and forgotten. Makes a test independent of the one before. */
async function startFromNoChild(): Promise<void> {
  if (liveDecodeChildPid() !== null) await killFromOutside();
}

afterAll(() => {
  const pid = liveDecodeChildPid();
  if (pid !== null) process.kill(pid, "SIGKILL");
});

describe("buildChildEnv: an allowlist, never a copy", () => {
  const secrets = {
    DATABASE_URL: "postgres://user:pw@db/app",
    AUTH_SECRET: "s3cret",
    AUTH_URL: "https://x",
    CLOUDINARY_API_SECRET: "c",
    CLOUDINARY_URL: "cloudinary://k:s@n",
    RESEND_API_KEY: "r",
    ANTHROPIC_API_KEY: "a",
    OPENAI_API_KEY: "o",
    NODE_OPTIONS: "--inspect=0.0.0.0:9229",
  };

  it("keeps PATH and NODE_ENV and not one secret", () => {
    const env = buildChildEnv({ ...secrets, PATH: "/usr/bin", NODE_ENV: "production", HOME: "/home/x" }, "linux");
    expect(env).toEqual({ PATH: "/usr/bin", NODE_ENV: "production" });
  });

  it("does not carry Windows-only variables on Linux, and carries them on Windows (any case)", () => {
    const source = { ...secrets, PATH: "/p", SystemRoot: "C:\\Windows", TEMP: "C:\\t", TMP: "C:\\t" };
    expect(Object.keys(buildChildEnv(source, "linux")).sort()).toEqual(["NODE_ENV", "PATH"]);
    expect(buildChildEnv({ ...source, NODE_ENV: "test" }, "win32")).toEqual({
      PATH: "/p",
      NODE_ENV: "test",
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\t",
      TMP: "C:\\t",
    });
    const mixedCase = buildChildEnv({ Path: "C:\\bin", SYSTEMROOT: "C:\\Windows", ...secrets }, "win32");
    expect(mixedCase).toMatchObject({ PATH: "C:\\bin", SystemRoot: "C:\\Windows" });
    expect(Object.keys(mixedCase).some((key) => key in secrets)).toBe(false);
  });

  it("never lets a value through that is not on the list, whatever its name", () => {
    const env = buildChildEnv({ NODE_ENV: "development", ANYTHING_ELSE: "x", AUTH_SECRET: "y" }, "linux");
    expect(env).toEqual({ NODE_ENV: "development" });
  });

  it("an unknown or missing NODE_ENV reads as production", () => {
    expect(buildChildEnv({ NODE_ENV: "staging" }, "linux")).toEqual({ NODE_ENV: "production" });
    expect(buildChildEnv({}, "linux")).toEqual({ NODE_ENV: "production" });
  });
});

describe("how the child is started", () => {
  it("is started with the allowlisted environment, no exec flag, advanced serialization, no stdin", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://secret");
    vi.stubEnv("AUTH_SECRET", "secret");
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=64");
    await startFromNoChild();
    await runInChild("strip", decode(await jpeg()));
    const starts = childStarts();
    expect(starts).toHaveLength(1);
    const [command, args, options] = starts[0];
    // Nothing of the server's own flags travels (no --inspect, no loader): node gets the script and nothing else.
    const launched = [command, ...(args ?? [])].map(String);
    expect(launched.some((part) => part.startsWith("--"))).toBe(false);
    expect(options?.serialization).toBe("advanced");
    expect(options?.stdio).toEqual(["ignore", "inherit", "inherit", "ipc"]);
    const names = Object.keys(options?.env ?? {});
    expect(names.filter((key) => /DATABASE|AUTH|CLOUDINARY|RESEND|ANTHROPIC|OPENAI|NODE_OPTIONS/.test(key))).toEqual([]);
  }, SLOW);

  it("one child per process: a second task reuses it, and so does a second instance of the module", async () => {
    await startFromNoChild();
    await runInChild("strip", decode(await jpeg()));
    const pid = liveDecodeChildPid();
    expect(pid).not.toBeNull();
    const startsBefore = childStarts().length;
    await runInChild("strip", decode(await jpeg()));
    expect(liveDecodeChildPid()).toBe(pid);
    vi.resetModules();
    const second = await import("@/lib/imageDecodeBridge");
    expect(second.liveDecodeChildPid()).toBe(pid);
    await second.runInChild("strip", decode(await jpeg()));
    expect(second.liveDecodeChildPid()).toBe(pid);
    expect(childStarts()).toHaveLength(startsBefore);
  }, SLOW);

  it("a task started while another is in flight is a programming error and throws; the first one is not disturbed", async () => {
    await startFromNoChild();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runInChild("strip", async (session) => {
      await gate;
      return decode(await jpeg())(session);
    });
    await waitUntil(() => liveDecodeChildPid() !== null);
    await expect(runInChild("strip", decode(await jpeg()))).rejects.toThrow(/already running/);
    release();
    await expect(first).resolves.toBeInstanceOf(Buffer);
    // And the bridge serves again once the first one is over.
    await expect(runInChild("strip", decode(await jpeg()))).resolves.toBeInstanceOf(Buffer);
  }, SLOW);
});

describe("the deadline kills the child", () => {
  it("the deadline is 20 seconds of real time", () => {
    expect(DECODE_DEADLINE_SECONDS).toBe(20);
  });

  it("the real attack — a progressive JPEG of 3,529 scans, absorbed by ONE native call — is killed at a short deadline, then a legitimate file succeeds on a fresh child", async () => {
    const { buffer } = auditProgressiveJpeg();
    const before = liveDecodeChildPid();
    const started = performance.now();
    const outcome = await runInChild("strip", decode(buffer), { deadlineMs: 1_500 }).then(
      () => "accepted",
      (error: unknown) => error,
    );
    const elapsed = performance.now() - started;
    expect(outcome).toBeInstanceOf(Error);
    // Not 28 s: killed. (The deadline plus a generous margin; the file takes tens of seconds to decode.)
    expect(elapsed).toBeLessThan(10_000);
    expect(before).not.toBeNull();
    await waitUntil(() => !isAlive(before ?? 0));
    expect(liveDecodeChildPid()).toBeNull();

    const out = await runInChild("strip", decode(await jpeg()));
    expect(out.length).toBeGreaterThan(0);
    const after = liveDecodeChildPid();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  }, SLOW);

  it("the deadline covers the header read too: a 100-page x 4,000-tag TIFF is killed in metadata()", async () => {
    const tiff = tiffWithTags(100, 4_000);
    await runInChild("strip", decode(await jpeg())); // a ready child, whose pid we can follow
    const pid = liveDecodeChildPid();
    expect(pid).not.toBeNull();
    const started = performance.now();
    await expect(runInChild("convert", async (session) => session.readHeader(tiff, LIMIT), { deadlineMs: 1_000 })).rejects.toBeInstanceOf(Error);
    expect(performance.now() - started).toBeLessThan(10_000);
    await waitUntil(() => !isAlive(pid ?? 0));
    expect(liveDecodeChildPid()).toBeNull();
    // And the application's own path would have refused it before any child (tests/image-refused-before-child.test.ts).
    await expect(runInChild("strip", decode(await jpeg()))).resolves.toBeInstanceOf(Buffer);
    expect(liveDecodeChildPid()).not.toBe(pid);
  }, SLOW);

  it("measures the kill itself: from the deadline to a dead process", async () => {
    const { buffer } = auditProgressiveJpeg();
    await runInChild("strip", decode(await jpeg())); // a ready child, so the start is not in the figure
    const pid = liveDecodeChildPid() ?? 0;
    const started = performance.now();
    await expect(runInChild("strip", decode(buffer), { deadlineMs: 500 })).rejects.toBeInstanceOf(Error);
    const rejected = performance.now() - started;
    await waitUntil(() => !isAlive(pid));
    const dead = performance.now() - started;
    console.info(`[kill] deadline 500 ms -> task rejected after ${Math.round(rejected)} ms, process gone after ${Math.round(dead)} ms`);
    expect(dead).toBeLessThan(5_000);
  }, SLOW);
});

describe("a child that dies", () => {
  it("killed from outside between two tasks: the next task starts a fresh child and succeeds", async () => {
    await runInChild("strip", decode(await jpeg()));
    const pid = await killFromOutside();
    const out = await runInChild("strip", decode(await jpeg()));
    expect(out.length).toBeGreaterThan(0);
    expect(liveDecodeChildPid()).not.toBe(pid);
  }, SLOW);

  it("killed WHILE a task runs: that task is rejected, and the next one succeeds on a fresh child", async () => {
    await runInChild("strip", decode(await jpeg()));
    const pid = liveDecodeChildPid() ?? 0;
    const { buffer } = auditProgressiveJpeg();
    // Straight through the bridge (the JS count would refuse this file before it started).
    const running = runInChild("strip", decode(buffer), { deadlineMs: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    process.kill(pid, "SIGKILL");
    await expect(running).rejects.toBeInstanceOf(Error);
    await expect(stripArchivedPhotoMetadata(await jpeg(), "image/jpeg")).resolves.toBeInstanceOf(Buffer);
  }, SLOW);

  it("a child that cannot start in time rejects the task WITHOUT running it, and the next task starts one", async () => {
    await startFromNoChild();
    const task = vi.fn(async (session: DecodeSession) => decode(await jpeg())(session));
    await expect(runInChild("strip", task, { startupMs: 1 })).rejects.toBeInstanceOf(Error);
    // The task function (the only thing that talks to a decoder) never ran: nothing was decoded anywhere, in particular not here.
    expect(task).not.toHaveBeenCalled();
    await waitUntil(() => liveDecodeChildPid() === null);
    const out = await runInChild("strip", decode(await jpeg()));
    expect(out.length).toBeGreaterThan(0);
  }, SLOW);

  it.runIf(process.platform === "linux")(
    "[Linux] a bomb that goes past the data limit kills the child on its own, well before the deadline, and the next task succeeds",
    async () => {
      // 120 zTXt chunks of 40 MB inflated, handed to the child WITHOUT the cleaning of lib/pngTextChunks.ts.
      const bomb = zTxtBomb(120, 40);
      await startFromNoChild();
      const started = performance.now();
      await expect(runInChild("strip", decode(bomb), { deadlineMs: 45_000 })).rejects.toBeInstanceOf(Error);
      expect(performance.now() - started).toBeLessThan(40_000);
      await waitUntil(() => liveDecodeChildPid() === null);
      await expect(runInChild("strip", decode(await jpeg()))).resolves.toBeInstanceOf(Buffer);
    },
    120_000,
  );
});

describe("an idle child holds nothing alive", () => {
  it("a process that ran one task and does nothing else exits by itself", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-idle-"));
    const script = join(dir, "idle.mts");
    const bridge = pathToFileURL(join(process.cwd(), "lib", "imageDecodeBridge.ts")).href;
    const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    writeFileSync(
      script,
      `import { runInChild } from ${JSON.stringify(bridge)};
const png = Buffer.from(${JSON.stringify(tinyPng)}, "base64");
const header = await runInChild("strip", (session) => session.readHeader(png, 1000000));
console.log("HEADER " + JSON.stringify(header));
`,
    );
    try {
      const result = await new Promise<{ code: number | null; out: string; hung: boolean }>((resolve) => {
        const tsx = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
        const proc = realSpawn(process.execPath, [tsx, script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] });
        let out = "";
        proc.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          resolve({ code: null, out, hung: true });
        }, 40_000);
        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, out, hung: false });
        });
      });
      expect(result.out).toContain('"format":"png"');
      expect(result.hung).toBe(false);
      expect(result.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

/** What the child does at load: every call to sharp's cache / concurrency (any depth), and every module it loads. */
function inspectChildSource(text: string) {
  const source = ts.createSourceFile("child.mjs", text, ts.ScriptTarget.Latest, true);
  const calls: Record<"cache" | "concurrency", string[]> = { cache: [], concurrency: [] };
  const topLevel: string[] = [];
  const modules: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const method = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
          ? callee.argumentExpression.text
          : null;
      if (method === "cache" || method === "concurrency") calls[method].push(node.getText(source));
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) modules.push(node.getText(source));
    }
    if (ts.isImportDeclaration(node)) modules.push(node.moduleSpecifier.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const statement of source.statements) {
    if (ts.isExpressionStatement(statement)) topLevel.push(statement.expression.getText(source));
  }
  return { calls, topLevel, modules };
}

describe("how libvips is set up in the child", () => {
  // The child is plain JS, so this reads its source: exactly one call of each, made at load.
  const child = inspectChildSource(readFileSync(join(process.cwd(), "scripts", "image-decode-child.mjs"), "utf8"));

  it("switches the operation cache off at load, once (it retained every decode: ~3 GB after 20 GIFs)", () => {
    expect(child.calls.cache).toEqual(["sharp.cache(false)"]);
    expect(child.topLevel).toContain("sharp.cache(false)");
  });

  it("limits libvips to ONE thread at load, once (two cores shared with the web server and the database)", () => {
    expect(child.calls.concurrency).toEqual(["sharp.concurrency(1)"]);
    expect(child.topLevel).toContain("sharp.concurrency(1)");
  });

  it("loads sharp and nothing else: no other import, no import(), no require()", () => {
    expect(child.modules).toEqual(['"sharp"']);
  });

  // The three probes of that reading: the form that would break it, its neighbours, and a neighbour that must stay green.
  describe("the reading itself (probes)", () => {
    it("a second, contrary call is seen, whatever its depth", () => {
      const text = 'import sharp from "sharp";\nsharp.cache(false);\nsharp.concurrency(1);\nfunction later() { sharp.cache(true); }';
      expect(inspectChildSource(text).calls.cache).toEqual(["sharp.cache(false)", "sharp.cache(true)"]);
    });

    it("the neighbouring forms are seen: element access, a changed argument, import() and require()", () => {
      const text = 'import sharp from "sharp";\nsharp["cache"](true);\nsharp.concurrency(8);\nawait import("pg");\nrequire("fs");';
      const seen = inspectChildSource(text);
      expect(seen.calls.cache).toEqual(['sharp["cache"](true)']);
      expect(seen.calls.concurrency).toEqual(["sharp.concurrency(8)"]);
      expect(seen.modules).toEqual(['"sharp"', 'import("pg")', 'require("fs")']);
    });

    it("a mention in a comment or a string is not a call", () => {
      const text = 'import sharp from "sharp";\n// sharp.cache(true)\nconst note = "sharp.concurrency(8)";\nsharp.cache(false);';
      const seen = inspectChildSource(text);
      expect(seen.calls.cache).toEqual(["sharp.cache(false)"]);
      expect(seen.calls.concurrency).toEqual([]);
    });
  });
});

describe("the executor of the child is closed", () => {
  /** Forks the child directly and sends raw messages: what the bridge never sends. */
  async function withRawChild<T>(run: (ask: (message: string | number | object) => Promise<Record<string, unknown>>) => Promise<T>): Promise<T> {
    const child = realFork(join(process.cwd(), "scripts", "image-decode-child.mjs"), [], {
      execArgv: [],
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const waiting: Array<(message: Record<string, unknown>) => void> = [];
    await new Promise<void>((resolve) => {
      child.on("message", (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const record: Record<string, unknown> = Object.fromEntries(Object.entries(message));
        if (record.type === "ready") resolve();
        else waiting.shift()?.(record);
      });
    });
    const ask = (message: string | number | object) =>
      new Promise<Record<string, unknown>>((resolve) => {
        waiting.push(resolve);
        child.send(message);
      });
    try {
      return await run(ask);
    } finally {
      child.kill("SIGKILL");
    }
  }

  it("answers a valid request, and refuses everything else with a code and no native message", async () => {
    const input = await png();
    await withRawChild(async (ask) => {
      const good = await ask({ id: 1, op: "metadata", input, limitInputPixels: LIMIT });
      expect(good).toMatchObject({ type: "result", id: 1, ok: true, header: { format: "png", width: 16, height: 12 } });

      const refused = [
        { id: 2, op: "shell", input, limitInputPixels: LIMIT }, // unknown operation
        { id: 3, op: "metadata", input, limitInputPixels: LIMIT, extra: 1 }, // unknown key
        { id: 4, op: "metadata", input: "text", limitInputPixels: LIMIT }, // input is not bytes
        { id: 5, op: "metadata", input, limitInputPixels: 1e12 }, // above sharp's own ceiling
        { id: 6, op: "metadata", input, limitInputPixels: 1.5 },
        { id: 7, op: "encode", input, limitInputPixels: LIMIT, maxLongEdge: null, output: { format: "tiff" } }, // format outside the list
        { id: 8, op: "encode", input, limitInputPixels: LIMIT, maxLongEdge: null, output: { format: "jpeg", quality: 500 } },
        { id: 9, op: "encode", input, limitInputPixels: LIMIT, maxLongEdge: 0, output: { format: "png" } },
        { id: 10, op: "encode", input, limitInputPixels: LIMIT, maxLongEdge: null, output: { format: "png", quality: 5 } },
        { id: 11, op: "encode", input, limitInputPixels: LIMIT, output: { format: "png" } }, // key missing
        { id: 12, op: "metadata", input: new Uint8Array(0), limitInputPixels: LIMIT },
      ];
      for (const request of refused) {
        const answer = await ask(request);
        expect(answer, JSON.stringify(Object.keys(request))).toEqual({ type: "result", id: request.id, ok: false, reason: "invalidRequest" });
      }
      for (const nonsense of ["metadata", 42, [1, 2], {}]) {
        const answer = await ask(nonsense);
        expect(answer).toMatchObject({ type: "result", ok: false, reason: "invalidRequest" });
      }
    });
  }, SLOW);

  it("a decode failure answers a bare code: the native message never travels", async () => {
    await withRawChild(async (ask) => {
      const answer = await ask({ id: 1, op: "metadata", input: Buffer.from("definitely not an image"), limitInputPixels: LIMIT });
      expect(answer).toEqual({ type: "result", id: 1, ok: false, reason: "decodeFailed" });
    });
  }, SLOW);

  it("the recipes work: every output format, with and without a resize, orientation applied, metadata dropped", async () => {
    const source = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 9, g: 9, b: 9 } } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    await withRawChild(async (ask) => {
      for (const output of [{ format: "jpeg", quality: 80 }, { format: "png" }, { format: "webp" }, { format: "gif" }]) {
        const answer = await ask({ id: 1, op: "encode", input: source, limitInputPixels: LIMIT, maxLongEdge: null, output });
        expect(answer.ok, output.format).toBe(true);
        const meta = await sharp(bytes(answer.output)).metadata();
        expect(meta.format).toBe(output.format);
        // 40x20 with orientation 6 is displayed 20x40: applied, then the tag is gone.
        expect([meta.width, meta.height]).toEqual([20, 40]);
        expect(meta.orientation).toBeUndefined();
        expect(meta.exif).toBeUndefined();
      }
      const resized = await ask({ id: 2, op: "encode", input: source, limitInputPixels: LIMIT, maxLongEdge: 10, output: { format: "jpeg", quality: 85 } });
      const meta = await sharp(bytes(resized.output)).metadata();
      expect([meta.width, meta.height]).toEqual([5, 10]);
    });
  }, SLOW);
});
