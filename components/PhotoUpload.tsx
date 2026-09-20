"use client";

import { useState, useRef } from "react";
import { UserCircleIcon } from "@heroicons/react/24/solid";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";

type PhotoUploadProps = {
  name?: string;
  defaultUrl?: string | null;
  /** Narrows the OS file picker's filter — a UX nicety only, never the real
   * enforcement (the server always sniffs actual bytes, never this or the
   * client-declared `file.type`). Defaults to every format the broadest
   * upload paths (client photo, logo, réserve photo) accept; a narrower
   * caller (e.g. forms/AddEquipmentForm.tsx, whose server action refuses
   * HEIC/AVIF/BMP/TIFF — lib/cloudinary.ts::uploadEquipmentPhoto) passes its
   * own. */
  accept?: string;
  /** Client-side pre-check only, in bytes — keep in sync with whichever
   * server-side ceiling the caller's action actually enforces (this file
   * can't import lib/cloudinary.ts's own constant: it's a server module that
   * configures the Cloudinary SDK at import time). Defaults to 5 MB, the
   * ceiling shared by every current caller except the equipment photo path
   * (10 MB, lib/cloudinary.ts::MAX_EQUIPMENT_PHOTO_BYTES), which passes its
   * own. */
  maxBytes?: number;
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export function PhotoUpload({ name = "photo", defaultUrl, accept = "image/*", maxBytes = DEFAULT_MAX_BYTES }: PhotoUploadProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<string | null>(defaultUrl ?? null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError(t.photoUpload.mustBeImage);
      e.target.value = "";
      return;
    }
    if (file.size > maxBytes) {
      setError(format(t.photoUpload.maxSize, { max: maxBytes / (1024 * 1024) }));
      e.target.value = "";
      return;
    }

    setError(null);
    setRemoved(false);
    setPreview(URL.createObjectURL(file));
  }

  function handleRemove() {
    setError(null);
    setPreview(null);
    setRemoved(true);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="mb-7 flex flex-col items-center gap-3">
      <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={t.photoUpload.previewAlt} className="w-full h-full object-cover" />
        ) : (
          <UserCircleIcon className="w-24 h-24 text-gray-400 dark:text-gray-500" />
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        name={name}
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />
      {/* Signals an explicit removal so the server drops the stored photo. */}
      <input type="hidden" name="removePhoto" value={removed ? "true" : "false"} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
        >
          {preview ? t.photoUpload.changePhoto : t.photoUpload.addPhoto}
        </button>
        {preview && (
          <button
            type="button"
            onClick={handleRemove}
            className="px-4 py-2 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 cursor-pointer"
          >
            {t.photoUpload.remove}
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-400" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
