import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { Toast } from "@/components/Toast";

const render = (type: "success" | "error" | "zodError" | null, message: string) =>
  renderToStaticMarkup(createElement(Toast, { type, message }));

describe("Toast", () => {
  it("renders its live region from the first (server) render, even without a message", () => {
    expect(render(null, "")).toContain('aria-live="polite"');
  });

  it("announces an error assertively and exactly once", () => {
    const html = render("error", "Une entreprise avec cet email existe déjà");
    expect(html).toContain('aria-live="assertive"');
    expect(html.split("Une entreprise avec cet email existe déjà").length - 1).toBe(1);
  });

  it("announces a success politely", () => {
    expect(render("success", "Enregistré")).toContain('aria-live="polite"');
  });

  it("does not render the floating copy on the server (portal is client-only)", () => {
    expect(render("error", "x")).not.toContain("fixed");
  });

  it("keeps one z-index above the modals' z-50, defined once", () => {
    const src = readFileSync("components/Toast.tsx", "utf8");
    expect(src.match(/z-60/g)).toHaveLength(1);
    expect(src).toContain("createPortal(");
  });
});
