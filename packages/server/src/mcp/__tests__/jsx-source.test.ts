import { describe, expect, test } from "bun:test";
import {
  ElementValue,
  readJsxSource,
  type SourceElement,
  SourceFailure,
  type SourceText,
} from "../jsx-source.ts";

/** The read tree as nested `[tag, props, ...children]`, text as strings. */
type Shape = string | [string | null, Record<string, unknown>, ...Shape[]];

function shape(node: SourceElement | SourceText): Shape {
  if (!("tag" in node)) return node.text;
  const props = Object.fromEntries(
    node.attributes.map((attribute) => [
      attribute.name,
      attribute.value instanceof ElementValue ? shape(attribute.value.element) : attribute.value,
    ]),
  );
  return [node.tag, props, ...node.children.map(shape)];
}

const read = (source: string, siblings = false): Shape =>
  shape(readJsxSource(source, { siblings }).root);

function failure(source: string): SourceFailure {
  try {
    readJsxSource(source);
  } catch (error) {
    if (error instanceof SourceFailure) return error;
    throw error;
  }
  throw new Error("expected the source to be refused");
}

describe("markup alone", () => {
  test("is read as written", () => {
    expect(read('<Card title="A" open count={3} style={{ gap: 4, }}>Hi</Card>')).toEqual([
      "Card",
      { title: "A", open: true, count: 3, style: { gap: 4 } },
      "Hi",
    ]);
  });

  test("several roots are siblings only where an append can take them", () => {
    expect(read("<A /><B />", true)).toEqual([null, {}, ["A", {}], ["B", {}]]);
    expect(failure("<A /><B />").message).toBe("Expected a single root element");
  });

  test("a comment holds nothing and a literal is its text", () => {
    expect(read('<A>{/* note */}{"x"}{42}{`y`}</A>')).toEqual(["A", {}, "x", "42", "y"]);
  });

  test("whitespace inside a tag's own punctuation is JSX's to allow", () => {
    expect(read("<A><B size={2}/ ><C>x</ C ></A>")).toEqual([
      "A",
      {},
      ["B", { size: 2 }],
      ["C", {}, "x"],
    ]);
  });

  test("a nested fragment is its children", () => {
    expect(read("<A><><B /><C /></></A>")).toEqual(["A", {}, ["B", {}], ["C", {}]]);
  });
});

describe("lists and conditions", () => {
  test("a map over an inline array is written out", () => {
    expect(
      read('<ul>{["a", "b"].map((item, i) => <li key={i} data-i={i}>{item}</li>)}</ul>'),
    ).toEqual(["ul", {}, ["li", { "data-i": 0 }, "a"], ["li", { "data-i": 1 }, "b"]]);
  });

  test("declared data, destructured, filtered and sliced", () => {
    const source = `
      const rows = [
        { id: 1, name: "Aurora", status: "Shipped" },
        { id: 2, name: "Beacon", status: "Blocked" },
        { id: 3, name: "Cobalt", status: "Shipped" },
      ];
      <Table>
        {rows.filter((row) => row.status === "Shipped").slice(0, 5).map(({ id, name }) => (
          <Row key={id}>{name}</Row>
        ))}
      </Table>`;
    expect(read(source)).toEqual([
      "Table",
      {},
      "\n        ",
      ["Row", {}, "Aurora"],
      ["Row", {}, "Cobalt"],
      "\n      ",
    ]);
  });

  test("&&, ||, ?? and a ternary choose what renders", () => {
    const source = `
      const open = true;
      const count = 0;
      const label = null;
      <Box>{open && <A />}{count > 0 && <B />}{open ? <C /> : <D />}{label ?? "none"}{count || "zero"}</Box>`;
    expect(read(source)).toEqual(["Box", {}, ["A", {}], ["C", {}], "none", "zero"]);
  });

  test("a falsy number renders as React renders it, a boolean as nothing", () => {
    expect(read("<Box>{0}{false}{null}{undefined}</Box>")).toEqual(["Box", {}, "0"]);
  });

  test("Array.from and a sized array build a list from a count", () => {
    expect(
      read("<Box>{Array.from({ length: 2 }, (_, i) => <Dot key={i} n={i + 1} />)}</Box>"),
    ).toEqual(["Box", {}, ["Dot", { n: 1 }], ["Dot", { n: 2 }]]);
    expect(read("<Box>{[...Array(2)].map((_, i) => <Dot key={i} />)}</Box>")).toEqual([
      "Box",
      {},
      ["Dot", {}],
      ["Dot", {}],
    ]);
  });
});

