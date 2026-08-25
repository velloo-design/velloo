import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  fetchShadcn,
  LIB_UTILS_CONTENT,
  SHADCN_REGISTRY_VERSION,
  verifyCache,
} from "../fetcher.ts";
import { generateManifest, writeManifest } from "../manifest.ts";

/**
 * Build a registry response stub the way shadcn's API returns. Each
 * entry has a single .tsx file at `ui/<id>.tsx` plus optional npm
 * dependency lists. Tests reach for this rather than a live HTTP call
 * so the fetcher stays offline.
 */
function buildRegistryStub(id: string, body: string, dependencies: string[] = []): unknown {
  return {
    name: id,
    type: "registry:ui",
    dependencies,
    registryDependencies: [],
    files: [{ path: `ui/${id}.tsx`, content: body, type: "registry:ui", target: "" }],
  };
}

function fakeButtonTsx(): string {
  return `import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva("inline-flex", {
  variants: {
    variant: { default: "", destructive: "" },
    size: { default: "", sm: "" },
  },
  defaultVariants: { variant: "default", size: "default" },
})

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
`;
}

function fakeCardTsx(): string {
  return `import * as React from "react"
import { cn } from "@/lib/utils"

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card" className={cn("rounded-xl border", className)} {...props} />
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={cn(className)} {...props} />
}
`;
}

let tmp: string;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-fetcher-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("fetchShadcn", () => {
  test("writes one file per component plus lib/utils.ts and a lockfile", async () => {
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/button.json")) {
        return new Response(
          JSON.stringify(buildRegistryStub("button", fakeButtonTsx(), ["@radix-ui/react-slot"])),
        );
      }
      if (url.endsWith("/card.json")) {
        return new Response(JSON.stringify(buildRegistryStub("card", fakeCardTsx())));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const result = await fetchShadcn({
      destination: tmp,
      components: ["button", "card"],
      fetchImpl,
    });

    // Files are where shadcn says they go.
    const uiFiles = await readdir(join(tmp, "ui"));
    expect(uiFiles).toContain("button.tsx");
    expect(uiFiles).toContain("card.tsx");

    // lib/utils.ts ships with the canonical cn helper.
    const utils = await readFile(join(tmp, "lib", "utils.ts"), "utf8");
    expect(utils).toBe(LIB_UTILS_CONTENT);
    expect(utils).toContain("twMerge");

    // Lockfile records the pinned registry version + per-file SHA256 + npm deps.
    const lock = result.lock;
    expect(lock.version).toBe(SHADCN_REGISTRY_VERSION);
    expect(lock.style).toBe("new-york");
    expect(lock.components.button?.dependencies).toEqual(["@radix-ui/react-slot"]);
    expect(lock.components.button?.files[0]?.path).toBe("ui/button.tsx");
    expect(lock.components.button?.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lock.components.card?.dependencies).toEqual([]);

    // The hardcoded cn helper is locked like any component, so drift
    // detection covers it and its npm deps are aggregated.
    expect(lock.components.utils?.files[0]?.path).toBe("lib/utils.ts");
    expect(lock.components.utils?.dependencies).toEqual(["clsx", "tailwind-merge"]);
  });

  test("surfaces non-200 responses as typed errors", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(
      fetchShadcn({
        destination: tmp,
        components: ["button"],
        fetchImpl,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  test("a mid-list fetch failure writes nothing to disk", async () => {
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/button.json")) {
        return new Response(JSON.stringify(buildRegistryStub("button", fakeButtonTsx())));
      }
      // Second component fails — the first must not have hit disk.
      return new Response("boom", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      fetchShadcn({ destination: tmp, components: ["button", "card"], fetchImpl }),
    ).rejects.toThrow(/HTTP 500/);

    // No partial files, no lockfile, not even the destination dir.
    expect(await Bun.file(join(tmp, "ui", "button.tsx")).exists()).toBe(false);
    expect(await Bun.file(join(tmp, "shadcn-upstream-lock.json")).exists()).toBe(false);
  });
});

describe("fetchShadcn — hostile registry (FIX 3)", () => {
  function evilStub(path: string): unknown {
    return {
      name: "button",
      type: "registry:ui",
      dependencies: [],
      registryDependencies: [],
      files: [{ path, content: "export const pwned = 1\n", type: "registry:ui", target: "" }],
    };
  }

  test("rejects a path-traversal file.path and writes nothing", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify(evilStub("../velloo-evil.tsx")))) as unknown as typeof fetch;

    await expect(
      fetchShadcn({ destination: tmp, components: ["button"], fetchImpl }),
    ).rejects.toThrow(/escapes the destination/);

    // Validation runs before any disk write, so nothing lands — not the escaped
    // file, not the destination tree, not the lockfile.
    expect(await Bun.file(join(dirname(tmp), "velloo-evil.tsx")).exists()).toBe(false);
    expect(await Bun.file(join(tmp, "ui", "button.tsx")).exists()).toBe(false);
    expect(await Bun.file(join(tmp, "shadcn-upstream-lock.json")).exists()).toBe(false);
  });

  test("rejects an absolute file.path", async () => {
    const absTarget = join(tmpdir(), `velloo-abs-${Date.now()}.tsx`);
    const fetchImpl: typeof fetch = (async () =>
      new Response(JSON.stringify(evilStub(absTarget)))) as unknown as typeof fetch;

    await expect(
      fetchShadcn({ destination: tmp, components: ["button"], fetchImpl }),
    ).rejects.toThrow(/escapes the destination/);
    expect(await Bun.file(absTarget).exists()).toBe(false);
  });

  test("refuses a non-HTTPS registry base by default", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify(buildRegistryStub("button", fakeButtonTsx())),
      )) as unknown as typeof fetch;
    await expect(
      fetchShadcn({
        destination: tmp,
        components: ["button"],
        registryBase: "http://ui.shadcn.com/r/styles",
        fetchImpl,
      }),
    ).rejects.toThrow(/non-HTTPS/);
  });

  test("allowInsecure opts a trusted local test server out of the HTTPS gate", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify(buildRegistryStub("button", fakeButtonTsx())),
      )) as unknown as typeof fetch;
    const result = await fetchShadcn({
      destination: tmp,
      components: ["button"],
      registryBase: "http://127.0.0.1:9/r/styles",
      allowInsecure: true,
      fetchImpl,
    });
    expect(result.filesWritten.some((p) => p.endsWith("button.tsx"))).toBe(true);
  });
});

