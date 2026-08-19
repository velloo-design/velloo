import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { TailwindJit } from "../tailwind-jit.ts";

const provider = createShadcnProvider();

let tmp: string;
let jit: TailwindJit;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-jit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, "screens"), { recursive: true });
  await mkdir(join(tmp, "snippets"), { recursive: true });
  jit = new TailwindJit(provider, join(tmp, "screens"), join(tmp, "snippets"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("TailwindJit.build", () => {
  // #7: a class that only exists in a render_snippet preview's in-memory args
  // never hits disk, so the scan can't see it. Extra candidates make it paint
  // anyway, without poisoning the shared (pure disk-scan) cache.
  test("extraCandidates compile classes the disk scan never saw", async () => {
    const base = await jit.build();
    expect(base).not.toContain("#abcdef");

    const withExtra = await jit.build(["from-[#abcdef]"]);
    expect(withExtra).toContain("#abcdef");

    // The extra must not leak into the cached base build.
    const baseAgain = await jit.build();
    expect(baseAgain).not.toContain("#abcdef");
  });
});
