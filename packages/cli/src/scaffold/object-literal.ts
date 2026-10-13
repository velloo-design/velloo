/**
 * A hand-rolled scanner replaces ts-morph here: reading a theme module (MUI's
 * `createTheme`, Mantine's) is the CLI's only AST use,
 * and ts-morph bundles a full TypeScript compiler (~15MB) into every user
 * install for a feature that is explicitly best-effort. Only inline literals
 * are understood: strings, numbers, and objects and arrays of them. Anything
 * else a property holds (a call, an identifier, a template substitution) is
 * kept as `Code` — its source text, never a value — and a spread is skipped.
 * Never executes user code.
 */

/**
 * What a property holds when it is not an inline literal: `brand` for
 * `{ brand }`, `generateColors("#375EAC")` for a call. A reader can say what
 * the app wrote, or follow a name to the `const` that holds it.
 */
export class Code {
  constructor(readonly text: string) {}
}

/** A parsed inline literal: string, number, or a nested object or array of them. */
export type LiteralValue = string | number | LiteralObject | LiteralValue[] | Code;
export type LiteralObject = Map<string, LiteralValue>;

const IDENT_CHAR = /[A-Za-z0-9_$]/;

function skipWs(code: string, i: number): number {
  while (i < code.length && /\s/.test(code.charAt(i))) i++;
  return i;
}

/** Index just past the closing quote of the string/template opening at `i` (raw skip, no value). */
function scanString(code: string, i: number): number {
  const quote = code.charAt(i);
  i++;
  while (i < code.length) {
    const ch = code.charAt(i);
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && code.charAt(i + 1) === "{") {
      i = scanBalanced(code, i + 1);
      continue;
    }
    if (quote !== "`" && ch === "\n") return i; // unterminated — bail at the line break
    i++;
  }
  return i;
}