describe("verifyCache", () => {
  test("returns no drift when files match their checksums", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify(buildRegistryStub("button", fakeButtonTsx())),
      )) as unknown as typeof fetch;
    const { lock } = await fetchShadcn({
      destination: tmp,
      components: ["button"],
      fetchImpl,
    });
    const drifted = await verifyCache(tmp, lock);
    expect(drifted).toEqual([]);
  });

  test("detects on-disk drift", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify(buildRegistryStub("button", fakeButtonTsx())),
      )) as unknown as typeof fetch;
    const { lock } = await fetchShadcn({
      destination: tmp,
      components: ["button"],
      fetchImpl,
    });
    // Corrupt the cached file; verify surfaces the drift.
    await writeFile(join(tmp, "ui", "button.tsx"), "// hand-edit\n");
    const drifted = await verifyCache(tmp, lock);
    expect(drifted).toEqual(["ui/button.tsx"]);
  });

  test("detects drift in lib/utils.ts", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify(buildRegistryStub("button", fakeButtonTsx())),
      )) as unknown as typeof fetch;
    const { lock } = await fetchShadcn({
      destination: tmp,
      components: ["button"],
      fetchImpl,
    });
    await writeFile(join(tmp, "lib", "utils.ts"), "// hand-edit\n");
    const drifted = await verifyCache(tmp, lock);
    expect(drifted).toEqual(["lib/utils.ts"]);
  });
});

describe("generateManifest", () => {
  test("extracts interface props + CVA variants for a Button-style file", async () => {
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/button.json")) {
        return new Response(JSON.stringify(buildRegistryStub("button", fakeButtonTsx())));
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    await fetchShadcn({ destination: tmp, components: ["button"], fetchImpl });
    const manifest = await generateManifest(join(tmp, "ui"));

    const button = manifest.find((c) => c.id === "Button");
    expect(button).toBeDefined();
    if (!button) return;
    expect(button.source).toBe("shadcn");
    expect(button.category).toBe("ui");

    // VariantProps<typeof buttonVariants> contributes variant + size.
    const variant = button.props.find((p) => p.name === "variant");
    expect(variant?.control).toBe("enum");
    expect(variant?.enumValues).toContain("default");
    expect(variant?.enumValues).toContain("destructive");
    const size = button.props.find((p) => p.name === "size");
    expect(size?.enumValues).toContain("sm");

    // asChild from the interface.
    const asChild = button.props.find((p) => p.name === "asChild");
    expect(asChild?.control).toBe("boolean");
  });

  test("writeManifest produces a manifest.json next to the cache", async () => {
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/card.json")) {
        return new Response(JSON.stringify(buildRegistryStub("card", fakeCardTsx())));
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    await fetchShadcn({ destination: tmp, components: ["card"], fetchImpl });
    const manifest = await writeManifest(tmp);
    expect(manifest.find((c) => c.id === "Card")).toBeDefined();
    expect(manifest.find((c) => c.id === "CardHeader")).toBeDefined();

    const onDisk = JSON.parse(await readFile(join(tmp, "manifest.json"), "utf8"));
    expect(onDisk.length).toBe(manifest.length);
  });
});
