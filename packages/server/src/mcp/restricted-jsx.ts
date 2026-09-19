import type { ComponentProvider } from "@velloo/provider";
import type {
  ComponentNode,
  Node,
  RepoComponentRef,
  Screen,
  Snippet,
  SnippetInstance,
} from "@velloo/schema";
import type { MutationContext } from "../mutations/context.ts";
import { nearestRefs } from "../mutations/errors.ts";
import { providerForScreen, registryForScreen } from "../mutations/lookup.ts";

export interface JsxIssue {
  message: string;
  offset: number;
  line: number;
  column: number;
}

export type CompileJsxResult = { ok: true; node: Node } | { ok: false; issues: JsxIssue[] };

interface Attribute {
  name: string;
  value: unknown;
  offset: number;
}

interface Element {
  tag: string | null;
  attributes: Attribute[];
  children: Array<Element | TextNode>;
  offset: number;
}

/** `icon={<IconBolt />}` — an element passed as a prop, compiled to a node. */
class ElementValue {
  constructor(readonly element: Element) {}
}

interface TextNode {
  text: string;
  offset: number;
}

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

/**
 * Data-only JSX brace parser. It intentionally accepts the ergonomic subset
 * people write in JSX objects (bare keys, single quotes, trailing commas) but
 * has no grammar for identifiers as values, member access, calls, functions,
 * spreads, or templates. Nothing is evaluated.
 */
class DataLiteralParser {
  private pos = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.value();
    this.ws();
    if (this.pos !== this.source.length) throw new Error("unexpected token");
    return value;
  }

  private value(): unknown {
    this.ws();
    const char = this.source[this.pos];
    if (char === "{") return this.object();
    if (char === "[") return this.array();
    if (char === '"' || char === "'") return this.string();
    const tail = this.source.slice(this.pos);
    for (const [token, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (tail.startsWith(token) && !/[A-Za-z0-9_$]/.test(tail[token.length] ?? "")) {
        this.pos += token.length;
        return value;
      }
    }
    const number = tail.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      this.pos += number[0].length;
      return Number(number[0]);
    }
    throw new Error("expected a data literal");
  }

  private object(): Record<string, unknown> {
    this.pos++;
    const out: Record<string, unknown> = {};
    this.ws();
    if (this.take("}")) return out;
    for (;;) {
      this.ws();
      const char = this.source[this.pos];
      const key = char === '"' || char === "'" ? this.string() : this.identifier();
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error("unsafe object key");
      }
      this.ws();
      if (!this.take(":")) throw new Error("expected colon");
      out[key] = this.value();
      this.ws();
      if (this.take("}")) return out;
      if (!this.take(",")) throw new Error("expected comma");
      this.ws();
      if (this.take("}")) return out;
    }
  }

  private array(): unknown[] {
    this.pos++;
    const out: unknown[] = [];
    this.ws();
    if (this.take("]")) return out;
    for (;;) {
      out.push(this.value());
      this.ws();
      if (this.take("]")) return out;
      if (!this.take(",")) throw new Error("expected comma");
      this.ws();
      if (this.take("]")) return out;
    }
  }

  private identifier(): string {
    const match = this.source.slice(this.pos).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!match) throw new Error("expected object key");
    this.pos += match[0].length;
    return match[0];
  }

  private string(): string {
    const quote = this.source[this.pos];
    if (quote !== '"' && quote !== "'") throw new Error("expected string");
    this.pos++;
    let out = "";
    while (this.pos < this.source.length) {
      const char = this.source[this.pos++];
      if (char === quote) return out;
      if (char !== "\\") {
        out += char;
        continue;
      }
      const escaped = this.source[this.pos++];
      if (escaped === undefined) throw new Error("unfinished escape");
      const simple: Record<string, string> = {
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        "\\": "\\",
        '"': '"',
        "'": "'",
        "/": "/",
      };
      if (escaped === "u") {
        const hex = this.source.slice(this.pos, this.pos + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("invalid unicode escape");
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.pos += 4;
      } else if (simple[escaped] !== undefined) {
        out += simple[escaped];
      } else {
        throw new Error("invalid escape");
      }
    }
    throw new Error("unclosed string");
  }

  private ws(): void {
    while (/\s/.test(this.source[this.pos] ?? "")) this.pos++;
  }

  private take(value: string): boolean {
    if (!this.source.startsWith(value, this.pos)) return false;
    this.pos += value.length;
    return true;
  }
}

