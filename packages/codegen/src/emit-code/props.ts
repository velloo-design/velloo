import { jsLiteral } from "./js-literal.ts";

/**
 * Serialize a single prop (name + value) to a JSX attribute string.
 * Returns null when the prop should be omitted entirely.
 *
 * `paramNames` is set when emitting inside a snippet body — any object of
 * shape `{ $param: "x" }` becomes `{x}` instead of being JSON-encoded.
 */
export function serializeProp(
  name: string,
  value: unknown,
  paramNames?: Set<string>,
): string | null {
  if (value === undefined || value === null) return null;

  if (
    paramNames &&
    typeof value === "object" &&
    typeof (value as { $param?: unknown }).$param === "string"
  ) {
    const paramName = (value as { $param: string }).$param;
    if (paramNames.has(paramName)) {
      return `${name}={${paramName}}`;
    }
  }

  if (
    paramNames &&
    typeof value === "object" &&
    typeof (value as { $if?: unknown }).$if === "string"
  ) {
    const expr = serializeIfExpr(value as IfExpr, paramNames);
    if (expr !== null) return `${name}={${expr}}`;
  }

  if (typeof value === "string") {
    return `${name}=${jsxStringLiteral(value)}`;
  }

  if (typeof value === "boolean") {
    return value ? name : `${name}={false}`;
  }

  if (typeof value === "number") {
    return `${name}={${value}}`;
  }

  // Objects / arrays (sx, style, data props) emit as an idiomatic JS literal —
  // `sx={{ p: 3, "&:hover": { ... } }}` — not JSON with quoted keys.
  return `${name}={${jsLiteral(value)}}`;
}

interface IfExpr {
  $if: string;
  /** When present, the branch tests strict equality instead of truthiness. */
  eq?: unknown;
  then?: unknown;
  else?: unknown;
}

/**
 * Serialize a $if substitution to a JSX expression body (without surrounding
 * braces). Returns null if the param name isn't known. Recurses on the
 * branches so nested $param works.
 */
export function serializeIfExpr(value: IfExpr, paramNames: Set<string>): string | null {
  if (!paramNames.has(value.$if)) return null;
  const then = serializeIfLeaf(value.then, paramNames);
  const els = serializeIfLeaf(value.else, paramNames);
  const test = "eq" in value ? `${value.$if} === ${JSON.stringify(value.eq)}` : value.$if;
  return `${test} ? ${then} : ${els}`;
}

function serializeIfLeaf(v: unknown, paramNames: Set<string>): string {
  if (v === undefined || v === null) return "undefined";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (typeof (v as { $param?: unknown }).$param === "string") {
      const n = (v as { $param: string }).$param;
      if (paramNames.has(n)) return n;
    }
    if (typeof (v as { $if?: unknown }).$if === "string") {
      const inner = serializeIfExpr(v as IfExpr, paramNames);
      if (inner !== null) return `(${inner})`;
    }
  }
  return JSON.stringify(v);
}

/**
 * JSX-safe string literal. Always double-quoted; escape backslashes + quotes;
 * fall back to a JSX expression with a template literal when the value contains
 * characters that don't fit cleanly in a double-quoted attribute (newlines, etc.).
 */
function jsxStringLiteral(value: string): string {
  if (/[\r\n\t]/.test(value) || value.includes("${")) {
    // Drop into a JSX expression with a template literal so newlines survive.
    const inner = value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    return `{\`${inner}\`}`;
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Children that are strings need to be JSX-text-safe. Escape `{`, `}`, `<`, `>`
 * by wrapping the whole text in a JSX expression when needed.
 */
export function serializeTextChild(value: string): string {
  if (/[{}<>]/.test(value)) {
    // Wrap as JSX expression.
    return `{${JSON.stringify(value)}}`;
  }
  return value;
}
