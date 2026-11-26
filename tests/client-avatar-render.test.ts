import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Only the dictionary hook is replaced: next/image itself is the real one, because what is
// under test is the `src` it renders.
vi.mock("@/components/LocaleProvider", () => ({
  useTranslation: () => ({ t: { clients: { list: { title: "Entreprises" } } } }),
}));

import ClientAvatar from "@/components/ClientAvatar";
import { optimizedClientPhoto } from "@/lib/cloudinary-url";

const PHOTO = "https://res.cloudinary.com/demo/image/upload/v1/clients/photo.jpg";

describe("ClientAvatar — the image goes straight to Cloudinary, never through /_next/image", () => {
  const html = renderToStaticMarkup(createElement(ClientAvatar, { photoUrl: PHOTO, name: "Acme", size: 40 }));
  const src = /<img[^>]*\ssrc="([^"]*)"/.exec(html)?.[1];

  it("renders an <img> whose src is the transformed Cloudinary URL", () => {
    expect(src).toBeDefined();
    // The attribute is HTML-escaped (& -> &amp;); compare on the decoded value.
    expect(src?.replaceAll("&amp;", "&")).toBe(optimizedClientPhoto(PHOTO, 80));
    expect(src?.startsWith("https://res.cloudinary.com/")).toBe(true);
    expect(src).toContain("f_auto");
  });

  it("never points at the optimizer, in src or srcset", () => {
    expect(html).not.toContain("/_next/image");
  });
});
