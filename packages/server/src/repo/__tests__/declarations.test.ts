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

  test("a literal-union alias reads fast, even on input built to backtrack", async () => {
    const index = await indexOf(`
      type Size = 'sm' | "md" | 2 | -3.5;
      type Bad = ${"000.".repeat(60)}0;
    `);
    expect(index.literalAliases.get("Size")).toEqual(["sm", "md", 2, -3.5]);
    // `Bad` is not a union of literals; the point is that deciding so is linear.
    expect(index.literalAliases.has("Bad")).toBe(false);
  });

  test("props typed at the parameter read like a declared <Name>Props", async () => {
    const index = await indexOf(`
      interface Props extends BaseProps { tone: "info" | "warn" }
      export function Composer({ draft, busy = false }: {
        /** The text so far. */
        draft: string;
        busy?: boolean;
        onSubmit(): void;
      }) { return null; }
      export function Notice({ tone }: Props) { return null; }
      export const Chip = ({ label }: ChipOptions) => null;
      export const Memo = memo(function Memo(props: { size: number }) { return null; });
    `);
    expect(propsFor("Composer", index)?.map((p) => [p.name, p.type, p.optional])).toEqual([
      ["draft", "string", false],
      ["busy", "boolean", true],
      ["onSubmit", "() => void", false],
    ]);
    expect(propsFor("Composer", index)?.[0]?.description).toBe("The text so far.");
    // A file-local \`Props\` is inlined: the name means nothing outside this file.
    expect(propsFor("Notice", index)?.map((p) => p.name)).toEqual(["tone"]);
    expect(index.props.get("NoticeProps")?.extends).toEqual(["BaseProps"]);
    expect(index.props.get("ChipProps")?.extends).toEqual(["ChipOptions"]);
    expect(propsFor("Memo", index)?.map((p) => p.name)).toEqual(["size"]);
  });

  // gantry's Panel and StatusChip: neither declares a `<Name>Props` the old
  // reader could see, so every literal `cap="ink"` drew a "passes code" warning.
  test("`keyof typeof` a const and a CVA table read as their literal keys", async () => {
    const index = await indexOf(`
      const CAP: Record<string, string> = { ink: "bg-ink", acid: "bg-acid", "no-cap": "hidden" };
      export function Panel({ cap = "ink", ...props }: React.HTMLAttributes<HTMLDivElement> & { cap?: keyof typeof CAP }) {
        return <div {...props} />;
      }
      const chipVariants = cva("inline-flex", {
        variants: { tone: { live: "bg-acid", idle: "bg-card" } },
        defaultVariants: { tone: "idle" },
      });
      export interface StatusChipProps
        extends React.HTMLAttributes<HTMLSpanElement>,
          VariantProps<typeof chipVariants> {}
      export function StatusChip({ tone }: StatusChipProps) { return null; }
      type TagProps = VariantProps<typeof chipVariants> & {
        label: string
      }
      export function Tag(props: TagProps) { return null; }
    `);
    expect(propsFor("Panel", index)?.find((p) => p.name === "cap")).toMatchObject({
      control: "enum",
      enumValues: ["ink", "acid", "no-cap"],
      serializable: true,
    });
    expect(propsFor("StatusChip", index)?.find((p) => p.name === "tone")).toMatchObject({
      control: "enum",
      enumValues: ["live", "idle"],
      defaultValue: "idle",
    });
    expect(propsFor("Tag", index)?.map((p) => [p.name, p.control])).toEqual([
      ["label", "string"],
      ["tone", "enum"],
    ]);
  });
});
