import { describe, it, expect } from "vitest";
import { updateAppSettingsSchema } from "@/schemas/appSettings";

describe("updateAppSettingsSchema", () => {
  it("accepts valid 6-digit hex colors", () => {
    const result = updateAppSettingsSchema.safeParse({
      appName: "Acme",
      primaryColor: "#3b82f6",
      accentColor: "#8B5CF6",
    });
    expect(result.success).toBe(true);
  });

  it.each(["blue", "#fff", "#3b82f6ff", "3b82f6", "rgb(0,0,0)", "javascript:alert(1)"])(
    "rejects %s as a color",
    (value) => {
      const result = updateAppSettingsSchema.safeParse({
        appName: "Acme",
        primaryColor: value,
        accentColor: "#8b5cf6",
      });
      expect(result.success).toBe(false);
    }
  );

  it("rejects an empty app name", () => {
    const result = updateAppSettingsSchema.safeParse({
      appName: "",
      primaryColor: "#3b82f6",
      accentColor: "#8b5cf6",
    });
    expect(result.success).toBe(false);
  });
});
