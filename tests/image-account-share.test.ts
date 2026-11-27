import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The share of an ACCOUNT in the decoder (lib/imageMetadata.ts): at most ONE task per account in the
// queue, and a budget of decode TIME per account over a sliding hour. The decode child is replaced by a
// fake whose cost is a FAKE CLOCK (Date and performance are faked, the fake child advances them): what is
// under test is the accounting, not sharp. The real child, with the legitimate workloads, is in
// tests/image-account-share-real.test.ts.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const img = (id: string) => Buffer.concat([PNG_MAGIC, Buffer.from(id)]);

const state = vi.hoisted(() => ({
  /** What the next task spends in the child, in fake milliseconds. */
  costMs: 1_000,
  /** The next task fails AFTER spending its cost: "died" (a native error, a crash) or "deadline" (killed at the 20 s deadline). */
  fail: false as false | "died" | "deadline",
  /** The long edge the last encode was asked for (null = keep the dimensions). */
  lastLongEdge: null as number | null,
  /** The child cannot start: `startupMs` pass, then the task is never given to it. */
  startFails: false,
  startupMs: 30_000,
  operations: [] as string[],
  outputBytes: 10,
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
      if (state.startFails) {
        vi.advanceTimersByTime(state.startupMs);
        throw new Error("decode child did not start");
      }
      return task({
        readHeader: async () => ({ format: "jpeg", width: 10, height: 10, channels: 3, depth: "uchar" }),
        encode: async (_input, _limit, maxLongEdge) => {
          state.lastLongEdge = maxLongEdge;
          vi.advanceTimersByTime(state.costMs);
          if (state.fail === "deadline") throw Object.assign(new Error("decode deadline exceeded"), { decodeFailure: "deadline" });
          if (state.fail) throw new Error("decode child died");
          return Buffer.alloc(state.outputBytes);
        },
      });
    },
  };
});

import {
  DECODE_BUDGET_MS,
  DECODE_BUDGET_WINDOW_MS,
  MAX_WAITING_TASKS,
  DECODE_MIN_COST_MS,
  encodeOriented,
  longEdgeToFit,
  runExclusive,
  stripArchivedPhotoMetadata,
} from "@/lib/imageMetadata";
import { freshOwner, LENIENT_LIMITS } from "@/tests/helpers/imageAccount";

const strip = (owner: string, id = "x") => stripArchivedPhotoMetadata(owner, img(id), "image/jpeg", LENIENT_LIMITS);

/** The refusal a promise ends in, or null when it resolved. */
async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (reason: unknown) => reason,
  );
}

/** A task that stays running until released. */
function held() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { task: async () => gate, release };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-11-27T10:00:00Z"));
  state.costMs = 1_000;
  state.fail = false;
  state.lastLongEdge = null;
  state.startFails = false;
  state.startupMs = 30_000;
  state.operations = [];
  state.outputBytes = 10;
});
afterEach(() => vi.useRealTimers());

