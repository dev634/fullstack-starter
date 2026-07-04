import { describe, it, expect } from "vitest";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";

describe("formDataToObject", () => {
  it("keeps string entries", () => {
    const fd = new FormData();
    fd.set("firstName", "Alice");
    fd.set("email", "alice@example.com");
    expect(formDataToObject(fd)).toEqual({ firstName: "Alice", email: "alice@example.com" });
  });

  it("skips React Server Action internal fields ($-prefixed)", () => {
    const fd = new FormData();
    fd.set("name", "Bob");
    fd.set("$ACTION_ID", "abc");
    expect(formDataToObject(fd)).toEqual({ name: "Bob" });
  });

  it("skips non-string (File) values", () => {
    const fd = new FormData();
    fd.set("name", "Bob");
    fd.set("photo", new File(["x"], "p.png", { type: "image/png" }));
    expect(formDataToObject(fd)).toEqual({ name: "Bob" });
  });
});

describe("getErrorMessage", () => {
  it("reads a message off an error-like object", () => {
    expect(getErrorMessage({ message: "boom" }, "fallback")).toBe("boom");
  });

  it("falls back when there is no message", () => {
    expect(getErrorMessage(new Error(), "fallback")).toBe("");
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage("nope", "fallback")).toBe("fallback");
  });
});
