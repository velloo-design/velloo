import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "@velloo/provider";
import { createProvider } from "../index.ts";

/**
 * The upstream provider:
 *
 *   1. The factory returns a ComponentProvider with id "shadcn-upstream",
 *      reusing the snapshot's registry.
 *   2. The provider's `loadManifest` reads from a per-cache manifest.json
 *      when present; falls back to the snapshot manifest when missing.
 */

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-upstream-prov-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("createProvider", () => {
  test("returns the shadcn-upstream identity with the snapshot registry", () => {
    const provider = createProvider();
    expect(provider.id).toBe("shadcn-upstream");
    expect(provider.registry.Button).toBeDefined();
    expect(provider.registry.Dialog).toBeDefined();
    // The snapshot's velloo helpers are also surfaced, so designs using
    // Heading/Text/etc. work against this provider unchanged.
    expect(provider.registry.Heading).toBeDefined();
  });

  test("loadManifest falls back to the snapshot manifest when no cache is provided", async () => {
    const provider = createProvider();
    const manifest = await provider.loadManifest();
    expect(manifest.length).toBeGreaterThan(0);
    expect(manifest.find((c) => c.id === "Button")).toBeDefined();
  });

  test("loadManifest prefers a per-cache manifest.json when present", async () => {
    await mkdir(tmp, { recursive: true });
    const customManifest: Manifest = [
      {
        id: "CustomThing",
        category: "ui",
        source: "shadcn",
        props: [],
      },
    ];
    await writeFile(join(tmp, "manifest.json"), JSON.stringify(customManifest));
    const provider = createProvider({ cacheDir: tmp });
    const manifest = await provider.loadManifest();
    expect(manifest.length).toBe(1);
    expect(manifest[0]?.id).toBe("CustomThing");
  });

  test("loadManifest enriches custom CVA variants and explicit host props", async () => {
    await mkdir(join(tmp, "ui"), { recursive: true });
    await writeFile(
      join(tmp, "ui/button.tsx"),
      `const buttonVariants = { variants: { variant: { default: "x", launch: "y" }, size: { default: "x", compact: "y" } }, defaultVariants: { variant: "default", size: "default" } };
export interface ButtonProps { busy?: boolean; tone?: "quiet" | "loud" }
export function Button(_props: ButtonProps) { return null }
void buttonVariants;`,
    );
    const provider = createProvider({ cacheDir: tmp });
    const manifest = await provider.loadManifest();
    const button = manifest.find((entry) => entry.id === "Button");
    expect(button?.props.find((prop) => prop.name === "variant")?.enumValues).toContain("launch");
    expect(button?.props.find((prop) => prop.name === "size")?.enumValues).toContain("compact");
    expect(button?.props.find((prop) => prop.name === "busy")?.control).toBe("boolean");
    expect(button?.props.find((prop) => prop.name === "tone")?.enumValues).toEqual([
      "quiet",
      "loud",
    ]);
  });

  test("reads every CVA variant when a class string holds commas", async () => {
    // An arbitrary value like `shadow-[0_1px_2px_rgba(26,23,20,0.18)]` put a
    // comma inside the first variant's string, and the entry ended there:
    // `variant` came out as only [default], so `outline` was warned about.
    await mkdir(join(tmp, "ui"), { recursive: true });
    await writeFile(join(tmp, "ui/button.tsx"), DINE_DASH_BUTTON);
    const provider = createProvider({ cacheDir: tmp });
    const manifest = await provider.loadManifest();
    const button = manifest.find((entry) => entry.id === "Button");
    expect(button?.props.find((prop) => prop.name === "variant")?.enumValues).toEqual([
      "default",
      "ink",
      "outline",
      "secondary",
      "ghost",
      "link",
    ]);
    expect(button?.props.find((prop) => prop.name === "size")?.enumValues).toEqual([
      "default",
      "sm",
      "lg",
      "icon",
    ]);
  });
});

/** A real app's button.tsx, verbatim in the parts the parser reads. */
const DINE_DASH_BUTTON = `import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium [&_svg]:size-4 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(26,23,20,0.18)] hover:bg-primary/90",
        ink: "bg-ink text-bone hover:bg-ink/90",
        outline:
          "border border-border bg-transparent hover:bg-secondary text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:bg-secondary text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-12 px-7 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
`;
