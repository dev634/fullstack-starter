import { describe, it, expect, vi, beforeEach } from "vitest";

// sharp is replaced by a fake that counts how many decodes are in flight at once: a real
// sharp cannot be observed from the outside. What is under test is the queue in
// lib/imageMetadata.ts, not sharp.
const state = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  started: [] as string[],
  finished: [] as string[],
  failFor: new Set<string>(),
}));

vi.mock("sharp", () => {
  function fakeSharp(buffer: Buffer) {
    const id = buffer.toString();
    const pipeline = {
      rotate: () => pipeline,
      jpeg: () => pipeline,
      png: () => pipeline,
      webp: () => pipeline,
      gif: () => pipeline,
      toBuffer: async () => {
        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        state.started.push(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        state.inFlight -= 1;
        state.finished.push(id);
        if (state.failFor.has(id)) throw new Error("decode failed");
        return Buffer.from(`out-${id}`);
      },
    };
    return pipeline;
  }
  return { default: fakeSharp };
});

import { stripArchivedPhotoMetadata, convertToStrippedJpeg } from "@/lib/imageMetadata";

beforeEach(() => {
  state.inFlight = 0;
  state.maxInFlight = 0;
  state.started = [];
  state.finished = [];
  state.failFor = new Set();
});

describe("lib/imageMetadata — one sharp decode at a time", () => {
  it("N simultaneous calls never have more than one decode in flight, all complete, in call order", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const results = await Promise.all(ids.map((id) => stripArchivedPhotoMetadata(Buffer.from(id), "image/jpeg")));
    expect(results.map((r) => r.toString())).toEqual(ids.map((id) => `out-${id}`));
    expect(state.maxInFlight).toBe(1);
    expect(state.started).toEqual(ids);
    expect(state.finished).toEqual(ids);
  });

  it("the queue is shared by the in-place stripper and the AVIF/TIFF converter", async () => {
    await Promise.all([
      stripArchivedPhotoMetadata(Buffer.from("x"), "image/png"),
      convertToStrippedJpeg(Buffer.from("y")),
      stripArchivedPhotoMetadata(Buffer.from("z"), "image/webp"),
      convertToStrippedJpeg(Buffer.from("w")),
    ]);
    expect(state.maxInFlight).toBe(1);
    expect(state.started).toEqual(["x", "y", "z", "w"]);
  });

  it("an error in one call is reported to ITS caller only and does not block the queue", async () => {
    state.failFor.add("bad");
    const settled = await Promise.allSettled([
      stripArchivedPhotoMetadata(Buffer.from("one"), "image/jpeg"),
      stripArchivedPhotoMetadata(Buffer.from("bad"), "image/jpeg"),
      convertToStrippedJpeg(Buffer.from("bad")),
      stripArchivedPhotoMetadata(Buffer.from("two"), "image/jpeg"),
    ]);
    expect(settled[0]).toMatchObject({ status: "fulfilled" });
    expect(settled[1]).toMatchObject({ status: "rejected", reason: { type: "error", code: "corruptedImage" } });
    expect(settled[2]).toMatchObject({ status: "rejected", reason: { type: "error", code: "corruptedImage" } });
    expect(settled[3]).toMatchObject({ status: "fulfilled" });
    expect(state.maxInFlight).toBe(1);
    expect(state.finished).toEqual(["one", "bad", "bad", "two"]);
  });
});
