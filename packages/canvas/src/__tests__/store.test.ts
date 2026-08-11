import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Page } from "@velloo/schema";
import type { DesignSummary } from "../api.ts";
import { useCanvas } from "../store.ts";

const designSummary: DesignSummary = {
  snapshotVersion: "test",
  theme: { name: "default" },
  pages: [
    {
      id: "onboarding",
      name: "Onboarding",
      variants: [{ id: "mobile", name: "Mobile", viewport: { w: 390, h: 844 } }],
    },
  ],
};

const page: Page = {
  name: "Onboarding",
  variants: [
    {
      id: "mobile",
      name: "Mobile",
      viewport: { w: 390, h: 844 },
      tree: { $ref: "Card" },
    },
  ],
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  useCanvas.setState({
    design: null,
    currentPageId: null,
    currentPage: null,
    selection: null,
    hover: null,
    wsConnected: false,
  });
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/design")) return Response.json(designSummary);
    if (url.includes("/api/page/")) return Response.json(page);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("canvas store", () => {
  test("loadDesign hydrates design and auto-selects first page", async () => {
    await useCanvas.getState().loadDesign();
    const s = useCanvas.getState();
    expect(s.design?.pages).toHaveLength(1);
    expect(s.currentPageId).toBe("onboarding");
    expect(s.currentPage?.name).toBe("Onboarding");
  });

  test("setSelection / setHover roundtrip", () => {
    const sel = { variantId: "mobile", path: "0.1" };
    useCanvas.getState().setSelection(sel);
    expect(useCanvas.getState().selection).toEqual(sel);
    useCanvas.getState().setSelection(null);
    expect(useCanvas.getState().selection).toBeNull();
  });

  test("selectPage clears selection on switch", async () => {
    await useCanvas.getState().loadDesign();
    useCanvas.getState().setSelection({ variantId: "mobile", path: "0" });
    await useCanvas.getState().selectPage("onboarding");
    expect(useCanvas.getState().selection).toBeNull();
  });
});
