/** A JS object key: bare when it's a valid identifier, quoted otherwise (`"&:hover"`). */
function jsObjectKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Serialize a value as an idiomatic JS literal for source code: object keys are
 * unquoted where valid, strings double-quoted, nested objects/arrays recursed.
 * Used for object-valued JSX props (MUI's `sx`, the inline `style` escape
 * hatch) and the MUI `createTheme(...)` artifact. `undefined` entries are
 * dropped from objects.
 */
export function jsLiteral(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(jsLiteral).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${jsObjectKey(k)}: ${jsLiteral(v)}`);
    return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}
