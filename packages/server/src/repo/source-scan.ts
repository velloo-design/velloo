import { parseLiteral } from "./literal.ts";

/**
 * A static read of one JS/TS module: its imports, re-exports, exported
 * component names and the JSX elements it renders, with literal attribute
 * values. Text-level on purpose — discovery must never execute application
 * code, and it runs over files that may not even typecheck. Comments are
 * blanked (offsets preserved) before any pattern runs, so commented-out JSX
 * and imports don't count.
 */

interface ImportBinding {
  /** The local name in this file. */
  local: string;
  /** `"default"`, a named export, or `"*"` for a namespace import. */
  imported: string;
}

interface ImportDecl {
  specifier: string;
  bindings: ImportBinding[];
  /** `import "./styles.css"` — no bindings, run for its side effect. */
  sideEffect: boolean;
  typeOnly: boolean;
  line: number;
}

interface ReExportDecl {
  specifier: string;
  /** Names re-exported (`export { A, B as C } from`), or null for `export *`. */
  names: { exported: string; imported: string }[] | null;
}

interface JsxAttribute {
  name: string;
  /** Literal JSON value, when the attribute is one. */
  value?: unknown;
  /** Source text of a non-literal `{expression}` (a handler, a variable, JSX). */
  expression?: string;
}

export interface JsxElement {
  /** Full tag, e.g. `Tabs.List`. */
  tag: string;
  line: number;
  attributes: JsxAttribute[];
  /** Plain-text children, when that is all the element contains. */
  text?: string;
  selfClosing: boolean;
}

/** A hook a component calls, with the module it comes from when it's imported. */
export interface HookCall {
  name: string;
  from?: string;
}

export interface ModuleScan {
  imports: ImportDecl[];
  reExports: ReExportDecl[];
  /** PascalCase names this module exports (`"default"` included when the default is one). */
  componentExports: string[];
  /** Name of a PascalCase default-exported declaration, when it has one. */
  defaultExportName?: string;
  elements: JsxElement[];
  /** `"use server"`, `import "server-only"` — never bundled for a browser. */
  serverOnly: boolean;
  /**
   * Per declared component, the non-React hooks its body calls: a store
   * (`useCanvas`), a context, a query client. React's own state hooks are left
   * out — they hold what the component manages, not what it is given.
   */
  hooks: Record<string, HookCall[]>;
}

/** React's own: local state and effects, not a source of application data. */
const REACT_HOOKS = new Set([
  "useState",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useReducer",
  "useId",
  "useTransition",
  "useDeferredValue",
  "useImperativeHandle",
  "useDebugValue",
  "useInsertionEffect",
  "useOptimistic",
  "useActionState",
  "useSyncExternalStore",
]);

export function scanModule(source: string): ModuleScan {
  const code = blankComments(source);
  const lines = lineIndex(code);
  const lineAt = (offset: number): number => {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lines[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const imports: ImportDecl[] = [];
  for (const match of code.matchAll(
    /(^|[;\n}])\s*import\s+(type\s+)?([\w$*{}\s,]+?)\s+from\s*(['"])([^'"\n]+)\4/g,
  )) {
    imports.push({
      specifier: match[5] ?? "",
      bindings: parseImportClause(match[3] ?? ""),
      sideEffect: false,
      typeOnly: Boolean(match[2]),
      line: lineAt(match.index ?? 0),
    });
  }
  for (const match of code.matchAll(/(^|[;\n}])\s*import\s*(['"])([^'"\n]+)\2/g)) {
    imports.push({
      specifier: match[3] ?? "",
      bindings: [],
      sideEffect: true,
      typeOnly: false,
      line: lineAt(match.index ?? 0),
    });
  }

  const reExports: ReExportDecl[] = [];
  for (const match of code.matchAll(
    /export\s+(?:type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{([^}]*)\})\s*from\s*(['"])([^'"\n]+)\3/g,
  )) {
    const list = match[2];
    reExports.push({
      specifier: match[4] ?? "",
      names:
        list === undefined
          ? null
          : splitList(list).map((part) => {
              const [imported, exported] = part.split(/\s+as\s+/).map((s) => s.trim());
              return { imported: imported ?? "", exported: exported ?? imported ?? "" };
            }),
    });
  }

  const componentExports = new Set<string>();
  let defaultExportName: string | undefined;
  for (const match of code.matchAll(
    /export\s+(default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Z][\w$]*)/g,
  )) {
    const name = match[2] ?? "";
    if (match[1]) {
      defaultExportName = name;
      componentExports.add("default");
    } else componentExports.add(name);
  }
  for (const match of code.matchAll(/export\s+default\s+([A-Z][\w$]*)\s*[;\n]/g)) {
    defaultExportName ??= match[1];
    componentExports.add("default");
  }
  for (const match of code.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of splitList(match[1] ?? "")) {
      const [local, exported] = part.split(/\s+as\s+/).map((s) => s.trim());
      const name = exported ?? local ?? "";
      if (name === "default" && local && /^[A-Z]/.test(local)) {
        defaultExportName ??= local;
        componentExports.add("default");
      } else if (/^[A-Z]/.test(name)) componentExports.add(name);
    }
  }

  return {
    imports,
    reExports,
    componentExports: [...componentExports],
    ...(defaultExportName ? { defaultExportName } : {}),
    elements: scanJsx(code, lineAt),
    hooks: scanHooks(code, imports),
    serverOnly:
      /^\s*['"]use server['"]/.test(code) ||
      imports.some((decl) => decl.specifier === "server-only"),
  };
}

/**
 * Hooks each component calls. A declaration's body is taken as the text up to
 * the next top-level declaration — components are written one after another, and
 * this needs no parser to be right about which one called what.
 */
function scanHooks(code: string, imports: ImportDecl[]): Record<string, HookCall[]> {
  const from = new Map<string, string>();
  for (const decl of imports) {
    if (decl.typeOnly) continue;
    for (const binding of decl.bindings) from.set(binding.local, decl.specifier);
  }
  const declarations = [
    ...code.matchAll(
      /(?:^|[;\n}])\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Z][\w$]*)/g,
    ),
  ].map((match) => ({ name: match[1] ?? "", at: match.index ?? 0 }));
  const out: Record<string, HookCall[]> = {};
  for (const [i, declaration] of declarations.entries()) {
    const body = code.slice(declaration.at, declarations[i + 1]?.at ?? code.length);
    const seen = new Map<string, HookCall>();
    for (const call of body.matchAll(/\b(use[A-Z][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)?/g)) {
      const name = call[1] as string;
      if (REACT_HOOKS.has(name) && name !== "useContext") continue;
      // `useContext(ThemeContext)` — the context is what the component needs.
      const label = name === "useContext" && call[2] ? `useContext(${call[2]})` : name;
      const source = from.get(name === "useContext" && call[2] ? call[2] : name);
      if (!seen.has(label)) seen.set(label, { name: label, ...(source ? { from: source } : {}) });
    }
    if (seen.size > 0) out[declaration.name] = [...seen.values()];
  }
  return out;
}

function parseImportClause(clause: string): ImportBinding[] {
  const out: ImportBinding[] = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  const outside = clause.replace(/\{[^}]*\}/, "").trim();
  for (const part of outside
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const ns = /^\*\s+as\s+([\w$]+)$/.exec(part);
    if (ns?.[1]) out.push({ local: ns[1], imported: "*" });
    else if (/^[\w$]+$/.test(part)) out.push({ local: part, imported: "default" });
  }
  if (braces) {
    for (const part of splitList(braces[1] ?? "")) {
      if (/^type\s/.test(part)) continue;
      const [imported, local] = part.split(/\s+as\s+/).map((s) => s.trim());
      if (imported) out.push({ local: local ?? imported, imported });
    }
  }
  return out;
}

function splitList(list: string): string[] {
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Replace comments with spaces, keeping strings (and every offset) intact. */
export function blankComments(source: string): string {
  const out = source.split("");
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 2;
      else {
        if (ch === quote || (ch === "\n" && quote !== "`")) quote = null;
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) if (source[i] !== "\n") out[i] = " ";
      continue;
    }
    i++;
  }
  return out.join("");
}

function lineIndex(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1);
  return starts;
}

