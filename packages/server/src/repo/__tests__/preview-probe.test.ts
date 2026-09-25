import { describe, expect, test } from "bun:test";
import type { RepoCatalog, RepoCatalogEntry } from "../catalog.ts";
import { pickProbe, probeVerdict } from "../preview-probe.ts";
import type { PreviewState } from "../stories.ts";

/**
 * The preview probe mounts one of the app's components to check the preview
 * entry. It must not blame the entry for a component that could only throw:
 * one whose call site passed code (`<AppNav items={navItems}>`), which the scan
 * records without that prop.
 */

function entry(id: string, states: PreviewState[], extra: Partial<RepoCatalogEntry> = {}) {
  return {
    id,
    name: id,
    identity: { importPath: `@/components/${id}`, exportName: id },
    key: `repo:${id}`,
    source: "local",
    family: id,
    props: [],
    acceptsChildren: false,
    states,
    provenance: [],
    styleProps: [],
    ...extra,
  } as RepoCatalogEntry;
}

const usage = (props: Record<string, unknown>, dropped?: string[]): PreviewState => ({
  name: "As used",
  props,
  source: "usage",
  ...(dropped ? { dropped } : {}),
});

const catalog = (entries: RepoCatalogEntry[]) => ({ entries }) as unknown as RepoCatalog;

describe("pickProbe", () => {
  test("a complete call site beats one that dropped props the app passes as code", () => {
    const nav = entry("AppNav", [usage({ title: "CRM" }, ["items"])]);
    const button = entry("Button", [usage({ children: "Save" })]);
    expect(pickProbe(catalog([nav, button]), undefined, undefined)?.id).toBe("Button");
  });

  test("falls back to an incomplete one when nothing else was used", () => {
    const nav = entry("AppNav", [usage({ title: "CRM" }, ["items"])]);
    expect(pickProbe(catalog([nav]), undefined, undefined)?.id).toBe("AppNav");
  });

  test("an explicit component wins", () => {
    const nav = entry("AppNav", [usage({}, ["items"])]);
    const button = entry("Button", [usage({ children: "Save" })]);
    expect(pickProbe(catalog([nav, button]), undefined, "AppNav")?.id).toBe("AppNav");
  });
});

describe("probeVerdict", () => {
  const base = {
    prior: "valid" as const,
    mounted: true,
    ownStatus: "unavailable",
    ownCode: "render-threw",
    wrapperError: false,
    dropped: [] as string[],
  };

  test("a clean mount proves the entry", () => {
    expect(probeVerdict({ ...base, ownStatus: "exact", ownCode: undefined })).toEqual({
      state: "valid",
      inconclusive: false,
    });
  });

  test("a throw from props it was never given is inconclusive, not failing", () => {
    expect(probeVerdict({ ...base, dropped: ["items"] })).toEqual({
      state: "valid",
      inconclusive: true,
    });
    expect(probeVerdict({ ...base, prior: "absent", dropped: ["items"] }).state).toBe("absent");
  });

  test("a throw with every prop supplied is the entry's problem", () => {
    expect(probeVerdict(base).state).toBe("failing");
  });

  test("a wrapper error is failing whatever the props", () => {
    expect(probeVerdict({ ...base, wrapperError: true, dropped: ["items"] }).state).toBe("failing");
  });

  test("no entry and a component that needs none stays absent", () => {
    expect(probeVerdict({ ...base, prior: "absent" }).state).toBe("absent");
  });
});
