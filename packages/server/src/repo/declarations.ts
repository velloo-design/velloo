import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ControlType, PropDescriptor } from "@velloo/provider";
import { blankComments } from "./source-scan.ts";

/**
 * Authoring metadata from the host's own type declarations — read as text,
 * without a compiler. A component's props come from its `<Name>Props`
 * interface or type literal (`<Root><Member>Props` for a compound part), with
 * literal unions resolved through the string-literal aliases the declarations
 * define, JSDoc kept, and a `@default` tag lifted into `defaultValue`. Types we
 * can't model stay visible as pass-through fields with a constraint rather than
 * dropping the component from the catalog.
 */

export interface RepoPropDescriptor extends PropDescriptor {
  description?: string | undefined;
  /** Takes a React node (`leftSection`, `icon`) — placeable as a nested design node. */
  slot?: boolean | undefined;
  /** False for functions, refs, class instances — values a design can't hold. */
  serializable: boolean;
  /** Why a non-serializable prop can't be set from the design, and what to do instead. */
  constraint?: string | undefined;
  /** Declared by an inherited base (`BoxProps`) rather than the component itself. */
  inherited?: boolean | undefined;
}

export interface DeclarationIndex {
  /** `<Name>Props` → its member block (and inherited type names). */
  props: Map<string, { body: string; extends: string[] }>;
  /** String/number literal-union aliases: `MantineSize` → `['xs', …]`. */
  literalAliases: Map<string, (string | number)[]>;
  /** Compound members declared through a `staticComponents: { … }` block. */
  staticMembers: Map<string, string[]>;
  /**
   * `cva(…)` variant tables by the const they're assigned to (`buttonVariants`):
   * variant name → its option keys, plus `defaultVariants`. Read as text, so a
   * design system using CVA-like helpers needs no CVA to be cataloged.
   */
  variantTables: Map<string, { variants: Map<string, string[]>; defaults: Map<string, string> }>;
}

const MAX_DECLARATION_FILES = 1200;
const MAX_DECLARATION_BYTES = 1_000_000;

export function emptyIndex(): DeclarationIndex {
  return {
    props: new Map(),
    literalAliases: new Map(),
    staticMembers: new Map(),
    variantTables: new Map(),
  };
}