describe("values", () => {
  test("template strings, class joiners and string methods", () => {
    const source = `
      const up = false;
      const name = "priya n.";
      <Text
        className={cn("text-sm", up && "text-green-600", { "text-red-600": !up })}
        title={\`\${name.toUpperCase()} · \${(0.125 * 100).toFixed(1)}%\`}
      />`;
    expect(read(source)).toEqual([
      "Text",
      { className: "text-sm text-red-600", title: "PRIYA N. · 12.5%" },
    ]);
  });

  test("number and date formatters produce their text", () => {
    const source = `
      const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
      <Text>{money.format(12400)} · {new Date("2026-03-14T12:00:00Z").getFullYear()}</Text>`;
    expect(read(source)).toEqual(["Text", {}, "$12,400", " · ", "2026"]);
  });

  test("a spread sets attributes, and a later attribute wins", () => {
    const source = `
      const base = { variant: "outline", size: "sm" };
      <Button {...base} size="lg" />`;
    expect(read(source)).toEqual(["Button", { variant: "outline", size: "lg" }]);
  });

  test("an undefined attribute is absent; an element is an element value", () => {
    const source = `
      const row = { icon: undefined };
      <Item icon={row.icon} lead={<Icon name="bolt" />} />`;
    expect(read(source)).toEqual(["Item", { lead: ["Icon", { name: "bolt" }] }]);
  });

  test("prototype keys are never reachable", () => {
    expect(read('<A v={({}).constructor} w={"x".constructor} />')).toEqual(["A", {}]);
    expect(failure('<A v={{ "__proto__": 1 }} />').message).toBe("unsafe object key");
  });
});

describe("a pasted module", () => {
  test("imports, directives and types are stepped over; the default export is composed", () => {
    const source = `"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { Team } from "./types";

interface Props { teams: Team[] }
type Status = "Shipped" | "Blocked";

const TEAMS: Team[] = [{ name: "Aurora", status: "Shipped" as Status }];

export function Chip({ status }: { status: Status }) {
  return <Badge variant={status === "Shipped" ? "default" : "destructive"}>{status}</Badge>;
}

export default function Page() {
  const [query, setQuery] = React.useState<string>("");
  const visible = TEAMS.filter((team) => team.name.toLowerCase().includes(query));
  const handleSave = async () => {
    await fetch("/api/save", { method: "POST" });
    for (const team of visible) console.log(team);
  };
  return (
    <main>
      {visible.map((team) => (
        <Button key={team.name} onClick={handleSave}>
          {team.name} <Chip status={team.status} />
        </Button>
      ))}
    </main>
  );
}`;
    const { root, notes } = readJsxSource(source);
    expect(shape(root)).toEqual([
      "main",
      {},
      "\n      ",
      [
        "Button",
        {},
        "\n          ",
        "Aurora",
        " ",
        ["Badge", { variant: "default" }, "Shipped"],
        "\n        ",
      ],
      "\n    ",
    ]);
    expect(notes.join(" ")).toContain("Chip");
    expect(notes.join(" ")).toContain("onClick");
    expect(notes.join(" ")).toContain("useState");
  });

  test("no semicolons: markup on the next line is the markup, not a comparison", () => {
    expect(read('const rows = ["a"]\nconst n = rows.length\n<Box n={n}>{rows}</Box>')).toEqual([
      "Box",
      { n: 1 },
      "a",
    ]);
  });

  test("children pass through a local component", () => {
    const source = `
      const Panel = ({ title, children }) => (
        <Card>
          <Heading>{title}</Heading>
          {children}
        </Card>
      );
      <Panel title="Top sources"><Row /><Row /></Panel>`;
    expect(read(source)).toEqual([
      "Card",
      {},
      "\n          ",
      ["Heading", {}, "Top sources"],
      "\n          ",
      ["Row", {}],
      ["Row", {}],
      "\n        ",
    ]);
  });

  test("an early return and a default prop are honoured", () => {
    const source = `
      function Delta({ value, unit = "%" }) {
        if (value === 0) return null;
        const sign = value > 0 ? "+" : "";
        return <Text>{sign}{value}{unit}</Text>;
      }
      <Box><Delta value={0} /><Delta value={12.4} /></Box>`;
    expect(read(source)).toEqual(["Box", {}, ["Text", {}, "+", "12.4", "%"]]);
  });
});

