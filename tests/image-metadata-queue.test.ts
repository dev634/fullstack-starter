import { describe, it, expect, vi, beforeEach } from "vitest";

// The bridge to the decode child is replaced by a fake that counts how many decodes are in
// flight at once: a real child cannot be observed from the outside. What is under test is the
// queue in lib/imageMetadata.ts, not the decoder. (The real child is in
// tests/image-decode-bridge.test.ts and tests/image-metadata-budget.test.ts.)
// A PNG signature: the JS check of lib/imageFrameCount.ts must pass for the task to reach the (fake) child.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const img = (id: string) => Buffer.concat([PNG_MAGIC, Buffer.from(id)]);

const state = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  started: [] as string[],
  finished: [] as string[],
  failFor: new Set<string>(),
  operations: [] as string[],
  limits: [] as number[],
}));

vi.mock("@/lib/imageDecodeBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/imageDecodeBridge")>();
  return {
    ...actual,
    runInChild: async (
      operation: string,
      task: (session: import("@/lib/imageDecodeBridge").DecodeSession) => Promise<unknown>,
    ) => {
      state.operations.push(operation);
      return task({
        readHeader: async (_input, limitInputPixels) => {
          state.limits.push(limitInputPixels);
          return { format: "jpeg", width: 10, height: 10, channels: 3, depth: "uchar" };
        },
        encode: async (input) => {
          const id = input.subarray(PNG_MAGIC.length).toString();
          state.inFlight += 1;
          state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
          state.started.push(id);
          await new Promise((resolve) => setTimeout(resolve, 5));
          state.inFlight -= 1;
          state.finished.push(id);
          // A deadline or a dead child rejects like any decode failure.
          if (state.failFor.has(id)) throw new Error("decode failed");
          return Buffer.from(`out-${id}`);
        },
      });
    },
  };
});

import {
  stripArchivedPhotoMetadata,
  convertToStrippedJpeg,
  runExclusive,
  isImageBusyError,
  MAX_WAITING_TASKS,
  SHARP_MAX_INPUT_PIXELS,
} from "@/lib/imageMetadata";

beforeEach(() => {
  state.inFlight = 0;
  state.maxInFlight = 0;
  state.started = [];
  state.finished = [];
  state.failFor = new Set();
  state.operations = [];
  state.limits = [];
});

/** A task that stays running until `release()` is called. */
function heldTask(log: string[], id: string) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const task = async () => {
    log.push(`start-${id}`);
    await gate;
    return id;
  };
  return { task, release };
}

describe("lib/imageMetadata — one sharp decode at a time", () => {
  it("N simultaneous calls never have more than one decode in flight, all complete, in call order", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const results = await Promise.all(ids.map((id) => stripArchivedPhotoMetadata(img(id), "image/jpeg")));
    expect(results.map((r) => r.toString())).toEqual(ids.map((id) => `out-${id}`));
    expect(state.maxInFlight).toBe(1);
    expect(state.started).toEqual(ids);
    expect(state.finished).toEqual(ids);
  });

  it("the queue is shared by the in-place stripper and the AVIF/TIFF converter", async () => {
    await Promise.all([
      stripArchivedPhotoMetadata(img("x"), "image/png"),
      convertToStrippedJpeg(img("y")),
      stripArchivedPhotoMetadata(img("z"), "image/webp"),
      convertToStrippedJpeg(img("w")),
    ]);
    expect(state.maxInFlight).toBe(1);
    expect(state.started).toEqual(["x", "y", "z", "w"]);
  });

  it("an error in one call is reported to ITS caller only and does not block the queue", async () => {
    state.failFor.add("bad");
    const settled = await Promise.allSettled([
      stripArchivedPhotoMetadata(img("one"), "image/jpeg"),
      stripArchivedPhotoMetadata(img("bad"), "image/jpeg"),
      convertToStrippedJpeg(img("bad")),
      stripArchivedPhotoMetadata(img("two"), "image/jpeg"),
    ]);
    expect(settled[0]).toMatchObject({ status: "fulfilled" });
    expect(settled[1]).toMatchObject({ status: "rejected", reason: { type: "error", code: "corruptedImage" } });
    expect(settled[2]).toMatchObject({ status: "rejected", reason: { type: "error", code: "corruptedImage" } });
    expect(settled[3]).toMatchObject({ status: "fulfilled" });
    expect(state.maxInFlight).toBe(1);
    expect(state.finished).toEqual(["one", "bad", "bad", "two"]);
  });

  it("each path says which operation it is, and sends the pixel ceiling with every header read", async () => {
    await stripArchivedPhotoMetadata(img("t"), "image/jpeg");
    await convertToStrippedJpeg(img("u"));
    expect(state.operations).toEqual(["strip", "convert"]);
    expect(state.limits).toEqual([SHARP_MAX_INPUT_PIXELS, SHARP_MAX_INPUT_PIXELS]);
  });
});