describe("one task per account, waiting or running", () => {
  it("a second task of the SAME account is refused at once with imageInProgress, whatever the queue holds", async () => {
    const owner = freshOwner();
    const first = held();
    const running = runExclusive(owner, first.task);
    expect(await refusalOf(runExclusive(owner, async () => "never"))).toEqual({ type: "error", code: "imageInProgress" });
    first.release();
    await running;
    // The place is given back when the task ends: the same account may send again.
    await expect(runExclusive(owner, async () => "again")).resolves.toBe("again");
  });

  it("a task that is still WAITING counts too: the account cannot queue two behind someone else's", async () => {
    const other = held();
    const blocking = runExclusive(freshOwner(), other.task);
    const owner = freshOwner();
    const waiting = runExclusive(owner, async () => "waited");
    expect(await refusalOf(runExclusive(owner, async () => "never"))).toEqual({ type: "error", code: "imageInProgress" });
    other.release();
    await blocking;
    await expect(waiting).resolves.toBe("waited");
  });

  it("the audit's nine simultaneous sends of one account: one is served, eight are refused imageInProgress — and another account is NOT told the server is busy", async () => {
    const abuser = freshOwner();
    const gate = held();
    const all = Array.from({ length: 1 + MAX_WAITING_TASKS }, () => runExclusive(abuser, gate.task));
    // Another account's photo, sent while the abuser holds nothing but its own place: it is QUEUED, not refused.
    const neighbour = runExclusive(freshOwner(), async () => "served");
    const refusals = await Promise.all(all.slice(1).map(refusalOf));
    expect(refusals).toEqual(Array.from({ length: MAX_WAITING_TASKS }, () => ({ type: "error", code: "imageInProgress" })));
    gate.release();
    await all[0];
    await expect(neighbour).resolves.toBe("served");
  });

  it("the check and the reservation are ONE step: two sends in the same tick cannot both pass", async () => {
    const owner = freshOwner();
    const settled = await Promise.allSettled([strip(owner, "a"), strip(owner, "b")]);
    expect(settled.map((s) => s.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(rejected?.reason).toEqual({ type: "error", code: "imageInProgress" });
  });

  it("a failed task gives the place back too", async () => {
    const owner = freshOwner();
    state.fail = "died";
    expect(await refusalOf(strip(owner))).toEqual({ type: "error", code: "corruptedImage" });
    state.fail = false;
    await expect(strip(owner)).resolves.toBeInstanceOf(Buffer);
  });

  it("an account out of budget hears imageQuota (its own cause), not imageBusy, when the queue is full as well", async () => {
    const owner = freshOwner();
    state.costMs = DECODE_BUDGET_MS;
    await strip(owner);
    const gate = held();
    const blocking = runExclusive(freshOwner(), gate.task);
    expect(await refusalOf(strip(owner))).toMatchObject({ code: "imageQuota" });
    // Fill the queue with other accounts: the out-of-budget account still hears "quota", not "busy".
    const fill = Array.from({ length: MAX_WAITING_TASKS }, () => runExclusive(freshOwner(), gate.task));
    expect(await refusalOf(strip(owner))).toMatchObject({ code: "imageQuota" });
    expect(await refusalOf(strip(freshOwner()))).toEqual({ type: "error", code: "imageBusy" });
    gate.release();
    await Promise.all([blocking, ...fill]);
  });
});

describe("a budget of decode TIME per account, over a sliding hour", () => {
  it("the budget is 300 seconds over one hour", () => {
    expect(DECODE_BUDGET_MS).toBe(300_000);
    expect(DECODE_BUDGET_WINDOW_MS).toBe(3_600_000);
  });

  it("the task that reaches the budget is served; the NEXT one is refused BEFORE it enters the queue, with the delay in minutes", async () => {
    const owner = freshOwner();
    state.costMs = 299_000;
    await strip(owner);
    state.costMs = 2_000;
    await expect(strip(owner)).resolves.toBeInstanceOf(Buffer); // 299 s spent: under 300, admitted (and spends 2 s more)
    state.operations = [];
    const refusal = await refusalOf(strip(owner));
    expect(refusal).toMatchObject({ type: "error", code: "imageQuota" });
    // Refused before the queue: no child was asked for anything.
    expect(state.operations).toEqual([]);
    // The 299 s task ended at minute 4, the 2 s one at minute 5 (one slot per minute): dropping the first
    // leaves 2 s, so the delay is ITS exit, minute 4 + 60 - minute 5 = 59.
    expect((refusal as { minutes: number }).minutes).toBe(59);
  });

  it("the window slides: half an hour later the delay is 30 minutes, after an hour the account is served again", async () => {
    const owner = freshOwner();
    state.costMs = DECODE_BUDGET_MS;
    await strip(owner);
    vi.advanceTimersByTime(30 * 60_000);
    expect(await refusalOf(strip(owner))).toMatchObject({ code: "imageQuota", minutes: 30 });
    vi.advanceTimersByTime(30 * 60_000 + 1);
    state.costMs = 1_000;
    await expect(strip(owner)).resolves.toBeInstanceOf(Buffer);
  });

  it("the delay is when ENOUGH of the oldest spans have left the window, not the oldest one alone", async () => {
    const owner = freshOwner();
    state.costMs = 100_000;
    await strip(owner); // ends at 100 s
    vi.advanceTimersByTime(20 * 60_000);
    await strip(owner); // ends at 1,400 s
    vi.advanceTimersByTime(20 * 60_000);
    await strip(owner); // ends at 2,700 s: 300 s spent in total
    // The tasks ended at minutes 1, 23 and 45. Dropping the oldest (100 s) leaves 200 s: under the budget, so the
    // delay is ITS exit: minute 1 + 60 - minute 45 = 16 — not 60, which is when the NEWEST would leave.
    expect(await refusalOf(strip(owner))).toEqual({ type: "error", code: "imageQuota", minutes: 16 });
  });

  it("a task killed at the deadline COSTS its time and reads imageTooHeavy, not 'not an image' (a bomb is not free: 15 of them end the hour)", async () => {
    const owner = freshOwner();
    state.costMs = 20_000;
    state.fail = "deadline";
    for (let i = 0; i < 15; i++) {
      expect(await refusalOf(strip(owner))).toEqual({ type: "error", code: "imageTooHeavy" });
    }
    expect(await refusalOf(strip(owner))).toMatchObject({ code: "imageQuota" });
  });

  it("a decode that fails costs its time like one that succeeds", async () => {
    const owner = freshOwner();
    state.costMs = 150_000;
    state.fail = "died";
    await refusalOf(strip(owner));
    state.fail = false;
    await strip(owner);
    expect(await refusalOf(strip(owner))).toMatchObject({ code: "imageQuota" });
  });

  it("an output refused for its size (the destination's ceiling) costs its time too: the child already did the work", async () => {
    const owner = freshOwner();
    state.costMs = 150_000;
    state.outputBytes = 500;
    const limits = { maxOutputBytes: 100, fitInPixels: 25_000_000 };
    expect(await refusalOf(stripArchivedPhotoMetadata(owner, img("big"), "image/jpeg", limits))).toMatchObject({ code: "outputTooLarge" });
    expect(await refusalOf(stripArchivedPhotoMetadata(owner, img("big"), "image/jpeg", limits))).toMatchObject({ code: "outputTooLarge" });
    expect(await refusalOf(strip(owner))).toMatchObject({ code: "imageQuota" });
  });

  it("what costs NOTHING: a child that cannot start (imageUnavailable), a JS refusal, and the three refusals of the share itself", async () => {
    const owner = freshOwner();
    // The child cannot start: 30 s of fake time pass, none is charged.
    state.startFails = true;
    for (let i = 0; i < 12; i++) {
      expect(await refusalOf(strip(owner))).toEqual({ type: "error", code: "imageUnavailable" });
    }
    state.startFails = false;
    // A file the JS checks refuse never reaches the queue.
    for (let i = 0; i < 12; i++) {
      expect(await refusalOf(stripArchivedPhotoMetadata(owner, Buffer.from("not an image"), "image/jpeg", LENIENT_LIMITS))).toEqual({
        type: "error",
        code: "corruptedImage",
      });
    }
    // imageInProgress and imageBusy.
    const gate = held();
    const running = runExclusive(owner, gate.task);
    for (let i = 0; i < 12; i++) {
      expect(await refusalOf(strip(owner))).toEqual({ type: "error", code: "imageInProgress" });
    }
    gate.release();
    await running;
    // 36 refusals later the whole budget is still there: one task of 299 s is admitted, and a second is refused only after it.
    state.costMs = 299_000;
    await expect(strip(owner)).resolves.toBeInstanceOf(Buffer);
    state.costMs = 1_000;
    await expect(strip(owner)).resolves.toBeInstanceOf(Buffer);
    expect(await refusalOf(strip(owner))).toMatchObject({ code: "imageQuota" });
  });

  it("a task costs AT LEAST 250 ms: a cheap task cannot be free, so an account is bounded to 1,200 of them an hour", async () => {
    expect(DECODE_MIN_COST_MS).toBe(250);
    expect(DECODE_BUDGET_MS / DECODE_MIN_COST_MS).toBe(1_200);
    const owner = freshOwner();
    state.costMs = 0; // a refusal after the header read: well under a millisecond in real life
    for (let i = 0; i < 1_200; i++) await strip(owner);
    expect(await refusalOf(strip(owner))).toMatchObject({ code: "imageQuota" });
  });

  it("the ledger of an account is BOUNDED: one slot per minute, at most 61 live, whatever the number of tasks", async () => {
    const owner = freshOwner();
    state.costMs = 0;
    for (let minute = 0; minute < 130; minute++) {
      for (let i = 0; i < 3; i++) await strip(owner);
      vi.advanceTimersByTime(60_000);
    }
    const accounts: unknown = Reflect.get(globalThis, Symbol.for("fullstack-starter.imageMetadata.accounts"));
    const ledger = accounts instanceof Object && "spent" in accounts && accounts.spent instanceof Map ? accounts.spent.get(owner) : null;
    expect(ledger.buckets.length).toBeLessThanOrEqual(61);
    // 390 tasks over 130 minutes; only the last hour counts.
    expect(ledger.total).toBe(ledger.buckets.reduce((sum: number, bucket: { ms: number }) => sum + bucket.ms, 0));
    expect(ledger.total).toBeLessThanOrEqual(61 * 3 * DECODE_MIN_COST_MS);
  });

  it("an account out of budget does not touch another account's", async () => {
    const spender = freshOwner();
    state.costMs = DECODE_BUDGET_MS;
    await strip(spender);
    expect(await refusalOf(strip(spender))).toMatchObject({ code: "imageQuota" });
    state.costMs = 1_000;
    await expect(strip(freshOwner())).resolves.toBeInstanceOf(Buffer);
  });

  it("the state is the PROCESS's, not the module instance's: a second bundled copy of the module sees the same hour", async () => {
    vi.resetModules();
    const first = await import("@/lib/imageMetadata");
    vi.resetModules();
    const second = await import("@/lib/imageMetadata");
    expect(second.runExclusive).not.toBe(first.runExclusive);
    const owner = freshOwner();
    state.costMs = DECODE_BUDGET_MS;
    await first.stripArchivedPhotoMetadata(owner, img("one"), "image/jpeg", LENIENT_LIMITS);
    expect(await refusalOf(second.stripArchivedPhotoMetadata(owner, img("two"), "image/jpeg", LENIENT_LIMITS))).toMatchObject({ code: "imageQuota" });
    // And the place of an account in flight in one copy is held against the other.
    const owner2 = freshOwner();
    const gate = held();
    const running = first.runExclusive(owner2, gate.task);
    expect(await refusalOf(second.runExclusive(owner2, async () => "never"))).toEqual({ type: "error", code: "imageInProgress" });
    gate.release();
    await running;
  });

  it("an account that never comes back leaves nothing behind: its spans are purged at the next access of ANY account", async () => {
    const gone = freshOwner();
    state.costMs = 1_000;
    await strip(gone);
    vi.advanceTimersByTime(DECODE_BUDGET_WINDOW_MS + 1);
    await strip(freshOwner());
    const accounts: unknown = Reflect.get(globalThis, Symbol.for("fullstack-starter.imageMetadata.accounts"));
    expect(accounts instanceof Object && "spent" in accounts && accounts.spent instanceof Map ? accounts.spent.has(gone) : null).toBe(false);
  });
});

describe("the cheap checks come first", () => {
  it("an account with a task in flight is refused imageInProgress BEFORE its file is walked: a garbage file would otherwise read 'corrupted'", async () => {
    const owner = freshOwner();
    const gate = held();
    const running = runExclusive(owner, gate.task);
    const garbage = Buffer.alloc(10 * 1024 * 1024, 7);
    expect(await refusalOf(stripArchivedPhotoMetadata(owner, garbage, "image/jpeg", LENIENT_LIMITS))).toEqual({ type: "error", code: "imageInProgress" });
    gate.release();
    await running;
  });

  it("an account out of budget is refused imageQuota BEFORE its file is walked", async () => {
    const owner = freshOwner();
    state.costMs = DECODE_BUDGET_MS;
    await strip(owner);
    const garbage = Buffer.alloc(10 * 1024 * 1024, 7);
    expect(await refusalOf(stripArchivedPhotoMetadata(owner, garbage, "image/jpeg", LENIENT_LIMITS))).toMatchObject({ code: "imageQuota" });
  });

  it("a file the JS walk refuses gives the reserved place back (the account may send again at once), and costs nothing", async () => {
    const owner = freshOwner();
    expect(await refusalOf(stripArchivedPhotoMetadata(owner, Buffer.from("not an image"), "image/jpeg", LENIENT_LIMITS))).toEqual({ type: "error", code: "corruptedImage" });
    await expect(strip(owner)).resolves.toBeInstanceOf(Buffer);
  });

  it("a file the JS walk refuses never answers imageBusy, even with the queue full", async () => {
    const gate = held();
    const blocking = runExclusive(freshOwner(), gate.task);
    const fill = Array.from({ length: MAX_WAITING_TASKS }, () => runExclusive(freshOwner(), gate.task));
    expect(await refusalOf(stripArchivedPhotoMetadata(freshOwner(), Buffer.from("not an image"), "image/jpeg", LENIENT_LIMITS))).toEqual({ type: "error", code: "corruptedImage" });
    expect(await refusalOf(strip(freshOwner()))).toEqual({ type: "error", code: "imageBusy" });
    gate.release();
    await Promise.all([blocking, ...fill]);
  });
});

describe("what a path that cannot decode says, and what each destination's ceilings refuse", () => {
  it("a child that cannot START is imageUnavailable (the decoder is down), never corruptedImage (the user's file)", async () => {
    state.startFails = true;
    expect(await refusalOf(strip(freshOwner()))).toEqual({ type: "error", code: "imageUnavailable" });
  });

  it("a child that dies DURING the task stays corruptedImage", async () => {
    state.fail = "died";
    expect(await refusalOf(strip(freshOwner()))).toEqual({ type: "error", code: "corruptedImage" });
  });

  it("an output beyond the CALLER's ceiling is outputTooLarge, with the ceiling in MB for the message", async () => {
    state.outputBytes = 10 * 1024 * 1024 + 1;
    const refusal = await refusalOf(
      stripArchivedPhotoMetadata(freshOwner(), img("a"), "image/jpeg", { maxOutputBytes: 10 * 1024 * 1024, fitInPixels: 25_000_000 }),
    );
    expect(refusal).toEqual({ type: "error", code: "outputTooLarge", maxBytes: 10 * 1024 * 1024 });
  });

  it("an output the CHILD refused (its own ceiling, before sending it) is outputTooLarge as well, not corruptedImage", async () => {
    vi.resetModules();
    vi.doMock("@/lib/imageDecodeBridge", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/imageDecodeBridge")>()),
      runInChild: async (_operation: string, task: (session: import("@/lib/imageDecodeBridge").DecodeSession) => Promise<unknown>) =>
        task({
          readHeader: async () => ({ format: "jpeg", width: 10, height: 10, channels: 3, depth: "uchar" }),
          encode: async () => {
            // What the bridge throws for the child's own refusal (lib/imageDecodeBridge.ts::refusedBy): a typed marker.
            throw Object.assign(new Error("encode refused by the decode child"), { decodeFailure: "outputTooLarge" });
          },
        }),
    }));
    const { stripArchivedPhotoMetadata: strippingWithRefusingChild } = await import("@/lib/imageMetadata");
    const refusal = await refusalOf(
      strippingWithRefusingChild(freshOwner(), img("a"), "image/jpeg", { maxOutputBytes: 5 * 1024 * 1024, fitInPixels: 25_000_000 }),
    );
    expect(refusal).toEqual({ type: "error", code: "outputTooLarge", maxBytes: 5 * 1024 * 1024 });
    vi.doUnmock("@/lib/imageDecodeBridge");
  });

  // A storage that cannot keep an image beyond its pixel ceiling gets it REDUCED to fit, never refused (an A4 scanned at
  // 600 dpi is 34.8 Mpx and used to be refused at every attempt). The fake header is 10 x 10 = 100 pixels.
  it("a header beyond the destination's pixel ceiling is REDUCED to fit (proportions kept), never refused", async () => {
    const limits = (fitInPixels: number) => ({ maxOutputBytes: 10 * 1024 * 1024, fitInPixels });
    await expect(stripArchivedPhotoMetadata(freshOwner(), img("a"), "image/jpeg", limits(50))).resolves.toBeInstanceOf(Buffer);
    // sqrt(50 / 100) * 10 = 7.07 -> 7, one less for the rounding of the short side: 6 (6 x 6 = 36 <= 50).
    expect(state.lastLongEdge).toBe(6);
    // A header exactly AT the ceiling, or under it, is left alone.
    await strip(freshOwner());
    expect(state.lastLongEdge).toBeNull();
    await stripArchivedPhotoMetadata(freshOwner(), img("a"), "image/jpeg", limits(100));
    expect(state.lastLongEdge).toBeNull();
  });

  it("the reduction never lets a rounded short side push the product over the ceiling", async () => {
    // Every pair of the form w x h with w * h in (ceiling, 4 x ceiling]: the long edge asked, applied by sharp's rule
    // (the short side is rounded), stays under the ceiling.
    for (const [w, h] of [[7000, 5000], [6000, 6600], [20000, 2000], [4000, 9999], [12345, 3001], [5001, 5000]]) {
      for (const ceiling of [25_000_000, 24_999_999, 1_000_000]) {
        const edge = longEdgeToFit({ width: w, height: h }, ceiling);
        if (w * h <= ceiling) {
          expect(edge).toBeNull();
          continue;
        }
        expect(edge).not.toBeNull();
        const long = Math.max(w, h);
        const short = Math.min(w, h);
        const newLong = edge as number;
        const newShort = Math.round((short * newLong) / long);
        expect(newLong * newShort).toBeLessThanOrEqual(ceiling);
        // and not absurdly small: within 1% of the ceiling in pixels
        expect(newLong * newShort).toBeGreaterThan(ceiling * 0.99);
      }
    }
  });

  it("a model path (its own long edge, nothing to fit) asks for its long edge; a storage path with both asks for the smaller", async () => {
    await encodeOriented("model", freshOwner(), img("a"), { format: "jpeg", quality: 85 }, { maxLongEdge: 1568, maxOutputBytes: 1_000_000, fitInPixels: null });
    expect(state.lastLongEdge).toBe(1568);
    await encodeOriented("strip", freshOwner(), img("a"), { format: "png" }, { maxLongEdge: 1568, maxOutputBytes: 1_000_000, fitInPixels: 50 });
    expect(state.lastLongEdge).toBe(6);
  });

  it("the same output passes a destination that takes it (the ceilings are per path)", async () => {
    state.outputBytes = 10 * 1024 * 1024 + 1;
    await expect(
      stripArchivedPhotoMetadata(freshOwner(), img("a"), "image/jpeg", { maxOutputBytes: 32 * 1024 * 1024, fitInPixels: 25_000_000 }),
    ).resolves.toHaveLength(10 * 1024 * 1024 + 1);
  });
});