describe("imported components", () => {
  test("travel as data and render as the tag they name", () => {
    const source = `
      import { Layout, Menu } from "antd";
      import { IconHome, IconBolt } from "@tabler/icons-react";
      const { Header, Content } = Layout;
      const nav = [{ label: "Home", icon: IconHome }, { label: "Jobs", icon: IconBolt }];
      <Layout>
        <Header>{nav.map((item) => <Menu.Item key={item.label} icon={<item.icon size={16} />}>{item.label}</Menu.Item>)}</Header>
        <Content />
      </Layout>`;
    expect(read(source)).toEqual([
      "Layout",
      {},
      "\n        ",
      [
        "Layout.Header",
        {},
        ["Menu.Item", { icon: ["IconHome", { size: 16 }] }, "Home"],
        ["Menu.Item", { icon: ["IconBolt", { size: 16 }] }, "Jobs"],
      ],
      "\n        ",
      ["Layout.Content", {}],
      "\n      ",
    ]);
  });

  test("an element chosen by a string is that element", () => {
    expect(read('const Tag = "h2";\n<Tag className="t">Title</Tag>')).toEqual([
      "h2",
      { className: "t" },
      "Title",
    ]);
  });

  test("a component type as a prop is still refused, by name", () => {
    const error = failure('import { ScrollArea } from "@mantine/core";\n<Tabs as={ScrollArea} />');
    expect(error.message).toContain('"ScrollArea" is a component type');
  });

  test("imported data is not mistaken for a component", () => {
    expect(
      failure('import { SHIPMENTS } from "@/lib/shipments";\n<Box>{SHIPMENTS.length}</Box>')
        .message,
    ).toContain('`SHIPMENTS` is imported from "@/lib/shipments"');
    expect(
      failure('import { Rows } from "./rows";\n<Box>{Rows.map((r) => r)}</Box>').message,
    ).toContain('`Rows` is imported from "./rows"');
  });
});

describe("the app's own modules", () => {
  const files: Record<string, string> = {
    "/app/lib/reviews.ts": `
      import { stars } from "./format";
      export type Review = { author: string; rating: number };
      export const reviews: Review[] = [
        { author: "Priya", rating: 5 },
        { author: "Marcus", rating: 3 },
      ];
      export const reviewStats = { total: reviews.length, label: stars(4.2) };
      export default reviews;`,
    "/app/lib/format.ts": `
      export const stars = (value: number) => value.toFixed(1) + " ★";
      export function shout(text: string) { return text.toUpperCase(); }
      export const broken = (value) => value.normalize();`,
    "/app/lib/loop.ts": `import { again } from "./loop";\nexport const once = again;`,
    "/app/lib/bad.ts": "export const rows = await fetch('/rows');",
  };
  const modules = {
    load(specifier: string, from: string | null) {
      const base = from ? from.replace(/[^/]+$/, "") : "/app/";
      const path = specifier.startsWith("@/")
        ? `/app/${specifier.slice(2)}.ts`
        : `${base}${specifier.replace(/^\.\//, "")}.ts`;
      return files[path] === undefined ? null : { file: path, source: files[path] as string };
    },
  };
  const readWith = (source: string, file?: string): Shape =>
    shape(readJsxSource(source, { modules, ...(file ? { file } : {}) }).root);
  const failureWith = (source: string): SourceFailure => {
    try {
      readJsxSource(source, { modules });
    } catch (error) {
      if (error instanceof SourceFailure) return error;
      throw error;
    }
    throw new Error("expected the source to be refused");
  };

  test("imported data and helpers are read from the files that hold them", () => {
    const source = `
      import { reviews, reviewStats } from "@/lib/reviews";
      import { shout } from "@/lib/format";
      import { ReviewCard } from "@/components/review-card";
      <section title={reviewStats.label} data-total={reviewStats.total}>
        {reviews.map((review) => <ReviewCard key={review.author} name={shout(review.author)} rating={review.rating} />)}
      </section>`;
    expect(readWith(source)).toEqual([
      "section",
      { title: "4.2 ★", "data-total": 2 },
      "\n        ",
      ["ReviewCard", { name: "PRIYA", rating: 5 }],
      ["ReviewCard", { name: "MARCUS", rating: 3 }],
      "\n      ",
    ]);
  });

  test("a default import, a namespace import and a renamed one", () => {
    const source = `
      import list, { reviews as all } from "@/lib/reviews";
      import * as format from "@/lib/format";
      <Box count={list.length} same={list === all}>{format.stars(3)}</Box>`;
    expect(readWith(source)).toEqual(["Box", { count: 2, same: true }, "3.0 ★"]);
  });

  test("a relative import resolves from the file the source was read from", () => {
    expect(
      readWith('import { stars } from "./format";\n<Box>{stars(5)}</Box>', "/app/lib/page.tsx"),
    ).toEqual(["Box", {}, "5.0 ★"]);
  });

  test("what an imported module cannot yield is reported at the import's use", () => {
    const missing = failureWith('import { nope } from "@/lib/format";\n<Box>{nope}</Box>');
    expect(missing.message).toBe('"@/lib/format" has no export named `nope`.');
    const bad = failureWith('import { rows } from "@/lib/bad";\n<Box>{rows}</Box>');
    expect(bad.message).toContain('In "@/lib/bad" (line 1): `await` can\'t be evaluated');
    expect(bad.offset).toBe(40);
    const circle = failureWith('import { once } from "@/lib/loop";\n<Box>{once}</Box>');
    expect(circle.message).toContain("in a circle");
    const inside = failureWith('import { broken } from "@/lib/format";\n<Box>{broken("x")}</Box>');
    expect(inside.message).toContain("In `broken` from another file");
    expect(inside.offset).toBe(51);
  });

  test("a package is never read: its data is still the source's to declare", () => {
    const error = failureWith('import { rows } from "some-package";\n<Box>{rows}</Box>');
    expect(error.message).toContain("not a file of this app that compose can read");
  });
});

