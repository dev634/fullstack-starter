import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/LocaleProvider", () => ({
  useTranslation: () => ({ t: { common: { close: "Fermer" } } }),
}));

import { Toast } from "@/components/Toast";
import type { ActionResultType } from "@/types/actionResult";

// renderToStaticMarkup is a SERVER render: useIsClient() is false, so only the
// server markup is asserted here. The portalled banner, its close button, the
// 5 s expiry and the re-show on a new result are client behaviour, checked in
// the browser (no jsdom in this repo).
const render = (type: ActionResultType, message: string) =>
  renderToStaticMarkup(createElement(Toast, { type, message }));

describe("Toast, server markup", () => {
  it("renders both live regions from the first render, even without a message", () => {
    const html = render(null, "");
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-live="polite"');
  });

  it("puts an error in the assertive region only, once", () => {
    const html = render("error", "Mot de passe incorrect");
    const [assertive, polite] = html.split('aria-live="polite"');
    expect(assertive).toContain("Mot de passe incorrect");
    expect(polite).not.toContain("Mot de passe incorrect");
    expect(html.split("Mot de passe incorrect")).toHaveLength(2);
  });

  it("puts a success in the polite region only", () => {
    const [assertive, polite] = render("success", "Enregistré").split('aria-live="polite"');
    expect(assertive).not.toContain("Enregistré");
    expect(polite).toContain("Enregistré");
  });

  it("renders no visible banner on the server (the portal is client-only)", () => {
    expect(render("error", "x")).not.toContain("<button");
  });
});
