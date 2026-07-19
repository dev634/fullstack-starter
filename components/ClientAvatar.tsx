"use client";

import { useState } from "react";
import Image from "next/image";
import { optimizedClientPhoto } from "@/lib/cloudinary-url";
import { useTranslation } from "@/components/LocaleProvider";

type ClientAvatarProps = {
  photoUrl?: string | null;
  /** Organisation name — used for the initials fallback and the image alt. */
  name?: string | null;
  /** Rendered pixel size of the circle. */
  size: number;
  className?: string;
};

/** Initials from an organisation name: first letters of the first two words,
 * or the first two letters of a single-word name. */
function initialsFrom(name?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/**
 * Circular organisation avatar. Renders the Cloudinary photo when available and
 * falls back to initials if there is no photo — or if the image fails to
 * load (e.g. a deleted/expired asset).
 */
export default function ClientAvatar({
  photoUrl,
  name,
  size,
  className = "",
}: ClientAvatarProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const initials = initialsFrom(name);
  const box = { width: size, height: size };

  if (!photoUrl || failed) {
    return (
      <span
        style={box}
        className={`flex shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/20 font-semibold text-blue-700 dark:text-blue-300 ${className}`}
      >
        {initials}
      </span>
    );
  }

  return (
    <Image
      src={optimizedClientPhoto(photoUrl, size * 2)}
      alt={name?.trim() || t.clients.list.title}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={box}
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  );
}