describe("lib/imageMetadata — the queue is bounded", () => {
  it("the bound is 8 waiting tasks", () => {
    expect(MAX_WAITING_TASKS).toBe(8);
  });

  it("the 9th waiting task is refused AT ONCE with imageBusy, the 8 before it still run, and the queue serves again after", async () => {
    const log: string[] = [];
    const held = Array.from({ length: 1 + MAX_WAITING_TASKS }, (_, i) => heldTask(log, String(i)));
    const accepted = held.map((h) => runExclusive(h.task));
    // 1 running + 8 waiting are accepted; only the first has started.
    expect(log).toEqual(["start-0"]);

    // The 9th WAITING task: refused without anything having been released.
    const refused = await runExclusive(async () => "never").then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toEqual({ type: "error", code: "imageBusy" });
    expect(isImageBusyError(refused)).toBe(true);
    expect(log).toEqual(["start-0"]);

    // The accepted ones all complete, in order, one at a time.
    for (const h of held) h.release();
    expect(await Promise.all(accepted)).toEqual(held.map((_, i) => String(i)));
    expect(log).toEqual(held.map((_, i) => `start-${i}`));

    // A "busy" refusal does not block what follows.
    await expect(runExclusive(async () => "after")).resolves.toBe("after");
  });

  it("a refusal for a full queue is not a decode failure: through stripArchivedPhotoMetadata it keeps its own code", async () => {
    const log: string[] = [];
    const held = Array.from({ length: 1 + MAX_WAITING_TASKS }, (_, i) => heldTask(log, String(i)));
    const accepted = held.map((h) => runExclusive(h.task));

    const error = await stripArchivedPhotoMetadata(img("late"), "image/jpeg").then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toEqual({ type: "error", code: "imageBusy" });
    expect(state.started).toEqual([]);

    for (const h of held) h.release();
    await Promise.all(accepted);
  });

  it("a task that outlasts the deadline (the child is killed) fails like any decode failure and frees the queue", async () => {
    // The bridge rejects the task when its child is killed; the fake reproduces that rejection.
    state.failFor.add("slow");
    const settled = await Promise.allSettled([
      stripArchivedPhotoMetadata(img("slow"), "image/jpeg"),
      stripArchivedPhotoMetadata(img("next"), "image/jpeg"),
    ]);
    expect(settled[0]).toMatchObject({ status: "rejected", reason: { type: "error", code: "corruptedImage" } });
    expect(settled[1]).toMatchObject({ status: "fulfilled" });
    // The queue is empty again: a fresh task starts immediately.
    await expect(runExclusive(async () => "free")).resolves.toBe("free");
  });
});

describe("lib/imageMetadata — one queue per PROCESS, not per module instance", () => {
  it("two instances of the module (two bundled chunks) share the queue: never more than one task running between them", async () => {
    vi.resetModules();
    const first = await import("@/lib/imageMetadata");
    vi.resetModules();
    const second = await import("@/lib/imageMetadata");
    // Two genuinely distinct module instances.
    expect(second.runExclusive).not.toBe(first.runExclusive);

    let running = 0;
    let maxRunning = 0;
    const task = (id: string) => async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return id;
    };
    const results = await Promise.all([
      first.runExclusive(task("a1")),
      second.runExclusive(task("b1")),
      first.runExclusive(task("a2")),
      second.runExclusive(task("b2")),
    ]);
    expect(results).toEqual(["a1", "b1", "a2", "b2"]);
    expect(maxRunning).toBe(1);
  });

  it("the bound of 8 waiting tasks is shared between the two instances too", async () => {
    vi.resetModules();
    const first = await import("@/lib/imageMetadata");
    vi.resetModules();
    const second = await import("@/lib/imageMetadata");

    const log: string[] = [];
    const held = Array.from({ length: 1 + MAX_WAITING_TASKS }, (_, i) => heldTask(log, String(i)));
    // Alternate between the two instances to fill the one queue.
    const accepted = held.map((h, i) => (i % 2 === 0 ? first : second).runExclusive(h.task));
    const refused = await second.runExclusive(async () => "never").then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toEqual({ type: "error", code: "imageBusy" });
    for (const h of held) h.release();
    await Promise.all(accepted);
  });
});
