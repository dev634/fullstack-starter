import { describe, it, expect } from "vitest";
import { formDataToObject, getErrorMessage } from "@/lib/helpers";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";

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

  // Passe 3a, point 4: repository functions throw `{ type: "repositoryError",
  // message: "Database Error ..." }` on an unexpected DB failure — an
  // internal, English-only diagnostic (already console.log'd by the
  // repository itself), never meant to reach the end user. This used to
  // share the exact same `{ message }` shape as this app's own pre-localized
  // errors (e.g. `throw { type: "error", message: t.materials.messages.invalidId }`)
  // and got relayed verbatim by the check above, which is how a raw English
  // "Database Error creating material." ended up in a French UI.
  it("never relays a repository-thrown DB error's internal message — always the caller's own fallback", () => {
    expect(
      getErrorMessage({ type: "repositoryError", message: "Database Error creating material." }, "fallback")
    ).toBe("fallback");
  });

  it("still relays a pre-localized action-layer error (type: \"error\", message already a dictionary string)", () => {
    expect(getErrorMessage({ type: "error", message: "Identifiant de matériel invalide." }, "fallback")).toBe(
      "Identifiant de matériel invalide."
    );
  });

  // fix/blocked-legitimate-input, point 3: lib/cloudinary.ts's 17 upload
  // throws carry a stable `i18n` code alongside their English `.message` —
  // the same relay-verbatim bug as the repository case above, just for the
  // app's most frequent upload errors instead of a DB failure.
  describe("upload-validation error (lib/cloudinary.ts's stable i18n code)", () => {
    const fr = getDictionary("fr");

    it("translates a too-large upload with its actual size limit, given the dictionary", () => {
      const error = { type: "error", message: "The photo must be 5 MB or smaller.", i18n: "uploadTooLarge", i18nParams: { max: 5 } };
      expect(getErrorMessage(error, "fallback", fr)).toBe(format(fr.errors.uploadTooLarge, { max: 5 }));
    });

    it("translates a not-an-image upload", () => {
      const error = { type: "error", message: "The photo must be an image file.", i18n: "uploadNotImage" };
      expect(getErrorMessage(error, "fallback", fr)).toBe(fr.errors.uploadNotImage);
    });

    it("falls back to the raw English message when no dictionary is given", () => {
      const error = { type: "error", message: "The photo must be an image file.", i18n: "uploadNotImage" };
      expect(getErrorMessage(error, "fallback")).toBe("The photo must be an image file.");
    });
  });
});
