import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen, Snippet } from "@velloo/schema";
import { emitModule } from "../emit-code/module.ts";
import { frameworkTarget } from "../emit-code/target.ts";
import { shadcnTarget } from "./shadcn-target.ts";

function screenOf(tree: Screen["tree"]): Screen {
  return { id: "home", name: "Home", tree };
}

const statCard: Snippet = {
  id: "stat-card",
  name: "Stat card",
  params: [
    { name: "label", type: "string" },
    { name: "value", type: "string", default: "0" },
    { name: "badge", type: "node", optional: true },
  ],
  tree: {
    $ref: "Card",
    props: { className: "p-4" },
    children: [
      { $ref: "Text", props: { children: { $param: "label" } } },
      { $ref: "Heading", props: { level: 3, children: { $param: "value" } } },
      { $param: "badge" },
    ],
  },
};

describe("emitModule", () => {
  test("a screen becomes a module: its imports, its snippets as components, the page", async () => {
    const screen = screenOf({
      $ref: "Box",
      props: { className: "grid gap-4" },
      children: [
        { $ref: "Button", props: { variant: "outline", children: "Export" } },
        { $ref: "Icon", props: { name: "trending-up" } },
        {
          $snippet: "stat-card",
          args: { label: "Revenue", value: "$48k" },
          $extraClassName: "mt-2",
        },
        {
          $ref: "Spark",
          $repo: { importPath: "./src/charts/Spark", exportName: "default" },
          props: {},
        },
      ],
    });
    const { source, imports, ir } = unwrap(
      await emitModule(screen, {
        target: shadcnTarget(),
        snippets: new Map([[statCard.id, statCard]]),
        name: "Dashboard",
        typescript: true,
        fromAppRoot: (specifier) => specifier.replace("./src/", "../"),
      }),
    );
    expect(imports).toEqual([
      "lucide-react",
      "@/components/ui/button",
      "@/components/ui/card",
      "../charts/Spark",
    ]);
    expect(source).toContain('import type { ReactNode } from "react";');
    expect(source).toContain('import { TrendingUp } from "lucide-react";');
    expect(source).toContain('import { Button } from "@/components/ui/button";');
    expect(source).toContain('import { Card } from "@/components/ui/card";');
    expect(source).toContain('import Spark from "../charts/Spark";');
    // Typed from the snippet's params; an instance's extra classes land on its root.
    expect(source).toContain(
      'function StatCard({ label, value = "0", badge, className }: { label: string; value?: string; badge?: ReactNode; className?: string }) {',
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the emitted code is the template
    expect(source).toContain('<Card className={`p-4 ${className ?? ""}`}>');
    expect(source).toContain("export default function Dashboard() {\n  return (\n    <div");
    expect(source).toContain('    <StatCard label="Revenue" value="$48k" className="mt-2" />');
    expect(source.endsWith("  );\n}\n")).toBe(true);
    // The page body is the IR's own JSX, indented — nothing emitted twice over.
    expect(source).toContain(ir.jsx.split("\n").at(-1) ?? "");
  });

  test("plain JavaScript takes no types, and a named export when the file had one", async () => {
    const screen = screenOf({
      $ref: "Box",
      props: {},
      children: [{ $snippet: "stat-card", args: { label: "Churn" } }],
    });
    const { source } = unwrap(
      await emitModule(screen, {
        target: shadcnTarget(),
        snippets: new Map([[statCard.id, statCard]]),
        name: "Reports",
        defaultExport: false,
      }),
    );
    expect(source).not.toContain("ReactNode");
    expect(source).toContain('function StatCard({ label, value = "0", badge }) {');
    expect(source).toContain("export function Reports() {");
  });

  test("a library installed as a package imports through its root export", async () => {
    const antd = frameworkTarget([
      { id: "TypographyTitle", jsxName: "Typography.Title", module: "antd" },
      { id: "Button", module: "antd" },
    ]);
    const screen = screenOf({
      $ref: "Box",
      props: {},
      children: [
        { $ref: "TypographyTitle", props: { children: "Queue" } },
        { $ref: "Button", props: { children: "Run" } },
      ],
    });
    const { source, imports } = unwrap(await emitModule(screen, { target: antd, name: "Queue" }));
    expect(imports).toEqual(["antd"]);
    expect(source).toContain('import { Button, Typography } from "antd";');
  });

  test("a screen with nothing to import is just the component", async () => {
    const screen = screenOf({ $ref: "Box", props: { className: "p-8" }, children: [] });
    const { source, imports } = unwrap(await emitModule(screen, { name: "Empty" }));
    expect(imports).toEqual([]);
    expect(source.startsWith("export default function Empty() {")).toBe(true);
  });
});

describe("emitModule — icons for an app without lucide-react", () => {
  test("each icon is a component in the module, taking the props lucide-react's does", async () => {
    const screen = screenOf({
      $ref: "Box",
      props: {},
      children: [
        { $ref: "Icon", props: { name: "trending-up" } },
        { $ref: "Icon", props: { name: "Search", className: "size-5 text-muted-foreground" } },
      ],
    });
    const { source, imports } = unwrap(
      await emitModule(screen, { name: "Page", inlineIcons: true }),
    );
    expect(imports).toEqual([]);
    expect(source).not.toContain("import");
    expect(source).toContain("function TrendingUp({ size = 24, ...props }) {");
    expect(source).toContain('<path d="M16 7h6v6" />');
    expect(source).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"',
    );
    expect(source).toContain("strokeWidth={2}");
    // The design's own sizing reaches the svg exactly as it would lucide's.
    expect(source).toContain("<TrendingUp size={16} />");
    expect(source).toContain('<Search className="size-5 text-muted-foreground" />');
  });
});