class Parser {
  private pos = 0;

  constructor(private readonly source: string) {}

  parse(): Element {
    this.skipWhitespace();
    if (this.pos >= this.source.length) throw new ParseFailure("JSX is empty", this.pos);
    const root = this.element();
    this.skipWhitespace();
    if (this.pos !== this.source.length) {
      throw new ParseFailure("Expected a single root element", this.pos);
    }
    return root;
  }

  private element(): Element {
    const offset = this.pos;
    this.expect("<");
    if (this.peek("/")) throw new ParseFailure("Unexpected closing tag", this.pos);
    const fragment = this.peek(">");
    const tag = fragment ? null : this.name("tag name", true);
    const attributes: Attribute[] = [];

    if (fragment) {
      this.pos += 1;
    } else {
      while (true) {
        this.skipWhitespace();
        if (this.peek("/>")) {
          this.pos += 2;
          return { tag, attributes, children: [], offset };
        }
        if (this.peek(">")) {
          this.pos += 1;
          break;
        }
        if (this.peek("{")) {
          throw new ParseFailure(
            "Spread attributes and JSX expressions are not supported",
            this.pos,
          );
        }
        const attrOffset = this.pos;
        const name = this.name("attribute name");
        this.skipWhitespace();
        let value: unknown = true;
        if (this.peek("=")) {
          this.pos += 1;
          this.skipWhitespace();
          value = this.attributeValue();
        }
        attributes.push({ name, value, offset: attrOffset });
      }
    }

    const children: Array<Element | TextNode> = [];
    while (true) {
      if (this.pos >= this.source.length) {
        throw new ParseFailure(`Unclosed ${tag ? `<${tag}>` : "fragment"}`, offset);
      }
      if (this.peek("</")) {
        this.pos += 2;
        if (tag === null) {
          this.expect(">");
        } else {
          const close = this.name("closing tag", true);
          if (close !== tag) {
            throw new ParseFailure(
              `Expected </${tag}> but found </${close}>`,
              this.pos - close.length,
            );
          }
          this.skipWhitespace();
          this.expect(">");
        }
        return { tag, attributes, children, offset };
      }
      if (this.peek("<")) {
        children.push(this.element());
        continue;
      }
      const textOffset = this.pos;
      const next = this.source.indexOf("<", this.pos);
      const end = next === -1 ? this.source.length : next;
      const text = this.source.slice(this.pos, end);
      const expression = text.indexOf("{");
      if (expression !== -1) {
        throw new ParseFailure(
          "JSX child expressions are not supported; use literal text or a JSON-valued prop",
          textOffset + expression,
        );
      }
      this.pos = end;
      children.push({ text, offset: textOffset });
    }
  }

  private attributeValue(): unknown {
    const quote = this.source[this.pos];
    if (quote === '"' || quote === "'") {
      const start = this.pos;
      this.pos += 1;
      let out = "";
      while (this.pos < this.source.length) {
        const char = this.source[this.pos];
        if (char === quote) {
          this.pos += 1;
          return out;
        }
        if (char === "\\") {
          const next = this.source[this.pos + 1];
          if (next === undefined) break;
          out += next === "n" ? "\n" : next === "t" ? "\t" : next;
          this.pos += 2;
        } else {
          out += char;
          this.pos += 1;
        }
      }
      throw new ParseFailure("Unclosed quoted attribute", start);
    }
    if (!this.peek("{")) {
      throw new ParseFailure(
        "Attribute values must be quoted strings or JSON literals in braces",
        this.pos,
      );
    }
    const start = this.pos;
    this.pos += 1;
    this.skipWhitespace();
    if (this.peek("<")) {
      const element = this.element();
      this.skipWhitespace();
      this.expect("}");
      return new ElementValue(element);
    }
    this.pos = start + 1;
    const contentStart = this.pos;
    let depth = 1;
    let quoteChar: string | null = null;
    let escaped = false;
    while (this.pos < this.source.length) {
      const char = this.source[this.pos] as string;
      if (quoteChar !== null) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quoteChar) quoteChar = null;
      } else if (char === '"' || char === "'") {
        quoteChar = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const raw = this.source.slice(contentStart, this.pos).trim();
          this.pos += 1;
          if (!raw) throw new ParseFailure("Empty JSX expression", start);
          try {
            return new DataLiteralParser(raw).parse();
          } catch {
            throw new ParseFailure(
              'Brace values must be JSON literals (bare object keys, single quotes, and trailing commas are also allowed) or a single element (`icon={<Icon name="bolt" />}`); identifiers as values, calls, template strings, spreads, and functions are not executed',
              contentStart,
            );
          }
        }
      }
      this.pos += 1;
    }
    throw new ParseFailure("Unclosed brace attribute", start);
  }

  private name(label: string, dotted = false): string {
    const start = this.pos;
    const first = this.source[this.pos];
    if (!first || !/[A-Za-z_$]/.test(first)) {
      throw new ParseFailure(`Expected ${label}`, this.pos);
    }
    this.pos += 1;
    while (this.pos < this.source.length && /[A-Za-z0-9_$-]/.test(this.source[this.pos] ?? "")) {
      this.pos += 1;
    }
    // Compound parts (`Tabs.List`, `Mantine.Button`) are tags too; an attribute
    // name never contains a dot, so this can't swallow one.
    while (
      dotted &&
      this.source[this.pos] === "." &&
      /[A-Za-z_$]/.test(this.source[this.pos + 1] ?? "")
    ) {
      this.pos += 2;
      while (this.pos < this.source.length && /[A-Za-z0-9_$]/.test(this.source[this.pos] ?? "")) {
        this.pos += 1;
      }
    }
    return this.source.slice(start, this.pos);
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.pos] ?? "")) this.pos += 1;
  }

  private peek(value: string): boolean {
    return this.source.startsWith(value, this.pos);
  }

  private expect(value: string): void {
    if (!this.peek(value)) throw new ParseFailure(`Expected ${value}`, this.pos);
    this.pos += value.length;
  }
}

