import {
  convertToStrippedJpeg,
  MAX_ENCODED_OUTPUT_BYTES,
  SHARP_MAX_INPUT_PIXELS,
  stripArchivedPhotoMetadata,
  type DeliveryNoteMediaType,
  type StorageImageLimits,
} from "@/lib/imageMetadata";

// The decode API takes an OWNER (the account the guard resolved) and the limits of the path
// that calls it. Most tests are about the decode itself, not about whose it is or where it
// goes: they call it through these two wrappers, with a FRESH account per call (one task per
// account at a time, and a budget of decode time per account, would otherwise couple tests
// that run side by side) and limits that refuse nothing the decoder's own ceilings admit.
// Tests that ARE about the share of an account, or about a destination's ceilings, call
// lib/imageMetadata.ts directly.

let counter = 0;

/** A fresh account identifier: no state of any other test attaches to it. */
export function freshOwner(): string {
  counter += 1;
  return `account-${counter}@example.test`;
}

/** The limits of a destination that takes whatever the decoder's own ceilings admit. */
export const LENIENT_LIMITS: StorageImageLimits = {
  maxOutputBytes: MAX_ENCODED_OUTPUT_BYTES,
  maxPixels: SHARP_MAX_INPUT_PIXELS,
};

export function stripFor(buffer: Buffer, mediaType: DeliveryNoteMediaType, owner: string = freshOwner()): Promise<Buffer> {
  return stripArchivedPhotoMetadata(owner, buffer, mediaType, LENIENT_LIMITS);
}

export function convertFor(buffer: Buffer, owner: string = freshOwner()): Promise<Buffer> {
  return convertToStrippedJpeg(owner, buffer, LENIENT_LIMITS);
}
