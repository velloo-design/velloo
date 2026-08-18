import { describe, expect, test } from "bun:test";
import { containerClasses, parseTailwindContainer } from "../import-theme/parse-tailwind-config.ts";

describe("parseTailwindContainer", () => {
  test("extracts the classic shadcn container (center + padding + screens cap)", () => {
    const cfg = `
import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.tsx"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: { colors: { brand: "#4f46e5" } },
  },
} satisfies Config;
`;
    const c = parseTailwindContainer(cfg);
    expect(c).toEqual({ center: true, padding: "2rem", maxWidth: "1400px" });
    expect(c && containerClasses(c)).toBe("mx-auto w-full px-8 max-w-[1400px]");
  });

  test("reads padding from a per-screen object's DEFAULT", () => {
    const cfg = `theme: { container: { center: true, padding: { DEFAULT: "1rem", lg: "4rem" } } }`;
    const c = parseTailwindContainer(cfg);
    expect(c?.padding).toBe("1rem");
    expect(c && containerClasses(c)).toBe("mx-auto w-full px-4");
  });

  test("non-spacing-step padding falls back to an arbitrary value; no center → no mx-auto", () => {
    const c = parseTailwindContainer(`container: { padding: "17px" }`);
    expect(c).toEqual({ padding: "17px" });
    expect(c && containerClasses(c)).toBe("w-full px-[17px]");
  });

  test("picks the largest screen cap", () => {
    const c = parseTailwindContainer(
      `container: { screens: { sm: "640px", xl: "1280px", "2xl": "1536px" } }`,
    );
    expect(c?.maxWidth).toBe("1536px");
  });

  test("no container block yields null (and comments are ignored)", () => {
    expect(
      parseTailwindContainer(`theme: { extend: {} } // container: { center: true }`),
    ).toBeNull();
    expect(parseTailwindContainer(`/* container: { center: true } */ theme: {}`)).toBeNull();
  });
});
