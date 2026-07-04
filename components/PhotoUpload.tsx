"use client";

import { useState, useRef } from "react";
import { UserCircleIcon } from "@heroicons/react/24/solid";

type PhotoUploadProps = {
  name?: string;
  defaultUrl?: string | null;
};

const MAX_BYTES = 5 * 1024 * 1024; // keep in sync with the server-side limit

export function PhotoUpload({ name = "photo", defaultUrl }: PhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(defaultUrl ?? null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Le fichier doit être une image.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("L'image doit faire 5 Mo maximum.");
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
      <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-700 flex items-center justify-center">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Aperçu de la photo" className="w-full h-full object-cover" />
        ) : (
          <UserCircleIcon className="w-24 h-24 text-gray-500" />
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
      {/* Signals an explicit removal so the server drops the stored photo. */}
      <input type="hidden" name="removePhoto" value={removed ? "true" : "false"} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="px-4 py-2 bg-gray-700 text-gray-100 rounded hover:bg-gray-600 cursor-pointer"
        >
          {preview ? "Changer la photo" : "Ajouter une photo"}
        </button>
        {preview && (
          <button
            type="button"
            onClick={handleRemove}
            className="px-4 py-2 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 cursor-pointer"
          >
            Retirer
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
