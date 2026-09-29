const CSS_PROPERTY = /^(--[\w-]+|-?[a-z][a-z-]*)$/;

/**
 * CSS declaration text as a React style object (`background-size` ⇒
 * `backgroundSize`, custom properties kept), or null when the text is not a
 * declaration list — a class string, say. Semicolons inside `url(…)` or quotes
 * do not split.
 */
export function styleObjectFromCss(text: string): Record<string, string> | null {
  const declarations: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) {
      declarations.push(text.slice(start, i));
      start = i + 1;
    }
  }
  declarations.push(text.slice(start));
  const style: Record<string, string> = {};
  for (const declaration of declarations) {
    if (declaration.trim() === "") continue;
    const colon = declaration.indexOf(":");
    if (colon < 0) return null;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!CSS_PROPERTY.test(property) || value === "") return null;
    const key = property.startsWith("--")
      ? property
      : property.replace(/^-(ms)-/, "$1-").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    style[key] = value;
  }
  return Object.keys(style).length > 0 ? style : null;
}
