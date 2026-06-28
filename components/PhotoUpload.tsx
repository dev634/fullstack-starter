"use client";

import { useState, useRef } from "react";
import { UserCircleIcon } from "@heroicons/react/24/solid";

type PhotoUploadProps = {
  name?: string;
  defaultUrl?: string | null;
};

export function PhotoUpload({ name = "photo", defaultUrl }: PhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(defaultUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
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

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="px-4 py-2 bg-gray-700 text-gray-100 rounded hover:bg-gray-600 cursor-pointer"
      >
        {preview ? "Changer la photo" : "Ajouter une photo"}
      </button>
    </div>
  );
}
