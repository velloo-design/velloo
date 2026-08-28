import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTailwindMajor } from "../detect-tailwind.ts";

function appWith(pkg: Record<string, unknown>): string {
  const dir = join(tmpdir(), `velloo-detect-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

describe("detectTailwindMajor", () => {
  test("v3 and v4 ranges", () => {
    expect(detectTailwindMajor(appWith({ devDependencies: { tailwindcss: "^3.4.1" } }))).toBe(3);
    expect(detectTailwindMajor(appWith({ dependencies: { tailwindcss: "~4.1.0" } }))).toBe(4);
  });

  test("v4 adapter packages imply v4", () => {
    expect(
      detectTailwindMajor(appWith({ devDependencies: { "@tailwindcss/postcss": "^4.0.0" } })),
    ).toBe(4);
  });

  test("no tailwind / no package.json → null", () => {
    expect(detectTailwindMajor(appWith({ dependencies: { react: "^19.0.0" } }))).toBeNull();
    expect(detectTailwindMajor(join(tmpdir(), "velloo-detect-missing"))).toBeNull();
  });
});
