import { describe, it, expect, vi } from "vitest";
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
  it("relays the message of the application's own shapes (an object with a string `type`)", () => {
    expect(getErrorMessage({ type: "error", message: "boom" }, "fallback")).toBe("boom");
    expect(getErrorMessage({ type: "zodError", message: "invalid" }, "fallback")).toBe("invalid");
    expect(getErrorMessage({ type: "databaseError", message: "dup" }, "fallback")).toBe("dup");
    expect(getErrorMessage({ type: "duplicate", message: "exists" }, "fallback")).toBe("exists");
  });

  it("falls back when the message is missing, not a string, or the object is not an application shape", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getErrorMessage({ type: "error" }, "fallback")).toBe("fallback");
    expect(getErrorMessage({ type: "error", message: 42 }, "fallback")).toBe("fallback");
    expect(getErrorMessage({ message: "no type" }, "fallback")).toBe("fallback");
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage("nope", "fallback")).toBe("fallback");
    errorSpy.mockRestore();
  });

  // Point 2 (fix/televersements): a native Error's message comes from a library
  // or a bug and used to be relayed verbatim to the screen.
  describe("a native Error never reaches the screen", () => {
    const t = getDictionary("fr");
    const natives: Array<[string, Error]> = [
      ["Cloudinary SDK, missing key", new Error("Must supply api_key")],
      ["Cloudinary SDK, missing cloud name", new Error("Must supply cloud_name in tag or in configuration")],
      ["Prisma-style message", new Error("Invalid `prisma.user.findMany()` invocation: connect ECONNREFUSED 10.0.0.5:5432")],
      ["TypeError from a bug", new TypeError("Cannot read properties of undefined (reading 'x')")],
      ["an Error that carries a type like ours", Object.assign(new Error("native but typed"), { type: "error" })],
    ];

    it.each(natives)("%s gets the fallback, with or without a dictionary, and the cause is logged", (_label, error) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(getErrorMessage(error, "fallback")).toBe("fallback");
      expect(getErrorMessage(error, "fallback", t)).toBe("fallback");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("native error"), error);
      errorSpy.mockRestore();
    });

    it("keeps resolving an application i18n code (uploadFailed) to its translation", () => {
      const refusal = { type: "error", message: "Failed to upload the logo. Please try again.", i18n: "uploadFailed" };
      expect(getErrorMessage(refusal, "fallback", t)).toBe(t.errors.uploadFailed);
      expect(getErrorMessage(refusal, "fallback", t)).not.toContain("Failed to upload");
    });
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

    it("translates the 'decode queue is full, try again' refusal in both languages", () => {
      const error = { type: "error", message: "The server is already processing images. Try again in a moment.", i18n: "uploadBusy" };
      expect(getErrorMessage(error, "fallback", fr)).toBe(fr.errors.uploadBusy);
      expect(getErrorMessage(error, "fallback", getDictionary("en"))).toBe(getDictionary("en").errors.uploadBusy);
      expect(fr.errors.uploadBusy).not.toBe(fr.errors.uploadNotImage);
    });

    it("falls back to the raw English message when no dictionary is given", () => {
      const error = { type: "error", message: "The photo must be an image file.", i18n: "uploadNotImage" };
      expect(getErrorMessage(error, "fallback")).toBe("The photo must be an image file.");
    });
  });

  // Point 4 (revue "Prêts"): repository/equipmentLoans.ts::create throws this
  // i18n code for the "already lent" unique-constraint conflict — resolved
  // from t.loans.messages, not t.errors like the upload codes above, since
  // that's where this message already lived.
  describe("'already lent' error (repository/equipmentLoans.ts's stable i18n code)", () => {
    const fr = getDictionary("fr");

    it("translates it from t.loans.messages, given the dictionary", () => {
      const error = { type: "error", message: "This equipment is already lent out.", i18n: "alreadyLent" };
      expect(getErrorMessage(error, "fallback", fr)).toBe(fr.loans.messages.alreadyLent);
    });

    it("falls back to the raw English message when no dictionary is given", () => {
      const error = { type: "error", message: "This equipment is already lent out.", i18n: "alreadyLent" };
      expect(getErrorMessage(error, "fallback")).toBe("This equipment is already lent out.");
    });
  });

  // Point 8 (revue "Prêts"): lib/cloudinary.ts::uploadEquipmentPhoto refuses
  // HEIC/AVIF/BMP/TIFF with this code — resolved from t.equipment.messages,
  // like alreadyLent above, not t.errors.
  describe("equipment photo unsupported-format error (lib/cloudinary.ts's stable i18n code)", () => {
    const fr = getDictionary("fr");

    it("translates it from t.equipment.messages, given the dictionary", () => {
      const error = { type: "error", message: "Accepted formats: JPEG, PNG, WebP, GIF.", i18n: "equipmentPhotoUnsupportedFormat" };
      expect(getErrorMessage(error, "fallback", fr)).toBe(fr.equipment.messages.unsupportedPhotoFormat);
    });
  });
});
