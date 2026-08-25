import { describe, expect, test } from "bun:test";
import { unwrap } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import { emitCode } from "../emit-code/index.ts";

function screenOf(tree: Screen["tree"]): Screen {
  return { id: "home", name: "Home", tree };
}

describe("emitCode — JSX string-prop injection (FIX 1)", () => {
  test("a quote-breakout payload becomes inert expression-container data, not sibling attributes", async () => {
    const payload = 'a" onClick={alert(1)} x="';
    const result = unwrap(await emitCode(screenOf({ $ref: "Box", props: { title: payload } })));

    // Emitted as a JSX expression container holding a JS string literal — the
    // quotes/braces live inside the string, so nothing breaks out.
    expect(result.jsx).toContain(`title={${JSON.stringify(payload)}}`);
    // The vulnerable quoted-attribute form must NOT appear.
    expect(result.jsx).not.toContain('title="a"');

    // Proof it's inert: the emitted JSX parses, and the payload is NOT lifted to
    // a real `onClick` handler prop (a vulnerable emit would transpile to an
    // `onClick:` object property).
    const transpiler = new Bun.Transpiler({ loader: "tsx" });
    const out = transpiler.transformSync(`export const App = () => (${result.jsx});`);
    expect(out).not.toContain("onClick:");
    expect(out).not.toContain("onClick =");
  });

  test("backticks / template markers / newlines also route to expression containers", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal payload with a template marker.
    const payload = "hi `x` ${y}\nz";
    const result = unwrap(await emitCode(screenOf({ $ref: "Box", props: { title: payload } })));
    expect(result.jsx).toContain(`title={${JSON.stringify(payload)}}`);
  });

  test("plain string props keep the readable double-quoted form", async () => {
    const result = unwrap(
      await emitCode(screenOf({ $ref: "Box", props: { title: "Hello world - v2.0" } })),
    );
    expect(result.jsx).toContain('title="Hello world - v2.0"');
  });
});

describe("emitCode — hostile component/import names (FIX 1)", () => {
  test("rejects a hostile $emitAs component name", async () => {
    const r = await emitCode(
      screenOf({ $ref: "Card", $emitAs: { name: "Evil onClick={x}", importPath: "@/x" } }),
    );
    expect(r.ok).toBe(false);
  });

  test("rejects a hostile $emitAs import path", async () => {
    const r = await emitCode(
      screenOf({ $ref: "Card", $emitAs: { name: "Evil", importPath: '@/x"; import "./pwn' } }),
    );
    expect(r.ok).toBe(false);
  });

  test("rejects a hostile extension import path", async () => {
    const r = await emitCode(screenOf({ $ref: "Evil", props: {} }), {
      extensions: { Evil: { importPath: '../pwn"; drop table', props: [] } },
    });
    expect(r.ok).toBe(false);
  });

  test("a well-formed $emitAs still emits", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({ $ref: "Card", $emitAs: { name: "PriceTag", importPath: "@/components/price" } }),
      ),
    );
    expect(result.jsx).toBe("<PriceTag />");
  });
});

describe("emitCode — SVG content sanitization (FIX 2)", () => {
  test("strips active content from an SVG `content` prop before emit", async () => {
    const result = unwrap(
      await emitCode(
        screenOf({
          $ref: "SVG",
          props: {
            content:
              '<image href="x" onerror="alert(1)"/><script>alert(2)</script><path d="M0 0"/>',
          },
        }),
      ),
    );
    expect(result.jsx).not.toContain("onerror");
    expect(result.jsx).not.toContain("<script");
    expect(result.jsx).not.toContain("alert(");
    // The static drawing survives.
    expect(result.jsx).toContain("path");
  });
});
