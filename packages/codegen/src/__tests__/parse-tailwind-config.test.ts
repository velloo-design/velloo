import { describe, expect, test } from "bun:test";
import {
  containerClasses,
  parseTailwindContainer,
  parseThemeExtend,
} from "../import-theme/parse-tailwind-config.ts";

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

describe("parseThemeExtend", () => {
  test("extracts colors (flat + one-level scale), boxShadow, and fontFamily", () => {
    const cfg = `
import { fontFamily } from "tailwindcss/defaultTheme";
export default {
  theme: {
    container: { center: true },
    extend: {
      colors: {
        paprika: "#E2571E",
        teal: "#0FA3A3",
        brand: { 500: "#123456", 600: "#0d2840" },
      },
      boxShadow: {
        card: "0 2px 8px rgba(0,0,0,0.06)",
        lift: "0 12px 32px rgba(0,0,0,0.12)",
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        body: "Hanken Grotesk, sans-serif",
      },
    },
  },
};`;
    expect(parseThemeExtend(cfg)).toEqual({
      colors: {
        paprika: "#E2571E",
        teal: "#0FA3A3",
        "brand-500": "#123456",
        "brand-600": "#0d2840",
      },
      boxShadow: {
        card: "0 2px 8px rgba(0,0,0,0.06)",
        lift: "0 12px 32px rgba(0,0,0,0.12)",
      },
      fontFamily: { display: "Fraunces, serif", body: "Hanken Grotesk, sans-serif" },
    });
  });

  test("skips non-literal values (require/function refs) without aborting the parse", () => {
    const cfg = `theme: { extend: {
      colors: {
        ok: "#fff",
        viaRequire: require("./palette").accent,
        fn: ({ opacityValue }) => \`rgba(0,0,0,\${opacityValue})\`,
      },
    } }`;
    expect(parseThemeExtend(cfg)).toEqual({ colors: { ok: "#fff" } });
  });

  test("extracts keyframes (nested, case-preserving) and animation shorthands", () => {
    const cfg = `theme: { extend: {
      keyframes: {
        fadeIn: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "none" } },
        pulse: { "0%, 100%": { opacity: "1" }, "50%": { opacity: ".5" } },
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        pulse: "pulse 2s infinite",
      },
    } }`;
    const ext = parseThemeExtend(cfg);
    expect(ext?.keyframes).toEqual({
      // Name case is preserved so the animation shorthand still resolves it.
      fadeIn: {
        "0%": { opacity: "0", transform: "translateY(8px)" },
        "100%": { opacity: "1", transform: "none" },
      },
      pulse: { "0%, 100%": { opacity: "1" }, "50%": { opacity: ".5" } },
    });
    expect(ext?.animation).toEqual({
      "fade-in": "fadeIn 0.3s ease-out",
      pulse: "pulse 2s infinite",
    });
  });

  test("camelCase keyframe declarations kebab-case; injection-y values are dropped", () => {
    const cfg = `theme: { extend: { keyframes: {
      slide: { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "40px 0", evil: "red } html { display:none" } },
    } } }`;
    const ext = parseThemeExtend(cfg);
    expect(ext?.keyframes?.slide).toEqual({
      from: { "background-position": "0 0" },
      to: { "background-position": "40px 0" },
    });
  });

  test("named spacing tokens parse; numeric steps are skipped (Tailwind's scale covers those)", () => {
    const ext = parseThemeExtend(
      `theme: { extend: { spacing: { "icon-rail": "3rem", header: "4rem", 18: "4.5rem" } } }`,
    );
    expect(ext?.spacing).toEqual({ "icon-rail": "3rem", header: "4rem" });
  });

  test("returns null when there's no extend block (or it has nothing readable)", () => {
    expect(parseThemeExtend(`theme: { container: { center: true } }`)).toBeNull();
    expect(parseThemeExtend(`theme: { extend: { spacing: { 18: "4.5rem" } } }`)).toBeNull();
  });
});
