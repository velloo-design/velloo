import { describe, expect, test } from "bun:test";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { ADAPTATION_MAP, replacementIds, strategyFor } from "../adaptation-map.ts";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/alert-dialog.tsx";
import { Calendar } from "../components/calendar.tsx";
import { Carousel, CarouselContent, CarouselItem } from "../components/carousel.tsx";
import { Chart } from "../components/chart.tsx";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../components/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/dropdown-menu.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../components/popover.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select.tsx";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../components/sheet.tsx";
import { Toaster } from "../components/sonner.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/tooltip.tsx";

const { createElement: h } = React;

/**
 * The adapter package's contract: every replacement module renders the
 * overlay/runtime-heavy component inline (no portal) and carries
 * `data-velloo-inline="true"` on the surface that would otherwise be
 * portaled. These tests pin that contract — react-dom/server gets us
 * the SSR'd HTML without needing jsdom.
 */

describe("adaptation map", () => {
  test("strategyFor returns passthrough by default", () => {
    expect(strategyFor("button").kind).toBe("passthrough");
    expect(strategyFor("a-component-that-doesnt-exist").kind).toBe("passthrough");
  });

  test("strategyFor returns replace for declared overlays", () => {
    expect(strategyFor("dialog").kind).toBe("replace");
    expect(strategyFor("popover").kind).toBe("replace");
    expect(strategyFor("dropdown-menu").kind).toBe("replace");
  });

  test("replacementIds enumerates every replace entry", () => {
    const ids = replacementIds();
    expect(ids).toContain("dialog");
    expect(ids).toContain("calendar");
    expect(ids).toContain("chart");
    expect(ids).toContain("sonner");
    // Every entry in the map with kind: replace shows up.
    const expected = Object.entries(ADAPTATION_MAP)
      .filter(([, s]) => s.kind === "replace")
      .map(([id]) => id)
      .sort();
    expect(ids).toEqual(expected);
  });
});

describe("overlay replacements render inline", () => {
  test("Dialog content lands in the SSR body, not behind a portal", () => {
    const html = renderToString(
      h(
        Dialog,
        null,
        h(DialogTrigger, null, "Open"),
        h(DialogContent, null, h(DialogTitle, null, "Heads up")),
      ),
    );
    expect(html).toContain("Heads up");
    expect(html).toContain('data-velloo-inline="true"');
    expect(html).toContain('data-state="open"');
  });

  test("AlertDialog renders inline with action + cancel", () => {
    const html = renderToString(
      h(
        AlertDialog,
        null,
        h(AlertDialogTrigger, null, "Delete"),
        h(AlertDialogContent, null, h(AlertDialogTitle, null, "Sure?")),
      ),
    );
    expect(html).toContain("Sure?");
    expect(html).toContain('data-velloo-inline="true"');
  });

  test("Sheet renders inline for the configured side", () => {
    const html = renderToString(
      h(
        Sheet,
        null,
        h(SheetTrigger, null, "Open"),
        h(SheetContent, { side: "right" }, h(SheetTitle, null, "Filters")),
      ),
    );
    expect(html).toContain("Filters");
    expect(html).toContain('data-side="right"');
  });

  test("Popover renders inline", () => {
    const html = renderToString(
      h(Popover, null, h(PopoverTrigger, null, "Trigger"), h(PopoverContent, null, "anchor body")),
    );
    expect(html).toContain("anchor body");
    expect(html).toContain('data-velloo-inline="true"');
  });

  test("DropdownMenu renders inline with item", () => {
    const html = renderToString(
      h(
        DropdownMenu,
        null,
        h(DropdownMenuTrigger, null, "Menu"),
        h(DropdownMenuContent, null, h(DropdownMenuItem, null, "Item 1")),
      ),
    );
    expect(html).toContain("Item 1");
    expect(html).toContain('data-velloo-inline="true"');
  });

  test("Tooltip renders inline (canvas-safe)", () => {
    const html = renderToString(
      h(
        TooltipProvider,
        null,
        h(Tooltip, null, h(TooltipTrigger, null, "Hover"), h(TooltipContent, null, "Tip text")),
      ),
    );
    expect(html).toContain("Tip text");
    expect(html).toContain('data-velloo-inline="true"');
  });

  test("Select trigger + content render inline, value preserves the selected label", () => {
    const html = renderToString(
      h(
        Select,
        null,
        h(SelectTrigger, null, h(SelectValue, null, "Free")),
        h(
          SelectContent,
          null,
          h(SelectItem, { value: "free", selected: true }, "Free"),
          h(SelectItem, { value: "pro" }, "Pro"),
        ),
      ),
    );
    expect(html).toContain("Free");
    expect(html).toContain('data-velloo-inline="true"');
  });
});

describe("Toaster", () => {
  test("renders a sample toast at the configured position", () => {
    const html = renderToString(h(Toaster, { position: "top-right" }));
    expect(html).toContain('data-slot="sonner-toaster"');
    expect(html).toContain("Sample toast preview.");
    // Position classes encode top-right placement.
    expect(html).toContain("top-4");
    expect(html).toContain("right-4");
  });
});

describe("static fakes mount", () => {
  test("Calendar mounts with a month selection", () => {
    const html = renderToString(h(Calendar, { month: "2026-05-01", selected: "2026-05-15" }));
    expect(html).toContain('data-slot="calendar"');
    expect(html).toContain("May");
    expect(html).toContain("2026");
    // Selected day uses bg-primary.
    expect(html).toContain("bg-primary");
  });

  test("Chart renders without throwing on zero data", () => {
    const html = renderToString(h(Chart, { kind: "bar", data: [] }));
    expect(html).toContain('data-slot="chart"');
  });

  test("Carousel mounts with one slide", () => {
    const html = renderToString(
      h(Carousel, null, h(CarouselContent, null, h(CarouselItem, null, "slide one"))),
    );
    expect(html).toContain("slide one");
  });
});
