import { isRateLimited, registerFailure, type RateLimitOptions } from "@/lib/rate-limit";

/**
 * Per-account budget for the two photo paths that DECODE with sharp: the company
 * photo (uploadClientPhoto) and the equipment photo (uploadEquipmentPhoto),
 * counted together. lib/imageMetadata.ts bounds the memory with ONE queue of 8
 * waiting places for the whole process; nothing bounded WHO fills it, so one
 * account looping on these two actions could make every other account's photo
 * refuse with `imageBusy`.
 *
 * 30 photos per 15 minutes. Why this number: an ADMIN keying several companies
 * one after another picks a file, fills a form and submits — well over half a
 * minute each, so about 20 per quarter hour at the very fastest, and a company
 * plus its equipment photos in the same sitting stays under 30. The limit
 * leaves that sitting untouched and caps a loop at 2 decodes per minute,
 * sustained. It does NOT cap a burst: 30 concurrent requests all pass the check
 * before any is counted (the same narrow window as the scan's quota, see
 * actions/deliveryNoteScan/deliveryNoteScan.ts), and only the 8-place queue
 * bounds a burst.
 *
 * Only a request that actually carries a photo file is counted: creating or
 * editing without one is never limited (the caller does not come here).
 */
export const PHOTO_UPLOAD_LIMIT: RateLimitOptions = { limit: 30, windowMs: 15 * 60 * 1000 };

/** One key per account, shared by both photo paths on purpose. */
export function photoUploadKey(email: string): string {
  return `photo-upload:${email}`;
}

/**
 * Reserves one photo for `email`, or throws the refusal (`i18n: "photoRateLimited"`,
 * resolved by getErrorMessage from t.errors with the delay in minutes) BEFORE
 * anything is decoded or uploaded. The budget is checked read-only first and the
 * attempt registered after, like the scan: a blocked caller who keeps retrying
 * must not keep re-registering, or the sliding window never empties.
 */
export async function reservePhotoUpload(email: string): Promise<void> {
  const key = photoUploadKey(email);
  const { limited, retryAfterMs } = await isRateLimited(key, PHOTO_UPLOAD_LIMIT);
  if (limited) {
    throw {
      type: "error",
      message: "Too many photos sent. Try again later.",
      i18n: "photoRateLimited",
      i18nParams: { minutes: Math.max(1, Math.ceil(retryAfterMs / 60000)) },
    };
  }
  await registerFailure(key);
}