function issueAt(source: string, offset: number, message: string): JsxIssue {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    message,
    offset,
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

/**
 * Lift bare text sitting beside elements into `<Text>`, in place.
 *
 * `<Button><Icon />Rewards</Button>` is the most natural way to write an icon
 * button in every library velloo targets, and it used to be a hard reject: the
 * design tree has one slot for a component's text, so text and elements could
 * not both occupy it. Wrapping is the fix the error message asked the caller to
 * make by hand, and there is only one way to make it — so make it here.
 *
 * Only for the genuinely mixed case. Text alone still becomes `props.children`,
 * which is the cheaper node and what a plain `<Button>Save</Button>` should
 * stay. Returns the children untouched when the provider has no `Text` to wrap
 * with, so the original error stands rather than a confusing unknown-component
 * one taking its place.
 */
function wrapMixedText(
  children: Array<Element | TextNode>,
  ctx: CompileContext,
): Array<Element | TextNode> {
  const hasElement = children.some((child) => "tag" in child);
  const hasText = children.some((child) => !("tag" in child) && child.text.trim().length > 0);
  if (!hasElement || !hasText || !ctx.components.has("Text")) return children;
  return children.flatMap((child) => {
    if ("tag" in child) return [child];
    // Whitespace between elements is JSX formatting, not content.
    if (child.text.trim().length === 0) return [];
    return [
      { tag: "Text", attributes: [], children: [child], offset: child.offset } satisfies Element,
    ];
  });
}

function textValue(children: Array<Element | TextNode>): { text?: string; elements: Element[] } {
  const elements = children.filter((child): child is Element => "tag" in child);
  const text = children
    .filter((child): child is TextNode => "text" in child)
    .map((child) => child.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return { ...(text ? { text } : {}), elements };
}

export function snippetJsxTags(snippet: Snippet): string[] {
  const pascal = (value: string): string =>
    value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join("");
  return [...new Set([snippet.id, snippet.name].map(pascal).filter(Boolean))];
}

interface CompileContext {
  source: string;
  components: Set<string>;
  catalog: Set<string>;
  snippets: Map<string, Snippet[]>;
  /** Repository components by catalog id — the app's own and its packages'. */
  repo: Map<string, { name: string; identity: RepoComponentRef }>;
}

function compileElement(element: Element, ctx: CompileContext): CompileJsxResult {
  if (element.tag === null) {
    const meaningful = element.children.filter(
      (child) => "tag" in child || child.text.trim().length > 0,
    );
    if (meaningful.length !== 1 || !("tag" in (meaningful[0] ?? {}))) {
      return {
        ok: false,
        issues: [
          issueAt(ctx.source, element.offset, "A fragment must contain exactly one root element"),
        ],
      };
    }
    return compileElement(meaningful[0] as Element, ctx);
  }

  const attrs = new Map<string, Attribute>();
  for (const attr of element.attributes) {
    if (attrs.has(attr.name)) {
      return {
        ok: false,
        issues: [issueAt(ctx.source, attr.offset, `Duplicate attribute "${attr.name}"`)],
      };
    }
    if (
      /^on[A-Z]/.test(attr.name) ||
      ["dangerouslySetInnerHTML", "ref", "key"].includes(attr.name)
    ) {
      return {
        ok: false,
        issues: [
          issueAt(
            ctx.source,
            attr.offset,
            `Executable React attribute "${attr.name}" is not allowed in static design JSX`,
          ),
        ],
      };
    }
    attrs.set(attr.name, attr);
  }
  const stableId = attrs.get("vellooId")?.value;
  if (stableId !== undefined && typeof stableId !== "string") {
    return {
      ok: false,
      issues: [
        issueAt(
          ctx.source,
          attrs.get("vellooId")?.offset ?? element.offset,
          "vellooId must be a string",
        ),
      ],
    };
  }
  attrs.delete("vellooId");

  const snippetMatches = ctx.snippets.get(element.tag) ?? [];
  const repoEntry = ctx.components.has(element.tag) ? undefined : ctx.repo.get(element.tag);
  const isComponent = ctx.components.has(element.tag) || repoEntry !== undefined;
  if (isComponent && snippetMatches.length > 0) {
    return {
      ok: false,
      issues: [
        issueAt(
          ctx.source,
          element.offset,
          `"${element.tag}" is ambiguous: both a component and a snippet use this tag`,
        ),
      ],
    };
  }

  const { text, elements } = textValue(wrapMixedText(element.children, ctx));
  if (text && elements.length > 0) {
    return {
      ok: false,
      issues: [
        issueAt(
          ctx.source,
          element.offset,
          "Mixed text and element children are not supported; wrap the text in a Text or Box element",
        ),
      ],
    };
  }

  // A slot prop's element compiles like a child: a component, snippet or text.
  // A node written as a JSON literal instead is held to the same namespace, so
  // an unresolvable one fails here rather than taking the screen's render down.
  for (const attr of attrs.values()) {
    if (attr.value instanceof ElementValue) {
      const compiled = compileElement(attr.value.element, ctx);
      if (!compiled.ok) return compiled;
      attr.value = compiled.node;
      continue;
    }
    const resolved = resolveLiteralNodes(attr.value, ctx);
    if (typeof resolved === "string") {
      return { ok: false, issues: [issueAt(ctx.source, attr.offset, resolved)] };
    }
    attr.value = resolved.value;
  }

  if (isComponent) {
    const props = Object.fromEntries([...attrs].map(([name, attr]) => [name, attr.value]));
    if (text) {
      if ("children" in props) {
        return {
          ok: false,
          issues: [
            issueAt(ctx.source, element.offset, "Specify children as text or a prop, not both"),
          ],
        };
      }
      props.children = text;
    }
    const children: Node[] = [];
    for (const child of elements) {
      const compiled = compileElement(child, ctx);
      if (!compiled.ok) return compiled;
      children.push(compiled.node);
    }
    const node: ComponentNode = {
      $ref: repoEntry?.name ?? element.tag,
      ...(repoEntry ? { $repo: repoEntry.identity } : {}),
      ...(stableId ? { $id: stableId } : {}),
      ...(Object.keys(props).length > 0 ? { props } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
    return { ok: true, node };
  }

  if (snippetMatches.length === 1) {
    const snippet = snippetMatches[0] as Snippet;
    const params = new Map(snippet.params.map((param) => [param.name, param]));
    const args: Record<string, unknown> = {};
    let extraClassName: string | undefined;
    for (const [name, attr] of attrs) {
      if (name === "className" && !params.has(name)) {
        if (typeof attr.value !== "string") {
          return {
            ok: false,
            issues: [issueAt(ctx.source, attr.offset, "A snippet className must be a string")],
          };
        }
        extraClassName = attr.value;
      } else if (!params.has(name)) {
        return {
          ok: false,
          issues: [
            issueAt(ctx.source, attr.offset, `Unknown prop "${name}" for snippet ${element.tag}`),
          ],
        };
      } else {
        args[name] = attr.value;
      }
    }
    if (text || elements.length > 0) {
      const childParam = params.get("children");
      if (!childParam) {
        return {
          ok: false,
          issues: [
            issueAt(
              ctx.source,
              element.offset,
              `Snippet ${element.tag} declares no children param`,
            ),
          ],
        };
      }
      if (text) args.children = text;
      else {
        if (childParam.type !== "node" || elements.length !== 1) {
          return {
            ok: false,
            issues: [
              issueAt(
                ctx.source,
                element.offset,
                `Snippet ${element.tag} needs one node child for its children param`,
              ),
            ],
          };
        }
        const compiled = compileElement(elements[0] as Element, ctx);
        if (!compiled.ok) return compiled;
        args.children = compiled.node;
      }
    }
    const missing = snippet.params
      .filter((param) => !param.optional && param.default === undefined && !(param.name in args))
      .map((param) => param.name);
    if (missing.length > 0) {
      return {
        ok: false,
        issues: [
          issueAt(
            ctx.source,
            element.offset,
            `Snippet ${element.tag} is missing required props: ${missing.join(", ")}`,
          ),
        ],
      };
    }
    const node: SnippetInstance = {
      $snippet: snippet.id,
      ...(stableId ? { $id: stableId } : {}),
      ...(extraClassName ? { $extraClassName: extraClassName } : {}),
      ...(Object.keys(args).length > 0 ? { args } : {}),
    };
    return { ok: true, node };
  }

  const allNames = [...ctx.components, ...ctx.snippets.keys(), ...ctx.repo.keys()];
  const suggestions = nearestRefs(element.tag, allNames);
  const catalogOnly = ctx.catalog.has(element.tag);
  return {
    ok: false,
    issues: [
      issueAt(
        ctx.source,
        element.offset,
        catalogOnly
          ? `Component "${element.tag}" is known to the library but unavailable in its design renderer; refresh the provider snapshot`
          : `Unknown component or snippet "${element.tag}"${suggestions.length ? `; did you mean ${suggestions.join(", ")}?` : ""}`,
      ),
    ],
  };
}

/**
 * A prop value that is a literal node (`{"$ref": "IconSearch"}`), or an array
 * of them: attach the repo identity its name resolves to, or say why it can't
 * render. Anything else passes through untouched.
 */
function resolveLiteralNodes(value: unknown, ctx: CompileContext): { value: unknown } | string {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const resolved = resolveLiteralNodes(item, ctx);
      if (typeof resolved === "string") return resolved;
      out.push(resolved.value);
    }
    return { value: out };
  }
  if (!value || typeof value !== "object") return { value };
  const node = value as Record<string, unknown>;
  const ref = node.$ref;
  if (typeof ref !== "string" || node.$repo !== undefined || ctx.components.has(ref)) {
    return { value };
  }
  const entry = ctx.repo.get(ref);
  if (entry) return { value: { ...node, $ref: entry.name, $repo: entry.identity } };
  const suggestions = nearestRefs(ref, [...ctx.components, ...ctx.repo.keys()]);
  return `Unknown component "${ref}" in a prop value${suggestions.length ? `; did you mean ${suggestions.join(", ")}?` : ""} — or pass it as an element: prop={<${suggestions[0] ?? ref} />}`;
}

/** Parse and compile non-executing JSX against one screen's live namespace. */
export async function compileRestrictedJsx(
  ctx: MutationContext,
  screen: Screen,
  source: string,
): Promise<CompileJsxResult> {
  let root: Element;
  try {
    root = new Parser(source).parse();
  } catch (error) {
    if (error instanceof ParseFailure) {
      return { ok: false, issues: [issueAt(source, error.offset, error.message)] };
    }
    throw error;
  }

  const registry = registryForScreen(ctx, screen);
  const provider = providerForScreen(ctx, screen) as ComponentProvider;
  const manifest = await provider.loadManifest().catch(() => []);
  const snippets = new Map<string, Snippet[]>();
  for (const snippet of ctx.folder.snippets.values()) {
    for (const tag of snippetJsxTags(snippet)) {
      const values = snippets.get(tag) ?? [];
      values.push(snippet);
      snippets.set(tag, values);
    }
  }
  const repoCatalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
  return compileElement(root, {
    source,
    components: new Set(Object.keys(registry)),
    catalog: new Set(manifest.map((descriptor) => descriptor.id)),
    snippets,
    repo: new Map(
      (repoCatalog?.entries ?? []).map((entry) => [
        entry.id,
        {
          name: entry.name,
          identity: entry.proxy ? { ...entry.identity, proxy: entry.proxy } : entry.identity,
        },
      ]),
    ),
  });
}
