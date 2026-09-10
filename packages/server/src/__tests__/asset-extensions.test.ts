import { describe, expect, test } from "bun:test";
import { assetFilename, CAPTURE_ASSET_EXTENSIONS } from "@velloo/renderer";
import { isAllowedAssetExt } from "../fs.ts";

describe("capture asset naming", () => {
  test("appends an extension when the URL path has none", () => {
    // The reported failure: Bing serves images from `/th?id=…`, so the path's
    // last segment is a bare `th` and the asset store — which admits files by
    // extension — refused files velloo had written itself.
    expect(assetFilename("https://www.bing.com/th?id=OHR.Konark", "image/jpeg")).toBe("th.jpg");
    expect(assetFilename("https://cdn.test/hero?w=2000", "image/avif")).toBe("hero.avif");
  });

  test("leaves a name that already carries an accepted extension", () => {
    expect(assetFilename("https://cdn.test/logo.svg", "image/svg+xml")).toBe("logo.svg");
    expect(assetFilename("https://cdn.test/photo.jpeg", "image/jpeg")).toBe("photo.jpeg");
  });

  test("an extension on the path beats an unhelpful content type", () => {
    // Plenty of CDNs serve real images as octet-stream; dropping those would
    // trade one silent loss for another.
    expect(assetFilename("https://cdn.test/hero.png", "application/octet-stream")).toBe("hero.png");
    expect(assetFilename("https://cdn.test/hero.png", undefined)).toBe("hero.png");
  });

  test("tolerates a charset parameter and odd casing on the content type", () => {
    expect(assetFilename("https://cdn.test/th", "image/PNG; charset=binary")).toBe("th.png");
  });

  test("drops a type the asset store would refuse anyway", () => {
    expect(assetFilename("https://cdn.test/tracker", "text/html")).toBeNull();
    expect(assetFilename("https://cdn.test/beacon", undefined)).toBeNull();
  });

  test("every extension the capture writer can produce is one the store accepts", () => {
    // These two tables live in different packages — the renderer cannot import
    // the server's — so nothing but this assertion keeps them from drifting
    // back into "velloo rejects its own capture's files".
    for (const ext of Object.values(CAPTURE_ASSET_EXTENSIONS)) {
      expect(isAllowedAssetExt(`asset${ext}`)).toBe(true);
    }
  });
});
