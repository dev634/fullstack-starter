import { describe, it, expect } from "vitest";
import { renderEmail, escapeHtml, safeUrl, type EmailBrand } from "@/lib/email/render";

const brand: EmailBrand = { name: "Devadn", primaryColor: "#3b82f6", logoUrl: null };

const base = {
  preview: "Aperçu",
  heading: "Titre",
  paragraphs: ["Premier paragraphe.", "Second paragraphe."],
};

describe("escapeHtml", () => {
  it("neutralises every character that could break out of markup", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
    expect(escapeHtml("Tom & Jerry's")).toBe("Tom &amp; Jerry&#39;s");
  });

  it("escapes the ampersand first, so escapes aren't double-encoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("safeUrl", () => {
  it("keeps http and https", () => {
    expect(safeUrl("https://devadn.com/reset?token=abc")).toContain("https://devadn.com/reset");
  });

  it("refuses javascript: and other schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>")).toBe("#");
    expect(safeUrl("not a url")).toBe("#");
  });
});

describe("renderEmail", () => {
  it("produces both an HTML and a plain-text body", () => {
    const { html, text } = renderEmail(brand, base);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Premier paragraphe.");
    expect(text).toContain("Premier paragraphe.");
    // The text part must carry no markup at all.
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("puts the CTA link in both bodies, so a text-only client can still act", () => {
    const url = "https://devadn.com/reset-password?token=abc123";
    const { html, text } = renderEmail(brand, { ...base, cta: { label: "Réinitialiser", url } });
    expect(html).toContain(url);
    expect(text).toContain(url);
    expect(text).toContain("Réinitialiser");
  });

  it("escapes content coming from user data", () => {
    // A réserve description or project name will end up in a notification body.
    const { html } = renderEmail(brand, {
      ...base,
      heading: `Réserve "<img src=x onerror=alert(1)>"`,
      paragraphs: [`<script>steal()</script>`],
    });
    expect(html).not.toContain("<script>steal()");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never emits a javascript: href from a poisoned CTA", () => {
    const { html } = renderEmail(brand, {
      ...base,
      cta: { label: "Clique", url: "javascript:alert(1)" },
    });
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  it("falls back to a safe colour when the configured one is not a hex value", () => {
    // primaryColor comes from app settings and lands inline in a style attribute.
    const { html } = renderEmail({ ...brand, primaryColor: "red; } body{display:none" }, {
      ...base,
      cta: { label: "Go", url: "https://devadn.com" },
    });
    // Target the injected payload itself — the hidden preheader legitimately
    // carries a display:none of its own.
    expect(html).not.toContain("body{display:none");
    expect(html).not.toContain("red;");
    expect(html).toContain("#3b82f6");
  });

  it("picks the CTA label colour from the button colour instead of assuming white", () => {
    const cta = { label: "Go", url: "https://devadn.com" };
    // The shipped default #3b82f6 is light enough that white on it reads at
    // 3.7:1 - below the 4.5:1 WCAG AA asks for this button's 15px bold label.
    // Black on the same blue clears it at 5.7:1.
    const light = renderEmail(brand, { ...base, cta });
    expect(light.html).toContain("background-color:#3b82f6");
    expect(light.html).toContain("color:#000000;text-decoration:none");

    // A dark brand colour keeps the white label the button always had.
    const dark = renderEmail({ ...brand, primaryColor: "#1e1b4b" }, { ...base, cta });
    expect(dark.html).toContain("background-color:#1e1b4b");
    expect(dark.html).toContain("color:#ffffff;text-decoration:none");
  });

  it("refuses a shorthand hex outright rather than painting a white label on a white button", () => {
    // Nothing writes shorthand today - schemas/appSettings.ts's hexColor is
    // strict 6-digit and app settings is the only writer - but the looser
    // 3-to-8-digit shape this used to accept would have passed #fff through
    // as the background while contrastTextColor rejected it and returned
    // white for the label on top.
    const { html } = renderEmail({ ...brand, primaryColor: "#fff" }, {
      ...base,
      cta: { label: "Go", url: "https://devadn.com" },
    });
    expect(html).toContain("background-color:#3b82f6");
    expect(html).toContain("color:#000000;text-decoration:none");
  });

  it("uses the logo when one is configured, and the wordmark otherwise", () => {
    const withLogo = renderEmail({ ...brand, logoUrl: "https://res.cloudinary.com/x/logo.png" }, base);
    expect(withLogo.html).toContain("<img src=");
    expect(withLogo.html).toContain("logo.png");

    const withoutLogo = renderEmail(brand, base);
    expect(withoutLogo.html).not.toContain("<img src=");
    expect(withoutLogo.html).toContain("Devadn");
  });

  it("includes a hidden preheader for the inbox preview line", () => {
    const { html } = renderEmail(brand, { ...base, preview: "Ceci apparait dans la liste" });
    expect(html).toContain("Ceci apparait dans la liste");
    expect(html).toMatch(/display:none[^>]*>Ceci apparait/);
  });
});