/** Characters that may directly precede a JSX `<` (a generic `<` follows an identifier). */
const JSX_LEAD = new Set(["(", "{", ">", "=", "?", ":", ",", "&", "|", "[", ";", "}"]);

function scanJsx(code: string, lineAt: (offset: number) => number): JsxElement[] {
  const out: JsxElement[] = [];
  for (const match of code.matchAll(/<([A-Z][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?=[\s/>])/g)) {
    const start = match.index ?? 0;
    let back = start - 1;
    while (back >= 0 && /\s/.test(code[back] ?? "")) back--;
    const lead = code[back] ?? "";
    const precededByReturn = /\breturn$/.test(code.slice(Math.max(0, back - 6), back + 1));
    if (back >= 0 && !JSX_LEAD.has(lead) && !precededByReturn) continue;
    const tag = match[1] ?? "";
    const parsed = readAttributes(code, start + 1 + tag.length);
    if (!parsed) continue;
    const element: JsxElement = {
      tag,
      line: lineAt(start),
      attributes: parsed.attributes,
      selfClosing: parsed.selfClosing,
    };
    if (!parsed.selfClosing) {
      const close = `</${tag}>`;
      const next = code.indexOf("<", parsed.end);
      const brace = code.indexOf("{", parsed.end);
      if (next !== -1 && code.startsWith(close, next) && (brace === -1 || brace > next)) {
        const text = code.slice(parsed.end, next).replace(/\s+/g, " ").trim();
        if (text) element.text = text;
      }
    }
    out.push(element);
  }
  return out;
}

function readAttributes(
  code: string,
  from: number,
): { attributes: JsxAttribute[]; selfClosing: boolean; end: number } | null {
  const attributes: JsxAttribute[] = [];
  let i = from;
  const limit = Math.min(code.length, from + 8000);
  while (i < limit) {
    while (i < limit && /\s/.test(code[i] ?? "")) i++;
    if (code.startsWith("/>", i)) return { attributes, selfClosing: true, end: i + 2 };
    if (code[i] === ">") return { attributes, selfClosing: false, end: i + 1 };
    if (code[i] === "{") {
      const close = matchBrace(code, i);
      if (close === -1) return null;
      i = close + 1;
      continue;
    }
    const name = /^[A-Za-z_$][\w$:-]*/.exec(code.slice(i, i + 200))?.[0];
    if (!name) return null;
    i += name.length;
    while (i < limit && /\s/.test(code[i] ?? "")) i++;
    if (code[i] !== "=") {
      attributes.push({ name, value: true });
      continue;
    }
    i++;
    while (i < limit && /\s/.test(code[i] ?? "")) i++;
    const quote = code[i];
    if (quote === '"' || quote === "'") {
      const end = code.indexOf(quote, i + 1);
      if (end === -1) return null;
      attributes.push({ name, value: code.slice(i + 1, end) });
      i = end + 1;
    } else if (quote === "{") {
      const close = matchBrace(code, i);
      if (close === -1) return null;
      const inner = code.slice(i + 1, close).trim();
      const literal = parseLiteral(inner);
      attributes.push(literal.ok ? { name, value: literal.value } : { name, expression: inner });
      i = close + 1;
    } else return null;
  }
  return null;
}

function matchBrace(code: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
