import { describe, expect, test } from "bun:test";
import { emptyIndex, indexLocalDeclarations, propsFor, variantPropsFor } from "../declarations.ts";

async function indexOf(source: string) {
  const file = `${process.env.TMPDIR ?? "/tmp"}/velloo-decl-${Math.random().toString(36).slice(2)}.tsx`;
  await Bun.write(file, source);
  const index = emptyIndex();
  indexLocalDeclarations(file, index, new Set());
  return index;
}

describe("declaration extraction", () => {
  test("CVA-like variant tables become enum props, without CVA installed", async () => {
    const index = await indexOf(`
      import { cva, type VariantProps } from "class-variance-authority";
      const buttonVariants = cva("inline-flex rounded-md", {
        variants: {
          variant: { default: "bg-primary", outline: "border", "ghost-subtle": ["a", "b"] },
          size: { sm: "h-8", lg: "h-11" },
        },
        defaultVariants: { variant: "default", size: "sm" },
      });
      export function Button(props: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
        return <button className={buttonVariants(props)} />;
      }
    `);
    expect(variantPropsFor("Button", index)).toEqual([
      expect.objectContaining({
        name: "variant",
        enumValues: ["default", "outline", "ghost-subtle"],
        defaultValue: "default",
      }),
      expect.objectContaining({ name: "size", enumValues: ["sm", "lg"], defaultValue: "sm" }),
    ]);
    expect(variantPropsFor("Card", index)).toEqual([]);
  });

  test("multi-line unions, inherited interfaces and nested object types stay whole", async () => {
    const index = await indexOf(`
      interface BaseProps { /** Shared id. */ id?: string }
      export interface CardProps extends BaseProps {
        tone?:
          | "calm"
          | "loud"
        meta?: { a: string; b: number }
        onPick?: (value: string) => void
      }
    `);
    const props = propsFor("Card", index) ?? [];
    expect(props.map((p) => [p.name, p.control, p.inherited ?? false])).toEqual([
      ["tone", "enum", false],
      ["meta", "string", false],
      ["onPick", "string", false],
      ["id", "string", true],
    ]);
    expect(props.find((p) => p.name === "onPick")?.serializable).toBe(false);
    expect(props.find((p) => p.name === "id")?.description).toBe("Shared id.");
  });
});
