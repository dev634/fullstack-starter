import { describe, it, expect } from "vitest";
import { dateColumn } from "@/lib/partialWrite";
import { quantityTargetPatch } from "@/lib/taskQuantity";

describe("dateColumn", () => {
  it("absent -> undefined (left alone), null -> null (cleared), a string -> a Date", () => {
    expect(dateColumn(undefined)).toBeUndefined();
    expect(dateColumn(null)).toBeNull();
    expect(dateColumn("2026-06-01")).toEqual(new Date("2026-06-01"));
    expect(dateColumn("2026-08-01T07:30:00.000Z")).toEqual(new Date("2026-08-01T07:30:00.000Z"));
  });
});

describe("quantityTargetPatch", () => {
  const plain = { quantityTarget: null, quantityDone: null, done: false };
  const tracked = { quantityTarget: 10, quantityDone: 4, done: false };

  it("target absent -> an empty patch: nothing about the quantity is touched", () => {
    expect(quantityTargetPatch(tracked, undefined)).toEqual({});
    expect(quantityTargetPatch(plain, undefined)).toEqual({});
  });

  it("target null -> back to a plain checkbox; `done` is not part of the patch", () => {
    const patch = quantityTargetPatch(tracked, null);
    expect(patch).toEqual({ quantityTarget: null, quantityDone: null });
    expect("done" in patch).toBe(false);
  });

  it("target a number -> re-clamps the progress and syncs done", () => {
    expect(quantityTargetPatch(tracked, 20)).toEqual({ quantityTarget: 20, quantityDone: 4, done: false });
    expect(quantityTargetPatch(tracked, 3)).toEqual({ quantityTarget: 3, quantityDone: 3, done: true });
  });

  it("turning tracking on starts from the task's done state, not from 0", () => {
    expect(quantityTargetPatch({ ...plain, done: true }, 5)).toEqual({ quantityTarget: 5, quantityDone: 5, done: true });
    expect(quantityTargetPatch(plain, 5)).toEqual({ quantityTarget: 5, quantityDone: 0, done: false });
  });

  it("degenerate row: tracked task whose quantityDone is null reads as 0", () => {
    expect(quantityTargetPatch({ quantityTarget: 10, quantityDone: null, done: false }, 10)).toEqual({ quantityTarget: 10, quantityDone: 0, done: false });
  });
});
