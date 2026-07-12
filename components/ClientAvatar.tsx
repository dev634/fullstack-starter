"use client";

import { useState } from "react";
import Image from "next/image";
import { optimizedClientPhoto } from "@/lib/cloudinary-url";
import { useTranslation } from "@/components/LocaleProvider";

type ClientAvatarProps = {
  photoUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Rendered pixel size of the circle. */
  size: number;
  className?: string;
};

/**
 * Circular client avatar. Renders the Cloudinary photo when available and
 * falls back to initials if there is no photo — or if the image fails to
 * load (e.g. a deleted/expired asset).
 */
export default function ClientAvatar({
  photoUrl,
  firstName,
  lastName,
  size,
  className = "",
}: ClientAvatarProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const initials =
    `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "?";
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
      alt={`${firstName ?? ""} ${lastName ?? ""}`.trim() || t.clients.list.title}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={box}
      className={`shrink-0 rounded-full object-cover ${className}`}
    />
  );
}