/** Index one source/declaration text into `index`. */
function indexDeclarations(source: string, index: DeclarationIndex): void {
  const code = keepDocComments(source);
  for (const match of code.matchAll(
    /(?:export\s+)?(?:declare\s+)?interface\s+([A-Z][\w$]*Props)\b(?:<[^>{]*>)?\s*(?:extends\s+([^{]+))?\{/g,
  )) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchBrace(code, open);
    if (close === -1) continue;
    const name = match[1] ?? "";
    if (!index.props.has(name)) {
      index.props.set(name, {
        body: code.slice(open + 1, close),
        extends: splitTopLevel(match[2] ?? "", ",")
          .map((s) => s.trim().replace(/<[\s\S]*$/, ""))
          .filter(Boolean),
      });
    }
  }
  for (const match of code.matchAll(
    /(?:export\s+)?(?:declare\s+)?type\s+([A-Z][\w$]*Props)\b(?:<[^>=]*>)?\s*=\s*\{/g,
  )) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchBrace(code, open);
    if (close === -1) continue;
    const name = match[1] ?? "";
    if (!index.props.has(name))
      index.props.set(name, { body: code.slice(open + 1, close), extends: [] });
  }
  // A component typed at its parameter — `function X({ a }: { a: string })` or
  // `(props: Other) =>` — is filed as `XProps`, so it reads like a declared one.
  for (const match of code.matchAll(
    /(?:function\s+([A-Z][\w$]*)\s*(?:<[^>(]*>)?\s*|const\s+([A-Z][\w$]*)\s*=\s*(?:(?:React\.)?(?:memo|forwardRef)\s*\(\s*)?(?:function\s*[\w$]*\s*)?)\(/g,
  )) {
    const name = `${match[1] ?? match[2] ?? ""}Props`;
    if (index.props.has(name)) continue;
    const annotation = parameterType(code, (match.index ?? 0) + match[0].length);
    if (annotation?.body !== undefined) {
      index.props.set(name, { body: annotation.body, extends: annotation.extends ?? [] });
    } else if (annotation?.named && annotation.named !== name) {
      index.props.set(name, { body: "", extends: [annotation.named] });
    }
  }
  for (const match of code.matchAll(
    /type\s+([A-Z][\w$]*)\s*=\s*((?:\s*\|?\s*(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?))+)\s*;/g,
  )) {
    const values = literalUnion(match[2] ?? "");
    if (values) index.literalAliases.set(match[1] ?? "", values);
  }
  for (const match of code.matchAll(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:cva|tv|cx?Variants?)\s*\(/g,
  )) {
    const call = code.slice(match.index ?? 0, (match.index ?? 0) + 20_000);
    const variantsAt = call.search(/\bvariants\s*:\s*\{/);
    if (variantsAt < 0) continue;
    const open = call.indexOf("{", variantsAt);
    const close = matchBrace(call, open);
    if (close < 0) continue;
    const variants = new Map<string, string[]>();
    for (const [name, body] of topLevelObjectKeys(call.slice(open + 1, close))) {
      const keys = body ? topLevelObjectKeys(body).map(([key]) => key) : [];
      if (keys.length > 0) variants.set(name, keys);
    }
    const defaults = new Map<string, string>();
    const defaultsAt = call.search(/\bdefaultVariants\s*:\s*\{/);
    if (defaultsAt >= 0) {
      const dOpen = call.indexOf("{", defaultsAt);
      const dClose = matchBrace(call, dOpen);
      for (const m of call
        .slice(dOpen + 1, dClose)
        .matchAll(/([A-Za-z_$][\w$]*)\s*:\s*['"]([^'"]+)['"]/g)) {
        defaults.set(m[1] ?? "", m[2] ?? "");
      }
    }
    if (variants.size > 0) index.variantTables.set(match[1] ?? "", { variants, defaults });
  }
  // Anchor on each `staticComponents` block and look back for its declaration:
  // a lazy `declare const … staticComponents` pattern is quadratic on the
  // multi-megabyte declaration files icon packs ship.
  for (const match of code.matchAll(/staticComponents:\s*\{([^}]*)\}/g)) {
    const before = code.slice(Math.max(0, (match.index ?? 0) - 4000), match.index);
    const owner = [...before.matchAll(/declare\s+const\s+([A-Z][\w$]*)\s*:/g)].at(-1)?.[1];
    const members = [...(match[1] ?? "").matchAll(/([A-Z][\w$]*)\s*:/g)].map((m) => m[1] ?? "");
    if (owner && members.length > 0 && !index.staticMembers.has(owner)) {
      index.staticMembers.set(owner, members);
    }
  }
}

/**
 * Walk a package's type entry through its `export … from` graph and index what
 * it declares. Bounded: a design system re-exports every component through a
 * barrel, but the walk never leaves the package.
 */
export function indexPackageDeclarations(packageName: string, hostRoot: string): DeclarationIndex {
  const index = emptyIndex();
  const entry = packageTypesEntry(packageName, hostRoot);
  if (!entry) return index;
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < MAX_DECLARATION_FILES) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      // An icon pack's single declaration file runs to megabytes of one-line
      // components with no props worth extracting; skip rather than scan it.
      if (statSync(file).size > MAX_DECLARATION_BYTES) continue;
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    indexDeclarations(source, index);
    for (const match of source.matchAll(/(?:export|import)[^'"]*?from\s*['"](\.[^'"]+)['"]/g)) {
      const next = resolveDeclaration(dirname(file), match[1] ?? "");
      if (next) queue.push(next);
    }
  }
  return index;
}

/**
 * PascalCase names a package's type entry exports, through its `export … from`
 * graph. Unlike the props index this reads icon packs' multi-megabyte files
 * too — every pattern here is linear — since an icon is exactly what an agent
 * reaches for that the app's own JSX never names (it picks one from data).
 */
export function packageExportNames(packageName: string, hostRoot: string): Set<string> {
  const names = new Set<string>();
  const entry = packageTypesEntry(packageName, hostRoot);
  if (!entry) return names;
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < MAX_DECLARATION_FILES) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(
      /export\s+(?:declare\s+)?(?:const|function|class|let|var)\s+([A-Z][\w$]*)/g,
    )) {
      names.add(match[1] ?? "");
    }
    for (const match of source.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
      for (const part of (match[1] ?? "").split(",")) {
        const exported =
          part
            .trim()
            .split(/\s+as\s+/)
            .at(-1)
            ?.trim() ?? "";
        if (/^[A-Z][\w$]*$/.test(exported)) names.add(exported);
      }
    }
    for (const match of source.matchAll(/export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const next = resolveDeclaration(dirname(file), match[1] ?? "");
      if (next) queue.push(next);
    }
  }
  return names;
}

function packageTypesEntry(packageName: string, hostRoot: string): string | null {
  let pkgJsonPath: string;
  try {
    pkgJsonPath = Bun.resolveSync(`${packageName}/package.json`, hostRoot);
  } catch {
    return null;
  }
  const root = dirname(pkgJsonPath);
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as Record<string, unknown>;
    const candidates: unknown[] = [pkg.types, pkg.typings];
    const dot = (pkg.exports as Record<string, unknown> | undefined)?.["."];
    if (dot && typeof dot === "object") {
      const d = dot as Record<string, unknown>;
      candidates.push(
        d.types,
        (d.import as Record<string, unknown> | undefined)?.types,
        (d.require as Record<string, unknown> | undefined)?.types,
      );
    }
    for (const candidate of candidates) {
      if (typeof candidate === "string" && existsSync(join(root, candidate))) {
        return join(root, candidate);
      }
    }
  } catch {
    return null;
  }
  for (const guess of ["index.d.ts", "dist/index.d.ts", "lib/index.d.ts"]) {
    if (existsSync(join(root, guess))) return join(root, guess);
  }
  return null;
}

/** A relative specifier's declaration or source file, trying the usual extensions. */
export function resolveDeclaration(dir: string, specifier: string): string | null {
  const base = join(dir, specifier.replace(/\.(m|c)?js$/, ""));
  for (const candidate of [
    `${base}.d.ts`,
    `${base}.d.mts`,
    `${base}.d.cts`,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.d.ts"),
    join(base, "index.d.mts"),
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Props for `name` (`Tabs`, or `Tabs.List` → `TabsListProps`). Inherited
 * interfaces found in the same index merge in underneath, so a local
 * `CardProps extends BaseProps` keeps its base's fields; unknown bases (a
 * library's `BoxProps`) are simply not expanded.
 */
export function propsFor(name: string, index: DeclarationIndex): RepoPropDescriptor[] | null {
  const interfaceName = `${name.replace(/\./g, "")}Props`;
  const root = index.props.get(interfaceName);
  if (!root) return null;
  // Own members first, inherited ones after: a Mantine component inherits ~60
  // style props from `BoxProps`, which must not bury the handful it defines.
  const own = new Map(parseMembers(root.body, index).map((prop) => [prop.name, prop]));
  const inherited = new Map<string, RepoPropDescriptor>();
  const visit = (decl: { body: string; extends: string[] }, depth: number): void => {
    for (const parent of decl.extends) {
      const base = index.props.get(parent);
      if (!base || depth >= 4) continue;
      visit(base, depth + 1);
      for (const prop of parseMembers(base.body, index)) {
        if (!own.has(prop.name)) inherited.set(prop.name, { ...prop, inherited: true });
      }
    }
  };
  visit(root, 0);
  const variants = index.literalAliases.get(`${name.replace(/\./g, "")}Variant`);
  if (variants) {
    inherited.delete("variant");
    own.set("variant", {
      name: "variant",
      type: variants.map((v) => JSON.stringify(v)).join(" | "),
      optional: true,
      control: "enum",
      enumValues: variants,
      serializable: true,
    });
  }
  return [...own.values(), ...inherited.values()];
}

function parseMembers(body: string, index: DeclarationIndex): RepoPropDescriptor[] {
  const out: RepoPropDescriptor[] = [];
  for (const raw of memberChunks(body)) {
    const text = raw.trim();
    if (!text) continue;
    const doc = /\/\*\*([\s\S]*?)\*\//.exec(text)?.[1];
    const member = text.replace(/\/\*\*[\s\S]*?\*\//g, "").trim();
    const match = /^(?:readonly\s+)?(['"]?)([A-Za-z_$][\w$-]*)\1(\?)?\s*:\s*([\s\S]+?)[,;]?$/.exec(
      member,
    );
    if (!match) {
      const method =
        /^([A-Za-z_$][\w$]*)(\?)?\s*(?:<[^>]*>)?\s*(\([\s\S]*\))\s*:\s*([\s\S]+?)[,;]?$/.exec(
          member,
        );
      if (method) {
        const type = `${method[3]} => ${method[4]}`.replace(/\s+/g, " ").trim();
        out.push(describe(method[1] ?? "", type, Boolean(method[2]), doc, index));
      }
      continue;
    }
    const name = match[2] ?? "";
    const type = (match[4] ?? "").replace(/\s+/g, " ").trim();
    out.push(describe(name, type, Boolean(match[3]), doc, index));
  }
  return out;
}

// A property (`name?:`) or a method signature (`onSubmit(): void`); the method's
// `(` is left unread so its parameter list nests like any other bracket.
const MEMBER_START =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?(?:readonly\s+)?(?:['"]?[A-Za-z_$][\w$-]*['"]?\??\s*:|[A-Za-z_$][\w$]*\??\s*(?=[(<]))/;

/**
 * Split a type body into members, each with the doc comment above it. Members
 * end in `;`, `,` or — in hand-written source — just a newline, so a member
 * starts wherever, at nesting depth 0, a (doc-commented) `name:` begins right
 * after a separator. Nested object types and multi-line unions stay whole.
 */
function memberChunks(body: string): string[] {
  const starts: number[] = [];
  let depth = 0;
  let quote: string | null = null;
  let boundary = true;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? "";
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    const head =
      depth === 0 && boundary && !/\s/.test(ch) ? MEMBER_START.exec(body.slice(i, i + 400)) : null;
    if (head) {
      // Step over the doc comment and `name:` together, so the newline
      // between them isn't read as the end of a member.
      starts.push(i);
      boundary = false;
      i += head[0].length - 1;
      continue;
    }
    if (body.startsWith("/*", i)) {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? body.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch) && !(ch === ">" && body[i - 1] === "="))
      depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ";" || ch === "," || ch === "\n")) boundary = true;
    else if (!/\s/.test(ch)) boundary = false;
  }
  return starts.map((start, i) => body.slice(start, starts[i + 1] ?? body.length));
}

function describe(
  name: string,
  type: string,
  optional: boolean,
  doc: string | undefined,
  index: DeclarationIndex,
): RepoPropDescriptor {
  const description = doc
    ?.replace(/^\s*\*\s?/gm, "")
    .replace(/@default[\s\S]*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const defaultRaw = doc
    ? /@default\s+`?([^`\n]+?)`?\s*(?:\*|$)/m.exec(doc)?.[1]?.trim()
    : undefined;
  const base = {
    name,
    type,
    optional,
    ...(description ? { description } : {}),
    ...(defaultRaw ? { defaultValue: defaultRaw.replace(/^['"]|['"]$/g, "") } : {}),
  };
  const union = splitTopLevel(type, "|")
    .map((part) => part.trim())
    // A leading `|` (a union laid out one option per line) leaves an empty part.
    .filter(
      (part) => part !== "" && part !== "undefined" && part !== "null" && part !== "(string & {})",
    );
  if (/=>/.test(type) || /^(?:React\.)?(?:Ref|RefObject|ForwardedRef)</.test(type)) {
    return {
      ...base,
      control: "string",
      serializable: false,
      constraint: "Takes a function or ref, which a design can't hold — the app wires it up.",
    };
  }
  if (union.some((part) => /^(?:React\.)?(?:ReactNode|ReactElement|JSX\.Element)\b/.test(part))) {
    return { ...base, control: "string", slot: true, serializable: true };
  }
  const values: (string | number)[] = [];
  let open = false;
  for (const part of union) {
    const literal = literalUnion(part);
    const alias = index.literalAliases.get(part);
    if (literal) values.push(...literal);
    else if (alias) values.push(...alias);
    else open = true;
  }
  if (values.length > 0 && !open) {
    return { ...base, control: "enum", enumValues: [...new Set(values)], serializable: true };
  }
  if (union.every((part) => part === "boolean" || part === "true" || part === "false")) {
    return { ...base, control: "boolean", serializable: true };
  }
  if (union.every((part) => part === "number"))
    return { ...base, control: "number", serializable: true };
  const control: ControlType = /color/i.test(name) ? "color" : "string";
  return {
    ...base,
    control,
    serializable: true,
    ...(values.length > 0 ? { enumValues: [...new Set(values)] } : {}),
  };
}

/**
 * The type annotation on a function's first parameter, read from just after its
 * `(`: an inline `{ … }` body, a type declared in the same file (inlined, since
 * a file-local `Props` means nothing elsewhere), or another type's name.
 */
function parameterType(
  code: string,
  from: number,
): { body?: string; extends?: string[]; named?: string } | null {
  let i = from;
  const skip = () => {
    while (/\s/.test(code[i] ?? "")) i++;
  };
  skip();
  if (code[i] === "{") {
    const close = matchBrace(code, i);
    if (close === -1) return null;
    i = close + 1;
  } else {
    const id = /^[A-Za-z_$][\w$]*/.exec(code.slice(i, i + 100))?.[0];
    if (!id) return null;
    i += id.length;
  }
  skip();
  if (code[i] !== ":") return null;
  i++;
  skip();
  if (code[i] === "{") {
    const close = matchBrace(code, i);
    return close === -1 ? null : { body: code.slice(i + 1, close) };
  }
  const named = /^[A-Z][\w$]*/.exec(code.slice(i, i + 100))?.[0];
  if (!named) return null;
  const local = new RegExp(
    `(?:interface\\s+${named}\\b(?:<[^>{]*>)?\\s*(?:extends\\s+([^{]+))?|type\\s+${named}\\b(?:<[^>=]*>)?\\s*=\\s*)\\{`,
  ).exec(code);
  if (local) {
    const open = local.index + local[0].length - 1;
    const close = matchBrace(code, open);
    if (close !== -1) {
      const bases = splitTopLevel(local[1] ?? "", ",")
        .map((base) => base.trim().replace(/<[\s\S]*$/, ""))
        .filter(Boolean);
      return { body: code.slice(open + 1, close), extends: bases };
    }
  }
  return { named };
}

function literalUnion(text: string): (string | number)[] | null {
  const parts = splitTopLevel(text, "|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out: (string | number)[] = [];
  for (const part of parts) {
    const str = /^(['"])(.*)\1$/.exec(part);
    if (str) out.push(str[2] ?? "");
    else if (/^-?\d+(\.\d+)?$/.test(part)) out.push(Number(part));
    else return null;
  }
  return out;
}

/** Split on any of `seps` outside brackets, braces, parens, angle brackets and strings. */
function splitTopLevel(text: string, seps: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (text.startsWith("/**", i)) {
      const end = text.indexOf("*/", i + 3);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{<".includes(ch)) depth++;
    else if (")]}>".includes(ch) && !(ch === ">" && text[i - 1] === "="))
      depth = Math.max(0, depth - 1);
    else if (depth === 0 && seps.includes(ch)) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Blank line and block comments, but keep `/** … *\/` doc comments. */
function keepDocComments(source: string): string {
  const docs: string[] = [];
  // Private-use markers: they never occur in source, and survive blanking.
  const marked = source.replace(/\/\*\*[\s\S]*?\*\//g, (doc) => {
    docs.push(doc);
    return `\ue000${docs.length - 1}\ue000`;
  });
  return blankComments(marked).replace(
    /\ue000(\d+)\ue000/g,
    (_, i: string) => docs[Number(i)] ?? "",
  );
}

function matchBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Index a local component's module and whatever it re-exports locally — the
 * app often imports a component through a barrel (`components/index.ts`)
 * that only forwards to the file that declares its props.
 */
export function indexLocalDeclarations(
  file: string,
  index: DeclarationIndex,
  seen: Set<string>,
): void {
  const queue = [file];
  let budget = 60;
  while (queue.length > 0 && budget-- > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    let source: string;
    try {
      source = readFileSync(next, "utf8");
    } catch {
      continue;
    }
    indexDeclarations(source, index);
    for (const match of source.matchAll(/export[^'";]*?from\s*['"](\.[^'"]+)['"]/g)) {
      const target = resolveDeclaration(dirname(next), match[1] ?? "");
      if (target) queue.push(target);
    }
  }
}

/**
 * Keys at depth 0 of an object body, each with its value's inner body when the
 * value is itself an object (`{ default: "…", outline: "…" }`).
 */
function topLevelObjectKeys(body: string): [string, string | null][] {
  const out: [string, string | null][] = [];
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? "";
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (depth === 0) {
      const key = /^(?:["']([^"']+)["']|([A-Za-z_$][\w$-]*))\s*:/.exec(body.slice(i));
      if (key && (i === 0 || /[\s,{]/.test(body[i - 1] ?? ""))) {
        const name = key[1] ?? key[2] ?? "";
        let j = i + key[0].length;
        while (/\s/.test(body[j] ?? "")) j++;
        if (body[j] === "{") {
          const close = matchBrace(body, j);
          out.push([name, close < 0 ? null : body.slice(j + 1, close)]);
          i = close < 0 ? body.length : close;
        } else {
          out.push([name, null]);
          i = j - 1;
        }
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
  }
  return out;
}

/**
 * Enum props from the variant table a component is styled with — by the
 * `<name>Variants` convention (`Button` ↔ `buttonVariants`), since the link
 * lives in the component's body, not its declaration.
 */
export function variantPropsFor(name: string, index: DeclarationIndex): RepoPropDescriptor[] {
  const root = (name.split(".")[0] ?? name).toLowerCase();
  for (const [table, { variants, defaults }] of index.variantTables) {
    if (table.toLowerCase() !== `${root}variants`) continue;
    return [...variants].map(([prop, values]) => ({
      name: prop,
      type: values.map((value) => JSON.stringify(value)).join(" | "),
      optional: true,
      control: "enum" as const,
      enumValues: values,
      serializable: true,
      ...(defaults.get(prop) ? { defaultValue: defaults.get(prop) } : {}),
    }));
  }
  return [];
}
