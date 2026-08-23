import { describe, it, expect } from "vitest";
import {
  resolveReserveStatusStyle,
  DEFAULT_RESERVE_STATUS_COLOR,
  type ReserveStatusStyleSource,
} from "@/lib/reserveStatusStyle";

const labels = { OPEN: "Ouverte", RESOLVED: "Levée" };

function project(over: Partial<ReserveStatusStyleSource> = {}): ReserveStatusStyleSource {
  return {
    reserveOpenLabel: null,
    reserveOpenColor: null,
    reserveResolvedLabel: null,
    reserveResolvedColor: null,
    ...over,
  };
}

describe("resolveReserveStatusStyle", () => {
  it("falls back to the i18n dictionary label and the default colour when nothing is configured", () => {
    const style = resolveReserveStatusStyle(project(), labels);
    expect(style).toEqual({
      open: { label: "Ouverte", color: DEFAULT_RESERVE_STATUS_COLOR.OPEN },
      resolved: { label: "Levée", color: DEFAULT_RESERVE_STATUS_COLOR.RESOLVED },
    });
  });

  it("uses the project's own label/colour when configured, per status independently", () => {
    const style = resolveReserveStatusStyle(
      project({ reserveOpenLabel: "À traiter", reserveOpenColor: "#ff8800" }),
      labels
    );
    expect(style.open).toEqual({ label: "À traiter", color: "#ff8800" });
    // The resolved status was left untouched — still the default.
    expect(style.resolved).toEqual({ label: "Levée", color: DEFAULT_RESERVE_STATUS_COLOR.RESOLVED });
  });

  it("resolves label and colour independently — a custom label with the default colour, and vice versa", () => {
    const customLabelOnly = resolveReserveStatusStyle(project({ reserveResolvedLabel: "Terminée" }), labels);
    expect(customLabelOnly.resolved).toEqual({ label: "Terminée", color: DEFAULT_RESERVE_STATUS_COLOR.RESOLVED });

    const customColorOnly = resolveReserveStatusStyle(project({ reserveResolvedColor: "#059669" }), labels);
    expect(customColorOnly.resolved).toEqual({ label: "Levée", color: "#059669" });
  });

  it("is the only place the default colour pair is defined — same object used for both statuses' fallback", () => {
    expect(DEFAULT_RESERVE_STATUS_COLOR).toEqual({ OPEN: "#e11d48", RESOLVED: "#16a34a" });
  });

  it("follows the given dictionary's locale for the fallback labels", () => {
    const en = resolveReserveStatusStyle(project(), { OPEN: "Open", RESOLVED: "Resolved" });
    expect(en.open.label).toBe("Open");
    expect(en.resolved.label).toBe("Resolved");
  });
});
