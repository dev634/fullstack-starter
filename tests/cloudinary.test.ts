import { describe, it, expect } from "vitest";
import { publicIdFromUrl, optimizedClientPhoto } from "@/lib/cloudinary";

const URL_WITH_VERSION =
  "https://res.cloudinary.com/demo/image/upload/v1699999999/clients/abcd1234.png";

describe("publicIdFromUrl", () => {
  it("extracts the public id when a version is present", () => {
    expect(publicIdFromUrl(URL_WITH_VERSION)).toBe("clients/abcd1234");
  });

  it("extracts the public id without a version segment", () => {
    expect(
      publicIdFromUrl("https://res.cloudinary.com/demo/image/upload/clients/abc.jpg")
    ).toBe("clients/abc");
  });

  it("returns null for a non-matching string", () => {
    expect(publicIdFromUrl("not a url")).toBeNull();
  });
});

describe("optimizedClientPhoto", () => {
  it("injects the transform right after /upload/", () => {
    expect(optimizedClientPhoto(URL_WITH_VERSION, 96)).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_fill,g_face,w_96,h_96/v1699999999/clients/abcd1234.png"
    );
  });

  it("leaves non-Cloudinary urls unchanged", () => {
    expect(optimizedClientPhoto("https://example.com/x.png")).toBe("https://example.com/x.png");
  });
});