/** Index just past the `{`/`(`/`[` group opening at `i`, skipping nested strings. */
function scanBalanced(code: string, i: number): number {
  const open = code.charAt(i);
  const close = open === "{" ? "}" : open === "(" ? ")" : "]";
  let depth = 0;
  while (i < code.length) {
    const ch = code.charAt(i);
    if (ch === '"' || ch === "'" || ch === "`") {
      i = scanString(code, i);
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Strip line and block comments, leaving string/template contents intact.
 * Regex literals are not modeled (a `/` starting one is read as division) —
 * acceptable for theme modules, and failure just means a null import.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === "/" && src.charAt(i + 1) === "/") {
      while (i < src.length && src.charAt(i) !== "\n") i++;
      continue;
    }
    if (ch === "/" && src.charAt(i + 1) === "*") {
      i += 2;
      while (i < src.length && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = scanString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/**
 * The cooked value of the string/template literal opening at `i`. Undefined
 * for unterminated strings and templates with `${…}` substitutions (a
 * substitution makes it a non-literal). `\u`/`\x` sequences degrade to their
 * raw letters — colors and font stacks never use them.
 */
function parseStringLiteral(code: string, i: number): { value: string; end: number } | undefined {
  const quote = code.charAt(i);
  let out = "";
  let j = i + 1;
  while (j < code.length) {
    const ch = code.charAt(j);
    if (ch === "\\") {
      const next = code.charAt(j + 1);
      out += ESCAPES[next] ?? next;
      j += 2;
      continue;
    }
    if (ch === quote) return { value: out, end: j + 1 };
    if (quote === "`" && ch === "$" && code.charAt(j + 1) === "{") return undefined;
    if (quote !== "`" && ch === "\n") return undefined;
    out += ch;
    j++;
  }
  return undefined;
}

function parseNumber(code: string, i: number): { value: number; end: number } | undefined {
  const m = /^(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?/.exec(code.slice(i));
  if (!m) return undefined;
  const value = Number(m[0].replace(/_/g, ""));
  if (Number.isNaN(value)) return undefined;
  return { value, end: i + m[0].length };
}

function parseValue(code: string, i: number): { value: LiteralValue; end: number } | undefined {
  const ch = code.charAt(i);
  if (ch === '"' || ch === "'" || ch === "`") return parseStringLiteral(code, i);
  if (ch === "{") return parseObjectLiteral(code, i);
  if (ch === "[") return parseArrayLiteral(code, i);
  if (/[\d.]/.test(ch)) return parseNumber(code, i);
  return undefined;
}

/** The array literal opening at `i`, when every element is an inline literal. */
function parseArrayLiteral(
  code: string,
  i: number,
): { value: LiteralValue[]; end: number } | undefined {
  const items: LiteralValue[] = [];
  i++;
  for (;;) {
    i = skipWs(code, i);
    if (i >= code.length) return undefined;
    const ch = code.charAt(i);
    if (ch === "]") return { value: items, end: i + 1 };
    if (ch === ",") {
      i++;
      continue;
    }
    const parsed = parseValue(code, i);
    if (!parsed) return undefined;
    const after = skipWs(code, parsed.end);
    const term = code.charAt(after);
    if (term !== "," && term !== "]") return undefined;
    items.push(parsed.value);
    i = after;
  }
}

/** Index of the `,` or `}` ending the current object entry (not consumed). */
function skipEntry(code: string, i: number): number {
  while (i < code.length) {
    const ch = code.charAt(i);
    if (ch === "," || ch === "}") return i;
    if (ch === '"' || ch === "'" || ch === "`") {
      i = scanString(code, i);
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      i = scanBalanced(code, i);
      continue;
    }
    i++;
  }
  return i;
}

/**
 * Parse the object literal opening at `i`. An entry whose key is an identifier
 * or string is kept: its value when that is an inline literal, the source it
 * was written as (`Code`) otherwise — a shorthand, a call, `10 as const`.
 * Spreads, methods and computed keys are skipped entry-by-entry. Undefined
 * only when the braces never close.
 */
function parseObjectLiteral(
  code: string,
  i: number,
): { value: LiteralObject; end: number } | undefined {
  const obj: LiteralObject = new Map();
  i++;
  for (;;) {
    i = skipWs(code, i);
    if (i >= code.length) return undefined;
    const ch = code.charAt(i);
    if (ch === "}") return { value: obj, end: i + 1 };
    if (ch === ",") {
      i++;
      continue;
    }

    let key: string | undefined;
    if (ch === '"' || ch === "'") {
      const parsed = parseStringLiteral(code, i);
      if (parsed) {
        key = parsed.value;
        i = parsed.end;
      }
    } else {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(code.slice(i));
      if (m) {
        key = m[0];
        i += m[0].length;
      }
    }
    i = skipWs(code, i);
    if (key !== undefined && (code.charAt(i) === "," || code.charAt(i) === "}")) {
      obj.set(key, new Code(key));
      continue;
    }
    if (key === undefined || code.charAt(i) !== ":") {
      i = skipEntry(code, i);
      continue;
    }

    const valueStart = skipWs(code, i + 1);
    const parsed = parseValue(code, valueStart);
    if (parsed) {
      const after = skipWs(code, parsed.end);
      // Only a value that ends the entry cleanly is a literal — `10 as const`
      // is an expression.
      const term = code.charAt(after);
      if (term === "," || term === "}") {
        obj.set(key, parsed.value);
        i = after;
        continue;
      }
    }
    i = skipEntry(code, valueStart);
    obj.set(key, new Code(code.slice(valueStart, i).trim()));
  }
}

/** Index of the `(` of the first `callee(…)` / `xxx.callee(…)` call, skipping strings. */
function findCall(code: string, callee: string): number | undefined {
  let i = 0;
  while (i < code.length) {
    const ch = code.charAt(i);
    if (ch === '"' || ch === "'" || ch === "`") {
      i = scanString(code, i);
      continue;
    }
    if (code.startsWith(callee, i)) {
      const before = code.charAt(i - 1);
      const after = code.charAt(i + callee.length);
      if ((i === 0 || !IDENT_CHAR.test(before)) && !IDENT_CHAR.test(after)) {
        const paren = skipWs(code, i + callee.length);
        if (code.charAt(paren) === "(") return paren;
      }
    }
    i++;
  }
  return undefined;
}

/** The first argument of the first `callee(...)` call, when it is an object literal. */
export function callArgument(src: string, callee: string): LiteralObject | undefined {
  const code = stripComments(src);
  const paren = findCall(code, callee);
  if (paren === undefined) return undefined;
  const arg = skipWs(code, paren + 1);
  if (code.charAt(arg) !== "{") return undefined;
  return parseObjectLiteral(code, arg)?.value;
}

/**
 * The object literal a pattern leads up to: `after` matches the source just
 * before its opening brace (`: MantineThemeOverride = `, `theme={`).
 */
export function objectAfter(src: string, after: RegExp): LiteralObject | undefined {
  const code = stripComments(src);
  const found = after.exec(code);
  if (!found) return undefined;
  const open = skipWs(code, found.index + found[0].length);
  if (code.charAt(open) !== "{") return undefined;
  return parseObjectLiteral(code, open)?.value;
}

/** What `const name = …` (typed or not) holds, when that is an inline literal. */
export function constLiteral(src: string, name: string): LiteralValue | undefined {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return undefined;
  const code = stripComments(src);
  const declared = new RegExp(
    `\\bconst\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^=;]*=\\s*`,
  ).exec(code);
  if (!declared) return undefined;
  return parseValue(code, declared.index + declared[0].length)?.value;
}

/** The value of `name` on an object literal, or undefined. */
export function prop(obj: LiteralObject, name: string): LiteralValue | undefined {
  return obj.get(name);
}

export function asObject(value: LiteralValue | undefined): LiteralObject | undefined {
  return value instanceof Map ? value : undefined;
}

/** A string literal value (`"#1976d2"`, `'Inter'`), unquoted. */
export function asString(value: LiteralValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: LiteralValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** An array of string literals — a colour's shades. */
export function asStrings(value: LiteralValue | undefined): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

export function asCode(value: LiteralValue | undefined): Code | undefined {
  return value instanceof Code ? value : undefined;
}
