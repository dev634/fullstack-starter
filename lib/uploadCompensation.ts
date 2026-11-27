import { destroyUploadedAsset, type GuardedAssetRef } from "@/lib/cloudinary";

/**
 * Compensation for a "upload, THEN write a row" sequence whose write fails: the
 * file this call uploaded is now an orphan at Cloudinary (public for the logo
 * and the company/equipment photos, retained data for the rest). ONE helper for
 * every such path, in place of one hand-written copy each.
 *
 * The scope is NARROW on purpose: pass ONLY the write to `writeWithCompensation`,
 * never the whole action. A failure AFTER a successful write (revalidatePath, a
 * log, the destruction of the previous asset) is not this helper's business, and
 * destroying then would break the image of a row that exists.
 */
export type UploadCompensation = {
  /** What was uploaded, for the logs ("logo", "client photo"…). */
  label: string;
  /** The public id of the uploaded asset: every log line of a compensation names it, so an orphan can be found by hand. */
  publicId: string;
  /**
   * Whether the failure PROVES the write did not happen (a validation refusal,
   * a unique-index refusal). Absent = nothing proves it: the repositories wrap
   * every database failure into one `repositoryError`, which cannot tell a
   * refused write from one that committed and lost its connection afterwards.
   */
  writeRefused?: (error: unknown) => boolean;
  /** Whether a row still points at the uploaded asset. Throws when it cannot tell. */
  isReferenced: () => Promise<boolean>;
  /** Destroys the uploaded asset. Reads Cloudinary's report and logs a non-confirmation itself. */
  destroy: () => Promise<void>;
};

/**
 * The compensation of a guarded-or-public asset known by what the upload
 * response reported (`publicId`, delivery `type`, `resource_type`): an
 * `authenticated` asset is not destroyed without its `type`, and `destroy` does
 * not say so — it no-ops.
 */
export function assetCompensation(
  label: string,
  asset: GuardedAssetRef,
  isReferenced: (publicId: string) => Promise<boolean>,
  writeRefused?: (error: unknown) => boolean
): UploadCompensation {
  return {
    label,
    publicId: asset.publicId,
    writeRefused,
    isReferenced: () => isReferenced(asset.publicId),
    destroy: () => destroyUploadedAsset(asset),
  };
}

/**
 * Runs `write`; when it fails, discards the uploaded asset (per the rules of
 * `discardAfterFailedWrite`) and rethrows the ORIGINAL error whatever the
 * discard did. A success destroys nothing. `undefined` (this call uploaded
 * nothing) just runs the write.
 */
export async function writeWithCompensation<T>(
  write: () => Promise<T>,
  compensation: UploadCompensation | undefined
): Promise<T> {
  try {
    return await write();
  } catch (writeError) {
    await discardAfterFailedWrite(compensation, writeError);
    throw writeError;
  }
}

/**
 * For a caller that must read the write's RESULT in a returned state (the
 * Server Action return guard cannot follow it through a callback): wrap the
 * write in its own try/catch, call this, rethrow.
 *
 * Destroys the asset without condition only when the failure proves the write
 * did not happen. On ANY other error the write may have been committed anyway:
 * the asset is then destroyed only when no row references it, and when that
 * read fails too it is KEPT and the case is logged — one file too many rather
 * than a broken image. Never throws: a destruction (or a read) that fails must
 * neither mask the original refusal nor turn it into a success.
 */
export async function discardAfterFailedWrite(
  compensation: UploadCompensation | undefined,
  writeError: unknown
): Promise<void> {
  if (!compensation) return;
  if (!compensation.writeRefused?.(writeError)) {
    try {
      if (await compensation.isReferenced()) return;
    } catch (readError) {
      console.error(
        `Compensation skipped: could not tell whether the uploaded ${compensation.label} "${compensation.publicId}" is still referenced, kept:`,
        readError
      );
      return;
    }
  }
  try {
    await compensation.destroy();
  } catch (destroyError) {
    console.error(
      `Compensation failed: could not destroy the orphaned ${compensation.label} "${compensation.publicId}":`,
      destroyError
    );
  }
}
