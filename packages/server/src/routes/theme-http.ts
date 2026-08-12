import type { Context } from "hono";
import type { ThemeError } from "../theme/errors.ts";

/** Map a ThemeError variant to its HTTP response (exhaustive + never guard). */
export function themeToHttp(c: Context, error: ThemeError): Response {
  switch (error.kind) {
    case "UnknownPreset":
      return c.json({ error }, 404);
    case "InvalidColor":
    case "InvalidThemePath":
    case "BadRequest":
      return c.json({ error }, 400);
    case "ImageLoadFailed":
      return c.json({ error }, 422);
    case "LlmUnavailable":
      return c.json({ error }, 503);
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return c.json({ error: { kind: "Unknown" } }, 500);
    }
  }
}
