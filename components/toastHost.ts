/**
 * Id of the single toast host rendered by app/layout.tsx. Plain module (no
 * "use client") so the server layout and the client Toast read the same value.
 * The host element itself — position and the app's highest z-index — lives
 * in app/layout.tsx, and only there.
 */
export const TOAST_HOST_ID = "toast-host";