describe("a page read from the app is composed inside its layouts", () => {
  const page = "export default function Page() { return <section>Reviews</section>; }";
  const root = {
    file: "/app/app/layout.tsx",
    label: "app/layout.tsx",
    source: `
      import type { Metadata } from "next";
      import { Fraunces } from "next/font/google";
      import "./globals.css";
      import { SiteHeader } from "@/components/site-header";
      const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });
      export const metadata: Metadata = { title: "Dine Dash" };
      export default function RootLayout({ children }: { children: React.ReactNode }) {
        return (
          <html lang="en" className={display.variable}>
            <body className="min-h-screen antialiased">
              <SiteHeader />
              <main className="flex-1">{children}</main>
            </body>
          </html>
        );
      }`,
  };
  const nested = {
    file: "/app/app/reviews/layout.tsx",
    label: "app/reviews/layout.tsx",
    source:
      'export default function Layout({ children }) { return <div className="container">{children}</div>; }',
  };

  test("innermost first, with the document shell taken off and the body's classes kept", () => {
    const { root: tree, notes } = readJsxSource(page, { layouts: [nested, root] });
    expect(shape(tree)).toEqual([
      "div",
      { className: "min-h-screen antialiased" },
      "\n              ",
      ["SiteHeader", {}],
      "\n              ",
      [
        "main",
        { className: "flex-1" },
        ["div", { className: "container" }, ["section", {}, "Reviews"]],
      ],
      "\n            ",
    ]);
    expect(notes.join(" ")).toContain("`app/reviews/layout.tsx`, then `app/layout.tsx`");
  });

  test("a layout that cannot be read leaves the page, and says what is missing", () => {
    const broken = {
      ...root,
      source:
        "export default async function L({ children }) { const s = await getSession(); return <div>{children}</div>; }",
    };
    const { root: tree, notes } = readJsxSource(page, { layouts: [broken] });
    expect(shape(tree)).toEqual(["section", {}, "Reviews"]);
    expect(notes.join(" ")).toContain("`app/layout.tsx`, which could not be read");
  });
});

describe("what cannot be design data is named, where it is", () => {
  test("a component composed on its own without the props it takes", () => {
    const error = failure("export function Card({ r }) { return <Box>{r.name}</Box>; }");
    expect(error.message).toContain("`Card` takes props (r)");
    expect(error.message).toContain("<Card r={…} />");
  });

  test("an imported hook is a hook first", () => {
    const error = failure(
      'import { usePathname } from "next/navigation";\nconst p = usePathname();\n<Box />',
    );
    expect(error.message).toContain("hook `usePathname`");
  });

  test("an import's value", () => {
    const error = failure(
      'import { reviews } from "@/lib/data";\n<Box>{reviews.map((r) => <A />)}</Box>',
    );
    expect(error.message).toContain('`reviews` is imported from "@/lib/data"');
    expect(error.message).toContain("not a file of this app");
    expect(error.offset).toBe(44);
  });

  test("an undefined name, a hook with no value, the current time", () => {
    expect(failure("<Box>{user.name}</Box>").message).toContain("`user` is not defined");
    expect(failure("const router = useRouter();\n<Box />").message).toContain("hook `useRouter`");
    expect(failure("<Box>{new Date().getFullYear()}</Box>").message).toContain(
      "changes every time",
    );
  });

  test("a component type, a method that would run code, a loop", () => {
    expect(failure("<Tabs as={ScrollArea} />").message).toContain("is a component type");
    expect(failure('<Box>{"x".normalize()}</Box>').message).toContain("can't be evaluated");
    expect(failure("for (const x of []) {}\n<Box />").message).toContain("`for` statement");
  });

  test("a handler body that would not parse only fails if it is called", () => {
    const source = `
      const load = async () => { const r = await fetch("/x"); return r.json(); };
      <Box>{load()}</Box>`;
    expect(failure(source).message).toContain("async function");
  });

  test("runaway sources stop", () => {
    expect(failure("const f = (n) => f(n + 1);\n<Box>{f(0)}</Box>").message).toContain(
      "recurses too deeply",
    );
    expect(failure("<Box>{Array.from({ length: 1e9 })}</Box>").message).toContain(
      "more than a design holds",
    );
  });
});
