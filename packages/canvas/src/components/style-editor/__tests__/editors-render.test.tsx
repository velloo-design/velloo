import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StyleObjectEditor } from "../StyleObjectEditor.tsx";
import { SxStyleEditor } from "../SxStyleEditor.tsx";
import { TailwindStyleEditor } from "../TailwindStyleEditor.tsx";

const common = { screenId: "s", path: "0", debounceMs: 200 };

/**
 * Server-render each editor with a realistic value and assert it produces markup
 * — exercising the whole control tree (the engines, the section/field/box-model
 * primitives, lucide icons) for runtime errors that typecheck can't see.
 */
describe("style editors render", () => {
  test("TailwindStyleEditor", () => {
    const html = renderToStaticMarkup(
      <TailwindStyleEditor
        {...common}
        initialValue="flex items-center justify-between gap-2 p-4 bg-card rounded-lg border border-border text-sm font-medium md:flex-row shadow-sm"
      />,
    );
    expect(html).toContain("Layout");
    expect(html).toContain("Spacing");
    expect(html).toContain("Typography");
    expect(html).toContain("Classes");
    // the modeled classes plus the preserved variant/extra show as chips
    expect(html).toContain("md:flex-row");
    expect(html).toContain("shadow-sm");
  });

  test("SxStyleEditor", () => {
    const html = renderToStaticMarkup(
      <SxStyleEditor
        {...common}
        prop="sx"
        initialValue={{
          display: "flex",
          justifyContent: "space-between",
          gap: 2,
          p: 2,
          bgcolor: "background.paper",
          boxShadow: 3,
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
        }}
      />,
    );
    expect(html).toContain("Layout");
    expect(html).toContain("Additional sx");
    // the raw escape-hatch lists only the un-modeled props (& is HTML-escaped)
    expect(html).toContain("cursor");
    expect(html).toContain("&amp;:hover");
    // a modeled value drives a control, not a raw row
    expect(html).toContain("background.paper");
  });

  test("StyleObjectEditor", () => {
    const html = renderToStaticMarkup(
      <StyleObjectEditor
        {...common}
        prop="style"
        initialValue={{
          display: "flex",
          gap: 16,
          padding: 16,
          paddingRight: 24,
          backgroundColor: "var(--card)",
          fontSize: "0.875rem",
          lineHeight: 1.5,
        }}
      />,
    );
    expect(html).toContain("Box model");
    expect(html).toContain("Declarations");
    // declarations mirror the full object
    expect(html).toContain("paddingRight");
    expect(html).toContain("backgroundColor");
  });
});
