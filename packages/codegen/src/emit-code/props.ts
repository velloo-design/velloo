/**
 * Serialize a single prop (name + value) to a JSX attribute string.
 * Returns null when the prop should be omitted entirely.
 */
export function serializeProp(name: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value === "string") {
    return `${name}=${jsxStringLiteral(value)}`;
  }

  if (typeof value === "boolean") {
    // Idiomatic JSX: <Button asChild /> vs <Button asChild={false} />.
    return value ? name : `${name}={false}`;
  }

  if (typeof value === "number") {
    return `${name}={${value}}`;
  }

  // Objects, arrays, etc — JSON-serialize inside braces. The user can hand-edit
  // post-emit if they need something fancier; this keeps codegen lossless.
  return `${name}={${JSON.stringify(value)}}`;
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
