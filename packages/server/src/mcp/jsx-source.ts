/**
 * Reads the JSX an agent sends to `compose` — which is the JSX it would have
 * written for the app: data declared above the markup, lists drawn with
 * `.map`, a card pulled out into a function, `cond && <Badge />`, class names
 * joined with `cn(...)`.
 *
 * None of it is executed. The source is parsed into a small expression tree and
 * *evaluated as data*: literals, the arrays and objects built from them, the
 * pure array/string/number methods a render uses, and the components and
 * arrow functions the source itself defines. Everything outside that — an
 * import's value, a fetch, a hook with real state — is named and refused, so a
 * design never silently loses a branch or a list. What comes out is the same
 * element tree a hand-flattened JSX would have produced, plus notes on what was
 * expanded and what a static design had to drop (event handlers).
 */

export interface SourceAttribute {
  name: string;
  value: unknown;
  offset: number;
}

export interface SourceElement {
  tag: string | null;
  attributes: SourceAttribute[];
  children: Array<SourceElement | SourceText>;
  offset: number;
}

export interface SourceText {
  text: string;
  offset: number;
  /** A `{"…"}` literal or an evaluated value: its whitespace is content. */
  literal?: true;
}

/** `icon={<IconBolt />}` — an element passed as a prop, compiled to a node. */
export class ElementValue {
  constructor(readonly element: SourceElement) {}
}

export class SourceFailure extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

/**
 * Reads the app's own modules for a source that imports them: the data file a
 * page maps over (`import { reviews } from "@/lib/reviews"`), a formatting
 * helper beside it. Answers null for anything that is not a file of the app —
 * a package's code is never read.
 */
export interface ModuleLoader {
  /** `from` is the importing file, or null for JSX that was sent inline. */
  load(specifier: string, from: string | null): { file: string; source: string } | null;
}

export interface ReadOptions {
  /** Several roots may stand side by side, as an append takes them. */
  siblings?: boolean;
  /** The file the source was read from, when it was — what its relative imports are relative to. */
  file?: string;
  modules?: ModuleLoader;
  /**
   * The layouts the app renders this page inside, innermost first (a Next
   * `layout.tsx` and its ancestors). The page is composed as the route shows
   * it — inside them — since a page file alone is a page without its header.
   */
  layouts?: { file: string; label: string; source: string }[];
}

export interface ReadSource {
  root: SourceElement;
  /** What the reader did that the author should know about, one sentence each. */
  notes: string[];
}

// --- the expression tree -----------------------------------------------------

type Spread = { spread: Expr };

type Expr =
  | { k: "lit"; value: unknown }
  | { k: "template"; quasis: string[]; parts: Expr[] }
  | { k: "id"; name: string; at: number }
  | { k: "array"; items: Array<Expr | Spread> }
  | { k: "object"; entries: Array<{ key: string | Expr; value: Expr } | Spread> }
  | { k: "member"; object: Expr; property: string | Expr; optional: boolean; at: number }
  | { k: "call"; callee: Expr; args: Array<Expr | Spread>; optional: boolean; at: number }
  | { k: "new"; callee: Expr; args: Array<Expr | Spread>; at: number }
  | { k: "unary"; op: string; operand: Expr }
  | { k: "binary"; op: string; left: Expr; right: Expr; at: number }
  | { k: "logical"; op: "&&" | "||" | "??"; left: Expr; right: Expr }
  | { k: "conditional"; test: Expr; then: Expr; otherwise: Expr }
  | { k: "function"; fn: FunctionShape }
  | { k: "jsx"; element: JsxNode };

type Pattern =
  | { k: "name"; name: string; fallback?: Expr }
  | {
      k: "object";
      entries: Array<{ key: string; value: Pattern }>;
      rest?: string;
      fallback?: Expr;
    }
  | { k: "array"; items: Array<Pattern | null>; rest?: string; fallback?: Expr };

type Statement =
  | { k: "declare"; pattern: Pattern; init: Expr | null }
  | { k: "return"; value: Expr | null }
  | { k: "if"; test: Expr; then: Statement[]; otherwise: Statement[] }
  | { k: "expression"; expr: Expr };

/** A body that didn't parse is kept as its error: only calling it is a failure. */
type FunctionBody = { expr: Expr } | { statements: Statement[] } | { unreadable: SourceFailure };

interface FunctionShape {
  name?: string;
  params: Pattern[];
  rest?: string;
  body: FunctionBody;
  at: number;
}

type JsxAttribute = { name: string; value: Expr | true; at: number } | { spread: Expr; at: number };

type JsxChild = JsxNode | { text: string; at: number } | { expr: Expr; at: number };

interface JsxNode {
  tag: string | null;
  attributes: JsxAttribute[];
  children: JsxChild[];
  at: number;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const BINARY: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "===": 4,
  "!==": 4,
  "==": 4,
  "!=": 4,
  "<=": 5,
  ">=": 5,
  "<": 5,
  ">": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};
const OPERATORS = Object.keys(BINARY).sort((a, b) => b.length - a.length);

type Imports = Map<string, { from: string; exported: string }>;

// --- parsing -----------------------------------------------------------------

class SourceParser {
  pos = 0;
  /** Names an `import` brought in: where from, and under which name it is exported there. */
  readonly imports: Imports = new Map();

  constructor(readonly source: string) {}

  // -- characters --

  peek(value: string): boolean {
    return this.source.startsWith(value, this.pos);
  }

  private take(value: string): boolean {
    if (!this.peek(value)) return false;
    this.pos += value.length;
    return true;
  }

  private expect(value: string): void {
    if (!this.take(value)) throw new SourceFailure(`Expected ${value}`, this.pos);
  }

  /** Whitespace and comments — not for JSX text, where both are content. */
  skip(): void {
    for (;;) {
      while (/\s/.test(this.source[this.pos] ?? "")) this.pos += 1;
      if (this.peek("//")) {
        const end = this.source.indexOf("\n", this.pos);
        this.pos = end === -1 ? this.source.length : end;
      } else if (this.peek("/*")) {
        const end = this.source.indexOf("*/", this.pos + 2);
        if (end === -1) throw new SourceFailure("Unclosed comment", this.pos);
        this.pos = end + 2;
      } else return;
    }
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.pos] ?? "")) this.pos += 1;
  }

  private word(): string | null {
    return IDENTIFIER.exec(this.source.slice(this.pos, this.pos + 80))?.[0] ?? null;
  }

  private keyword(name: string): boolean {
    return this.peek(name) && !/[A-Za-z0-9_$]/.test(this.source[this.pos + name.length] ?? "");
  }

  private takeKeyword(name: string): boolean {
    if (!this.keyword(name)) return false;
    this.pos += name.length;
    return true;
  }

  private identifier(label: string): string {
    const name = this.word();
    if (!name) throw new SourceFailure(`Expected ${label}`, this.pos);
    this.pos += name.length;
    return name;
  }

  /**
   * The index of the bracket closing the one at `open`, skipping strings and
   * comments. Used only to look ahead (is this `(` an arrow's parameters?) and
   * to step over what is never evaluated (a type, an unreadable handler body).
   */
  private closing(open: number): number {
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const stack: string[] = [];
    for (let i = open; i < this.source.length; i += 1) {
      const char = this.source[i] as string;
      if (char === '"' || char === "'" || char === "`") {
        i += 1;
        while (i < this.source.length && this.source[i] !== char) {
          if (this.source[i] === "\\") i += 1;
          i += 1;
        }
      } else if (char === "/" && this.source[i + 1] === "/") {
        const end = this.source.indexOf("\n", i);
        i = end === -1 ? this.source.length : end;
      } else if (char === "/" && this.source[i + 1] === "*") {
        const end = this.source.indexOf("*/", i + 2);
        i = end === -1 ? this.source.length : end + 1;
      } else if (pairs[char]) {
        stack.push(pairs[char] as string);
      } else if (char === stack.at(-1)) {
        stack.pop();
        if (stack.length === 0) return i;
      }
    }
    return -1;
  }

  /** Step over a TypeScript type: up to the first `stop` character outside brackets. */
  private skipType(stop: string): void {
    let depth = 0;
    while (this.pos < this.source.length) {
      const char = this.source[this.pos] as string;
      if (depth === 0 && stop.includes(char)) {
        // `=>` inside a function type is not the `=` that ends an annotation.
        if (char !== "=" || this.source[this.pos + 1] !== ">") return;
        this.pos += 2;
        continue;
      }
      if (char === '"' || char === "'") {
        const end = this.source.indexOf(char, this.pos + 1);
        this.pos = end === -1 ? this.source.length : end + 1;
        continue;
      }
      if ("([{<".includes(char)) depth += 1;
      else if (")]}>".includes(char)) depth -= 1;
      if (depth < 0) return;
      this.pos += 1;
    }
  }

  // -- a whole source --

  /**
   * Markup alone (`<Box>…</Box>`, or several roots for an append), or a module:
   * declarations, then the component or markup they lead up to.
   */
  program(
    siblings: boolean,
    /** An imported module: declarations to evaluate, with no markup to find. */
    module = false,
  ): { statements: Statement[]; roots: Expr[]; entry?: string } {
    this.skip();
    if (this.pos >= this.source.length) {
      if (module) return { statements: [], roots: [] };
      throw new SourceFailure("JSX is empty", this.pos);
    }
    const statements: Statement[] = [];
    const roots: Expr[] = [];
    let entry: string | undefined;
    let last: string | undefined;
    if (this.peek("<")) {
      const first = this.jsxElement();
      roots.push({ k: "jsx", element: first });
      this.skip();
      this.take(";");
      this.skip();
      while (this.pos < this.source.length) {
        if (!siblings || first.tag === null || !this.peek("<")) {
          throw new SourceFailure("Expected a single root element", this.pos);
        }
        roots.push({ k: "jsx", element: this.jsxElement() });
        this.skip();
      }
      return { statements, roots };
    }
    while (this.pos < this.source.length) {
      if (this.peek("<")) {
        roots.push({ k: "jsx", element: this.jsxElement() });
      } else if (this.peek('"') || this.peek("'")) {
        this.stringLiteral(); // a directive: "use client"
      } else if (this.takeKeyword("import")) {
        this.importStatement();
      } else if (this.keyword("interface") || this.keyword("type") || this.keyword("declare")) {
        this.typeDeclaration();
      } else {
        let exported = false;
        let isDefault = false;
        if (this.takeKeyword("export")) {
          exported = true;
          this.skip();
          isDefault = this.takeKeyword("default");
          this.skip();
          if (!isDefault && (this.keyword("interface") || this.keyword("type"))) {
            this.typeDeclaration();
            this.skip();
            this.take(";");
            this.skip();
            continue;
          }
          if (!isDefault && this.peek("{")) {
            // `export { Page }` — a re-export list names nothing new.
            this.pos = this.closing(this.pos) + 1;
            this.skip();
            this.take(";");
            this.skip();
            continue;
          }
        }
        if (isDefault && !this.keyword("function")) {
          const at = this.pos;
          const expr = this.expression();
          if (expr.k === "id") entry = expr.name;
          else if (expr.k === "jsx") roots.push(expr);
          else {
            statements.push({ k: "declare", pattern: { k: "name", name: "default" }, init: expr });
            entry = "default";
            void at;
          }
        } else {
          const before = statements.length;
          statements.push(...this.statement());
          const declared = statements[before];
          if (declared?.k === "declare" && declared.pattern.k === "name") {
            const name = declared.pattern.name;
            const component = /^[A-Z]/.test(name) && declared.init?.k === "function";
            if (isDefault) entry = name;
            else if (component) last = name;
            void exported;
          }
        }
      }
      this.skip();
      this.take(";");
      this.skip();
    }
    if (module) return { statements, roots: [], ...(entry !== undefined ? { entry } : {}) };
    if (roots.length > 1 && !siblings) {
      throw new SourceFailure("Expected a single root element", this.pos);
    }
    const chosen = entry ?? (roots.length === 0 ? last : undefined);
    if (roots.length === 0 && chosen === undefined) {
      throw new SourceFailure(
        "This source declares values but no markup: end it with the JSX to compose, or a component that returns it.",
        0,
      );
    }
    return {
      statements,
      roots,
      ...(chosen !== undefined && roots.length === 0 ? { entry: chosen } : {}),
    };
  }

  private importStatement(): void {
    this.skip();
    const start = this.pos;
    if (!this.peek('"') && !this.peek("'")) {
      const from = /\bfrom\s*(["'])/.exec(this.source.slice(this.pos));
      if (!from) throw new SourceFailure("Unfinished import", start);
      const clause = this.source.slice(this.pos, this.pos + from.index).replace(/^type\s+/, "");
      this.pos += from.index + from[0].length - 1;
      const specifier = this.stringLiteral();
      const named = /\{([^}]*)\}/.exec(clause);
      for (const part of (named?.[1] ?? "").split(",")) {
        const [exported, local = exported] = part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/);
        if (exported && local && IDENTIFIER.test(local)) {
          this.imports.set(local.trim(), { from: specifier, exported: exported.trim() });
        }
      }
      // What is left outside the braces: a default import and/or `* as name`.
      for (const part of clause.replace(/\{[^}]*\}/, "").split(",")) {
        const namespace = /^\*\s*as\s+([A-Za-z_$][\w$]*)$/.exec(part.trim());
        const name = namespace?.[1] ?? part.trim();
        if (name && IDENTIFIER.test(name)) {
          this.imports.set(name, { from: specifier, exported: namespace ? "*" : "default" });
        }
      }
    } else {
      this.stringLiteral();
    }
  }

  private typeDeclaration(): void {
    if (this.takeKeyword("declare")) this.skip();
    const isInterface = this.takeKeyword("interface");
    if (!isInterface) this.expect("type");
    while (this.pos < this.source.length && !"{=".includes(this.source[this.pos] as string)) {
      this.pos += 1;
    }
    if (isInterface) {
      const end = this.closing(this.pos);
      if (end === -1) throw new SourceFailure("Unclosed interface", this.pos);
      this.pos = end + 1;
      return;
    }
    this.pos += 1;
    // A type alias runs to its `;`, or to the line that starts the next statement.
    for (;;) {
      this.skipType(";\n");
      if (this.source[this.pos] !== "\n") return;
      const rest = this.source.slice(this.pos).trimStart();
      if (!/^[|&]/.test(rest)) return;
      this.pos += 1;
    }
  }

  // -- statements --

  private block(): Statement[] {
    this.expect("{");
    const out: Statement[] = [];
    for (;;) {
      this.skip();
      if (this.take("}")) return out;
      if (this.pos >= this.source.length) throw new SourceFailure("Unclosed block", this.pos);
      out.push(...this.statement());
      this.skip();
      this.take(";");
    }
  }

  private statement(): Statement[] {
    this.skip();
    if (this.takeKeyword("const") || this.takeKeyword("let") || this.takeKeyword("var")) {
      const out: Statement[] = [];
      do {
        this.skip();
        const pattern = this.pattern();
        this.skip();
        if (this.take(":")) this.skipType("=;,\n");
        this.skip();
        const init = this.take("=") ? this.expression() : null;
        // `const Stat = (props) => …` is named by what it is assigned to.
        if (init?.k === "function" && !init.fn.name && pattern.k === "name") {
          init.fn.name = pattern.name;
        }
        out.push({ k: "declare", pattern, init });
        this.skip();
      } while (this.take(","));
      return out;
    }
    if (
      this.keyword("function") ||
      /^async\s+function\b/.test(this.source.slice(this.pos, this.pos + 20))
    ) {
      const at = this.pos;
      // The declaration alone: what follows it is the next statement, not an operand.
      const expr = this.primary();
      if (expr.k !== "function" || !expr.fn.name) {
        throw new SourceFailure("Expected a function declaration", at);
      }
      return [{ k: "declare", pattern: { k: "name", name: expr.fn.name }, init: expr }];
    }
    if (this.takeKeyword("return")) {
      this.skipWhitespace();
      if (this.peek(";") || this.peek("}")) return [{ k: "return", value: null }];
      return [{ k: "return", value: this.expression() }];
    }
    if (this.takeKeyword("if")) {
      this.skip();
      this.expect("(");
      const test = this.expression();
      this.skip();
      this.expect(")");
      const branch = (): Statement[] => {
        this.skip();
        return this.peek("{") ? this.block() : this.statement();
      };
      const then = branch();
      this.skip();
      this.take(";");
      this.skip();
      const otherwise = this.takeKeyword("else") ? branch() : [];
      return [{ k: "if", test, then, otherwise }];
    }
    for (const unsupported of ["for", "while", "switch", "try", "throw", "class", "do"]) {
      if (this.keyword(unsupported)) {
        throw new SourceFailure(
          `A \`${unsupported}\` statement can't be evaluated as design data. Build the list with \`.map\`/\`.filter\`, or write the elements out.`,
          this.pos,
        );
      }
    }
    return [{ k: "expression", expr: this.expression() }];
  }

  private pattern(): Pattern {
    this.skip();
    let pattern: Pattern;
    if (this.take("{")) {
      const entries: Array<{ key: string; value: Pattern }> = [];
      let rest: string | undefined;
      for (;;) {
        this.skip();
        if (this.take("}")) break;
        if (this.take("...")) {
          rest = this.identifier("a name after ...");
        } else {
          const key =
            this.peek('"') || this.peek("'") ? this.stringLiteral() : this.identifier("a name");
          this.skip();
          const value: Pattern = this.take(":") ? this.pattern() : { k: "name", name: key };
          this.skip();
          if (this.take("=")) value.fallback = this.expression();
          entries.push({ key, value });
        }
        this.skip();
        if (!this.take(",")) {
          this.skip();
          this.expect("}");
          break;
        }
      }
      pattern = { k: "object", entries, ...(rest ? { rest } : {}) };
    } else if (this.take("[")) {
      const items: Array<Pattern | null> = [];
      let rest: string | undefined;
      for (;;) {
        this.skip();
        if (this.take("]")) break;
        if (this.peek(",")) items.push(null);
        else if (this.take("...")) rest = this.identifier("a name after ...");
        else {
          const item = this.pattern();
          this.skip();
          if (this.take("=")) item.fallback = this.expression();
          items.push(item);
        }
        this.skip();
        if (!this.take(",")) {
          this.skip();
          this.expect("]");
          break;
        }
      }
      pattern = { k: "array", items, ...(rest ? { rest } : {}) };
    } else {
      pattern = { k: "name", name: this.identifier("a name") };
    }
    return pattern;
  }

  private parameters(): { params: Pattern[]; rest?: string } {
    this.expect("(");
    const params: Pattern[] = [];
    let rest: string | undefined;
    for (;;) {
      this.skip();
      if (this.take(")")) break;
      if (this.take("...")) rest = this.identifier("a name after ...");
      else {
        const param = this.pattern();
        this.skip();
        this.take("?");
        if (this.take(":")) this.skipType(",)=");
        this.skip();
        if (this.take("=")) param.fallback = this.expression();
        params.push(param);
      }
      this.skip();
      if (this.take(":")) this.skipType(",)");
      if (!this.take(",")) {
        this.skip();
        this.expect(")");
        break;
      }
    }
    return { params, ...(rest ? { rest } : {}) };
  }

  /**
   * A `{ … }` function body. Component bodies parse; an event handler's may not
   * (`await`, a loop, a mutation) and never needs to — it is kept as the error
   * it raised, which only matters if something calls it.
   */
  private functionBody(): FunctionBody {
    const open = this.pos;
    try {
      return { statements: this.block() };
    } catch (error) {
      if (!(error instanceof SourceFailure)) throw error;
      const end = this.closing(open);
      if (end === -1) throw error;
      this.pos = end + 1;
      return { unreadable: error };
    }
  }

  // -- expressions --

  expression(): Expr {
    this.skip();
    const arrow = this.arrow();
    if (arrow) return arrow;
    const test = this.binary(0);
    this.skip();
    if (this.peek("?") && !this.peek("?.") && !this.peek("??")) {
      this.pos += 1;
      const then = this.expression();
      this.skip();
      this.expect(":");
      const otherwise = this.expression();
      return { k: "conditional", test, then, otherwise };
    }
    if (this.peek("=") && !this.peek("==") && !this.peek("=>")) {
      throw new SourceFailure(
        "An assignment can't be evaluated as design data; declare the value with `const` instead.",
        this.pos,
      );
    }
    return test;
  }

  private arrow(): Expr | null {
    const at = this.pos;
    let isAsync = false;
    if (this.keyword("async")) {
      const after = this.source.slice(this.pos + 5).trimStart();
      if (/^(\(|function\b|[A-Za-z_$][\w$]*\s*=>)/.test(after)) {
        isAsync = true;
        this.pos += 5;
        this.skip();
      }
    }
    let shape: { params: Pattern[]; rest?: string } | null = null;
    if (this.peek("(")) {
      const close = this.closing(this.pos);
      if (close !== -1 && /^\s*(?::[^=;{]*?)?=>/.test(this.source.slice(close + 1))) {
        shape = this.parameters();
        this.skip();
        if (this.take(":")) this.skipType("=");
      }
    } else {
      const name = this.word();
      if (name && /^\s*=>/.test(this.source.slice(this.pos + name.length))) {
        this.pos += name.length;
        shape = { params: [{ k: "name", name }] };
      }
    }
    if (!shape) {
      if (isAsync) this.pos = at;
      return null;
    }
    this.skip();
    this.expect("=>");
    this.skip();
    const body: FunctionBody = this.peek("{") ? this.functionBody() : { expr: this.expression() };
    return {
      k: "function",
      fn: { ...shape, body: isAsync ? asyncBody(at) : body, at },
    };
  }

  private binary(min: number): Expr {
    let left = this.unary();
    for (;;) {
      const before = this.pos;
      this.skip();
      const at = this.pos;
      const op = OPERATORS.find((candidate) => this.peek(candidate));
      if (!op || this.peek("=>")) return left;
      // No semicolon, then markup on its own line: `const rows = […]⏎<Table>` is
      // a declaration followed by the JSX, not a comparison with `Table`.
      if (
        op === "<" &&
        /^<[A-Za-z>]/.test(this.source.slice(at, at + 2)) &&
        this.source.slice(before, at).includes("\n")
      ) {
        this.pos = before;
        return left;
      }
      const precedence = BINARY[op] as number;
      if (precedence < min) return left;
      this.pos += op.length;
      const right = this.binary(precedence + 1);
      left =
        op === "&&" || op === "||" || op === "??"
          ? { k: "logical", op, left, right }
          : { k: "binary", op, left, right, at };
    }
  }

  private unary(): Expr {
    this.skip();
    if (this.peek("!") && !this.peek("!=")) {
      this.pos += 1;
      return { k: "unary", op: "!", operand: this.unary() };
    }
    if ((this.peek("-") || this.peek("+")) && !this.peek("--") && !this.peek("++")) {
      const op = this.source[this.pos] as string;
      this.pos += 1;
      return { k: "unary", op, operand: this.unary() };
    }
    if (this.takeKeyword("typeof")) return { k: "unary", op: "typeof", operand: this.unary() };
    if (this.keyword("await")) {
      throw new SourceFailure(
        "`await` can't be evaluated: a design holds the data itself, not the call that fetches it. Write the values inline.",
        this.pos,
      );
    }
    return this.postfix(this.primary());
  }

  private args(): Array<Expr | Spread> {
    this.expect("(");
    const out: Array<Expr | Spread> = [];
    for (;;) {
      this.skip();
      if (this.take(")")) return out;
      out.push(this.take("...") ? { spread: this.expression() } : this.expression());
      this.skip();
      if (!this.take(",")) {
        this.skip();
        this.expect(")");
        return out;
      }
    }
  }

  private postfix(start: Expr): Expr {
    let expr = start;
    for (;;) {
      // A call or member on the next line still belongs to this expression;
      // JSX text never reaches here, so skipping whitespace is safe.
      const before = this.pos;
      this.skip();
      const at = this.pos;
      if (this.peek("?.")) {
        this.pos += 2;
        if (this.peek("("))
          expr = { k: "call", callee: expr, args: this.args(), optional: true, at };
        else if (this.take("[")) {
          const property = this.expression();
          this.skip();
          this.expect("]");
          expr = { k: "member", object: expr, property, optional: true, at };
        } else {
          expr = {
            k: "member",
            object: expr,
            property: this.identifier("a property name"),
            optional: true,
            at,
          };
        }
      } else if (this.peek(".") && !this.peek("...")) {
        this.pos += 1;
        this.skip();
        expr = {
          k: "member",
          object: expr,
          property: this.identifier("a property name"),
          optional: false,
          at,
        };
      } else if (this.peek("[")) {
        this.pos += 1;
        const property = this.expression();
        this.skip();
        this.expect("]");
        expr = { k: "member", object: expr, property, optional: false, at };
      } else if (this.peek("(")) {
        expr = { k: "call", callee: expr, args: this.args(), optional: false, at };
      } else if (this.peek("<") && this.typeArguments()) {
        // `useState<string>("")` — the type arguments say nothing a design needs.
      } else if (this.keyword("as") || this.keyword("satisfies")) {
        this.pos += this.keyword("as") ? 2 : 9;
        this.skip();
        this.skipType(",;)]}\n?:&|=");
      } else if (this.peek("!") && !this.peek("!=")) {
        this.pos += 1; // a non-null assertion
      } else {
        this.pos = before;
        return expr;
      }
    }
  }

  /** `<T, U>` directly before a call's `(`: step over it. */
  private typeArguments(): boolean {
    const match = /^<[A-Za-z0-9_$\s,.[\]|&<>{}:;?'"]*?>(?=\s*\()/.exec(
      this.source.slice(this.pos, this.pos + 200),
    );
    if (!match) return false;
    this.pos += match[0].length;
    return true;
  }

  private primary(): Expr {
    this.skip();
    const at = this.pos;
    const char = this.source[this.pos];
    if (char === undefined) throw new SourceFailure("Unexpected end of the expression", at);
    if (char === "(") {
      this.pos += 1;
      const inner = this.expression();
      this.skip();
      this.expect(")");
      return inner;
    }
    if (char === "<") return { k: "jsx", element: this.jsxElement() };
    if (char === '"' || char === "'") return { k: "lit", value: this.stringLiteral() };
    if (char === "`") return this.template();
    if (char === "[") {
      this.pos += 1;
      const items: Array<Expr | Spread> = [];
      for (;;) {
        this.skip();
        if (this.take("]")) break;
        items.push(this.take("...") ? { spread: this.expression() } : this.expression());
        this.skip();
        if (!this.take(",")) {
          this.skip();
          this.expect("]");
          break;
        }
      }
      return { k: "array", items };
    }
    if (char === "{") return this.objectLiteral();
    const number = /^(?:0[xX][0-9a-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/.exec(
      this.source.slice(this.pos, this.pos + 40),
    );
    if (number) {
      this.pos += number[0].length;
      return { k: "lit", value: Number(number[0].replace(/_/g, "")) };
    }
    if (char === "/") {
      throw new SourceFailure(
        "A regular expression can't be evaluated as design data; write the resulting text.",
        at,
      );
    }
    const name = this.word();
    if (!name) throw new SourceFailure(`Unexpected "${char}" in an expression`, at);
    this.pos += name.length;
    switch (name) {
      case "true":
        return { k: "lit", value: true };
      case "false":
        return { k: "lit", value: false };
      case "null":
        return { k: "lit", value: null };
      case "undefined":
        return { k: "lit", value: undefined };
      case "function": {
        this.skip();
        const fnName = this.peek("(") ? undefined : this.identifier("a function name");
        this.skip();
        if (this.peek("<")) this.pos = this.closingAngle(this.pos) + 1;
        const shape = this.parameters();
        this.skip();
        if (this.take(":")) this.skipType("{");
        this.skip();
        const body = this.functionBody();
        return { k: "function", fn: { ...(fnName ? { name: fnName } : {}), ...shape, body, at } };
      }
      case "async": {
        this.skip();
        if (!this.takeKeyword("function")) throw new SourceFailure("Unexpected `async`", at);
        this.skip();
        const fnName = this.peek("(") ? undefined : this.identifier("a function name");
        this.skip();
        const shape = this.parameters();
        this.skip();
        if (this.take(":")) this.skipType("{");
        this.skip();
        this.functionBody();
        return {
          k: "function",
          fn: { ...(fnName ? { name: fnName } : {}), ...shape, body: asyncBody(at), at },
        };
      }
      case "new": {
        this.skip();
        let callee: Expr = { k: "id", name: this.identifier("a constructor"), at: this.pos };
        while (this.take(".")) {
          callee = {
            k: "member",
            object: callee,
            property: this.identifier("a property name"),
            optional: false,
            at,
          };
        }
        this.skip();
        return { k: "new", callee, args: this.peek("(") ? this.args() : [], at };
      }
      default:
        return { k: "id", name, at };
    }
  }

  private closingAngle(open: number): number {
    let depth = 0;
    for (let i = open; i < this.source.length; i += 1) {
      if (this.source[i] === "<") depth += 1;
      else if (this.source[i] === ">" && this.source[i - 1] !== "=") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    throw new SourceFailure("Unclosed type parameters", open);
  }

  private objectLiteral(): Expr {
    this.expect("{");
    const entries: Array<{ key: string | Expr; value: Expr } | Spread> = [];
    for (;;) {
      this.skip();
      if (this.take("}")) break;
      if (this.take("...")) {
        entries.push({ spread: this.expression() });
      } else {
        const at = this.pos;
        let key: string | Expr;
        if (this.peek('"') || this.peek("'")) key = this.stringLiteral();
        else if (this.take("[")) {
          key = this.expression();
          this.skip();
          this.expect("]");
        } else {
          const number = /^\d+(\.\d+)?/.exec(this.source.slice(this.pos, this.pos + 30));
          if (number) {
            this.pos += number[0].length;
            key = number[0];
          } else {
            key = this.identifier("an object key");
          }
        }
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          throw new SourceFailure("unsafe object key", at);
        }
        this.skip();
        if (this.take(":")) entries.push({ key, value: this.expression() });
        else if (typeof key === "string" && (this.peek(",") || this.peek("}"))) {
          entries.push({ key, value: { k: "id", name: key, at } });
        } else if (this.peek("(")) {
          throw new SourceFailure("An object method can't be held as design data", at);
        } else {
          throw new SourceFailure("Expected : after an object key", this.pos);
        }
      }
      this.skip();
      if (!this.take(",")) {
        this.skip();
        this.expect("}");
        break;
      }
    }
    return { k: "object", entries };
  }

  private stringLiteral(): string {
    const quote = this.source[this.pos];
    const start = this.pos;
    this.pos += 1;
    let out = "";
    while (this.pos < this.source.length) {
      const char = this.source[this.pos] as string;
      this.pos += 1;
      if (char === quote) return out;
      if (char !== "\\") {
        out += char;
        continue;
      }
      out += this.escape();
    }
    throw new SourceFailure("Unclosed string", start);
  }

  private escape(): string {
    const escaped = this.source[this.pos];
    if (escaped === undefined) throw new SourceFailure("Unfinished escape", this.pos);
    this.pos += 1;
    const simple: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      "\n": "",
    };
    if (escaped === "u") {
      const braced = /^\{([0-9a-fA-F]{1,6})\}/.exec(this.source.slice(this.pos, this.pos + 9));
      const hex = braced?.[1] ?? this.source.slice(this.pos, this.pos + 4);
      if (!/^[0-9a-fA-F]+$/.test(hex)) throw new SourceFailure("invalid unicode escape", this.pos);
      this.pos += braced ? braced[0].length : 4;
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    return simple[escaped] ?? escaped;
  }

  private template(): Expr {
    const start = this.pos;
    this.pos += 1;
    const quasis: string[] = [""];
    const parts: Expr[] = [];
    while (this.pos < this.source.length) {
      const char = this.source[this.pos] as string;
      if (char === "`") {
        this.pos += 1;
        return parts.length === 0
          ? { k: "lit", value: quasis[0] }
          : { k: "template", quasis, parts };
      }
      if (char === "$" && this.source[this.pos + 1] === "{") {
        this.pos += 2;
        parts.push(this.expression());
        this.skip();
        this.expect("}");
        quasis.push("");
      } else if (char === "\\") {
        this.pos += 1;
        quasis[quasis.length - 1] += this.escape();
      } else {
        quasis[quasis.length - 1] += char;
        this.pos += 1;
      }
    }
    throw new SourceFailure("Unclosed template string", start);
  }

  // -- JSX --

  private jsxName(label: string, dotted = false): string {
    const start = this.pos;
    const first = this.source[this.pos];
    if (!first || !/[A-Za-z_$]/.test(first)) throw new SourceFailure(`Expected ${label}`, this.pos);
    this.pos += 1;
    while (/[A-Za-z0-9_$-]/.test(this.source[this.pos] ?? "")) this.pos += 1;
    // Compound parts (`Tabs.List`, `Mantine.Button`) are tags too; an attribute
    // name never contains a dot, so this can't swallow one.
    while (
      dotted &&
      this.source[this.pos] === "." &&
      /[A-Za-z_$]/.test(this.source[this.pos + 1] ?? "")
    ) {
      this.pos += 2;
      while (/[A-Za-z0-9_$]/.test(this.source[this.pos] ?? "")) this.pos += 1;
    }
    return this.source.slice(start, this.pos);
  }

  private quotedAttribute(): string {
    const quote = this.source[this.pos];
    const start = this.pos;
    this.pos += 1;
    let out = "";
    while (this.pos < this.source.length) {
      const char = this.source[this.pos] as string;
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
    throw new SourceFailure("Unclosed quoted attribute", start);
  }

  jsxElement(): JsxNode {
    const at = this.pos;
    this.expect("<");
    if (this.peek("/")) throw new SourceFailure("Unexpected closing tag", this.pos);
    const fragment = this.peek(">");
    const tag = fragment ? null : this.jsxName("tag name", true);
    const attributes: JsxAttribute[] = [];

    if (fragment) {
      this.pos += 1;
    } else {
      for (;;) {
        this.skip();
        // `<Quote size={20}/ >` — JSX lets whitespace sit between the two.
        const selfClosing = /^\/\s*>/.exec(this.source.slice(this.pos, this.pos + 16));
        if (selfClosing) {
          this.pos += selfClosing[0].length;
          return { tag, attributes, children: [], at };
        }
        if (this.take(">")) break;
        const attrAt = this.pos;
        if (this.take("{")) {
          this.skip();
          if (!this.take("...")) {
            throw new SourceFailure(
              "Expected an attribute name; a brace here can only be a spread (`{...props}`)",
              attrAt,
            );
          }
          const spread = this.expression();
          this.skip();
          this.expect("}");
          attributes.push({ spread, at: attrAt });
          continue;
        }
        const name = this.jsxName("attribute name");
        this.skipWhitespace();
        if (!this.take("=")) {
          attributes.push({ name, value: true, at: attrAt });
          continue;
        }
        this.skipWhitespace();
        if (this.peek('"') || this.peek("'")) {
          attributes.push({ name, value: { k: "lit", value: this.quotedAttribute() }, at: attrAt });
          continue;
        }
        if (!this.peek("{")) {
          throw new SourceFailure(
            "Attribute values must be quoted strings or an expression in braces",
            this.pos,
          );
        }
        const braceAt = this.pos;
        if (this.closing(braceAt) === -1 && !this.source.slice(braceAt).includes("<")) {
          throw new SourceFailure("Unclosed brace attribute", braceAt);
        }
        this.pos += 1;
        this.skip();
        if (this.peek("}")) throw new SourceFailure("Empty JSX expression", braceAt);
        const value = this.expression();
        this.skip();
        this.expect("}");
        attributes.push({ name, value, at: attrAt });
      }
    }

    const children: JsxChild[] = [];
    for (;;) {
      if (this.pos >= this.source.length) {
        throw new SourceFailure(`Unclosed ${tag ? `<${tag}>` : "fragment"}`, at);
      }
      if (this.peek("</")) {
        this.pos += 2;
        if (tag === null) {
          this.expect(">");
        } else {
          this.skipWhitespace();
          const close = this.jsxName("closing tag", true);
          if (close !== tag) {
            throw new SourceFailure(
              `Expected </${tag}> but found </${close}>`,
              this.pos - close.length,
            );
          }
          this.skipWhitespace();
          this.expect(">");
        }
        return { tag, attributes, children, at };
      }
      if (this.peek("<")) {
        children.push(this.jsxElement());
        continue;
      }
      if (this.peek("{")) {
        const exprAt = this.pos;
        this.pos += 1;
        this.skip();
        // `{/* Hero */}` and `{}` hold nothing.
        if (this.take("}")) continue;
        const expr = this.expression();
        this.skip();
        this.expect("}");
        children.push({ expr, at: exprAt });
        continue;
      }
      const textAt = this.pos;
      let end = this.pos;
      while (end < this.source.length && this.source[end] !== "<" && this.source[end] !== "{") {
        end += 1;
      }
      children.push({ text: this.source.slice(this.pos, end), at: textAt });
      this.pos = end;
    }
  }
}

const asyncBody = (at: number): FunctionBody => ({
  unreadable: new SourceFailure(
    "An async function can't be evaluated: a design holds the data itself, not the call that fetches it. Write the values inline.",
    at,
  ),
});

// --- evaluation --------------------------------------------------------------

/** What a JSX expression evaluates to: the elements and text it produced. */
class Rendered {
  constructor(readonly pieces: Array<SourceElement | SourceText>) {}
}

class Closure {
  constructor(
    readonly shape: FunctionShape,
    readonly scope: Scope,
  ) {}
}

class Native {
  constructor(
    readonly name: string,
    readonly call: (args: unknown[], at: number) => unknown,
  ) {}
}

/** A formatter or a date: a host object reached only through the methods listed here. */
class Host {
  constructor(
    readonly kind: "number-format" | "date-format" | "date",
    readonly value: Intl.NumberFormat | Intl.DateTimeFormat | Date,
  ) {}
}

/** The module a scope's code was written in: what it imports, and from which file. */
interface ModuleInfo {
  imports: Imports;
  file: string | null;
}

class Scope {
  private readonly names = new Map<string, unknown>();
  constructor(
    private readonly parent?: Scope,
    private readonly module?: ModuleInfo,
  ) {}

  info(): ModuleInfo | undefined {
    return this.module ?? this.parent?.info();
  }

  /** Every name declared directly in this scope — a module's exports. */
  own(): Record<string, unknown> {
    return Object.fromEntries(this.names);
  }

  has(name: string): boolean {
    return this.names.has(name) || (this.parent?.has(name) ?? false);
  }

  get(name: string): unknown {
    return this.names.has(name) ? this.names.get(name) : this.parent?.get(name);
  }

  set(name: string, value: unknown): void {
    this.names.set(name, value);
  }
}

/**
 * A component the source imports (`Layout`, `IconBolt`) or a part reached
 * through one (`Layout.Header`): a name to render, with no value to read. It
 * can travel as data — a nav item's `icon`, a destructured `Header` — and
 * becomes a tag where it is rendered.
 */
class ComponentName {
  constructor(
    readonly name: string,
    /** The imported name it was reached from, and where that came from. */
    readonly imported: string,
    readonly from: string,
  ) {}
}

class Returned {
  constructor(readonly value: unknown) {}
}

const MAX_STEPS = 400_000;
const MAX_DEPTH = 80;
const MAX_ITEMS = 5_000;
const UNSAFE_KEY = /^(__proto__|prototype|constructor)$/;

const ARRAY_METHODS = new Set([
  "map",
  "filter",
  "flatMap",
  "forEach",
  "find",
  "findIndex",
  "findLast",
  "some",
  "every",
  "reduce",
  "sort",
  "toSorted",
  "slice",
  "concat",
  "join",
  "includes",
  "indexOf",
  "at",
  "flat",
  "reverse",
  "toReversed",
  "fill",
  "keys",
  "entries",
]);
const STRING_METHODS = new Set([
  "toUpperCase",
  "toLowerCase",
  "trim",
  "trimStart",
  "trimEnd",
  "slice",
  "substring",
  "split",
  "replace",
  "replaceAll",
  "startsWith",
  "endsWith",
  "includes",
  "indexOf",
  "padStart",
  "padEnd",
  "charAt",
  "repeat",
  "at",
  "concat",
  "toString",
  "localeCompare",
]);
const NUMBER_METHODS = new Set(["toFixed", "toLocaleString", "toString", "toPrecision"]);
const DATE_METHODS = new Set([
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleString",
  "toISOString",
  "getFullYear",
  "getMonth",
  "getDate",
  "getDay",
  "getHours",
  "getMinutes",
  "getTime",
]);
const HOOK_VALUES = new Set([
  "useState",
  "useMemo",
  "useCallback",
  "useRef",
  "useId",
  "useReducer",
]);
const HOOK_EFFECTS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const FONT_LOADER = /^next\/font\//;
const CLASS_JOINERS = new Set([
  "cn",
  "clsx",
  "classNames",
  "classnames",
  "cx",
  "twMerge",
  "twJoin",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return !(
    value instanceof Rendered ||
    value instanceof Closure ||
    value instanceof Native ||
    value instanceof Host ||
    value instanceof ComponentName ||
    value instanceof ElementValue
  );
}

/** `cn("a", cond && "b", { c: true }, ["d"])` → `"a b c d"`, as clsx reads it. */
function joinClasses(values: unknown[]): string {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string" || typeof value === "number") {
      if (value !== "") out.push(String(value));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (isPlainObject(value)) {
      for (const [key, on] of Object.entries(value)) if (on) out.push(key);
    }
  };
  values.forEach(visit);
  return out.join(" ");
}

class Evaluator {
  private steps = 0;
  private depth = 0;
  private elements = 0;
  readonly inlined = new Map<string, number>();
  readonly dropped = new Map<string, number>();
  readonly hooks = new Set<string>();
  /** Sentences about what was done with the page's layouts. */
  readonly remarks: string[] = [];

  private readonly loaded = new Map<string, Record<string, unknown> | "loading">();
  private readonly foreign = new WeakSet<SourceFailure>();

  constructor(
    private readonly modules: ModuleLoader | undefined,
    /** The file of the source being composed (null when it was sent inline). */
    private readonly file: string | null,
  ) {}

  /**
   * The names a module of the app declares, evaluated the way the source
   * itself is. Null when the specifier is not one of the app's files.
   */
  private exportsOf(
    specifier: string,
    from: string | null,
    at: number,
  ): Record<string, unknown> | null {
    const found = this.modules?.load(specifier, from) ?? null;
    if (!found) return null;
    const cached = this.loaded.get(found.file);
    if (cached === "loading") {
      this.fail(`"${specifier}" imports itself in a circle, which can't be read as data.`, at);
    }
    if (cached) return cached;
    this.loaded.set(found.file, "loading");
    try {
      const parser = new SourceParser(found.source);
      const program = parser.program(false, true);
      const scope = new Scope(this.globals(), { imports: parser.imports, file: found.file });
      this.run(program.statements, scope);
      const exports = scope.own();
      if (program.entry !== undefined) exports.default = scope.get(program.entry);
      this.loaded.set(found.file, exports);
      return exports;
    } catch (error) {
      this.loaded.delete(found.file);
      if (!(error instanceof SourceFailure)) throw error;
      // The offset is the other file's; the import is what this source can point at.
      const line = found.source.slice(0, error.offset).split("\n").length;
      throw new SourceFailure(`In "${specifier}" (line ${line}): ${error.message}`, at);
    }
  }

  globals(): Scope {
    const scope = new Scope();
    const native = (name: string, call: (args: unknown[], at: number) => unknown) =>
      new Native(name, call);
    const numeric = (name: string, fn: (...values: number[]) => number) =>
      native(name, (args) => fn(...args.map(Number)));
    scope.set("Math", {
      round: numeric("Math.round", Math.round),
      floor: numeric("Math.floor", Math.floor),
      ceil: numeric("Math.ceil", Math.ceil),
      trunc: numeric("Math.trunc", Math.trunc),
      abs: numeric("Math.abs", Math.abs),
      sqrt: numeric("Math.sqrt", Math.sqrt),
      pow: numeric("Math.pow", Math.pow),
      min: numeric("Math.min", Math.min),
      max: numeric("Math.max", Math.max),
      PI: Math.PI,
    });
    scope.set("Object", {
      keys: native("Object.keys", ([value]) => (isPlainObject(value) ? Object.keys(value) : [])),
      values: native("Object.values", ([value]) =>
        isPlainObject(value) ? Object.values(value) : [],
      ),
      entries: native("Object.entries", ([value]) =>
        isPlainObject(value) ? Object.entries(value) : [],
      ),
      fromEntries: native("Object.fromEntries", ([value]) => {
        const out: Record<string, unknown> = {};
        for (const entry of Array.isArray(value) ? value : []) {
          if (Array.isArray(entry) && !UNSAFE_KEY.test(String(entry[0]))) {
            out[String(entry[0])] = entry[1];
          }
        }
        return out;
      }),
    });
    scope.set(
      "Array",
      Object.assign(
        native("Array", ([length]) => this.sized(Number(length ?? 0))),
        {},
      ),
    );
    scope.set("JSON", { stringify: native("JSON.stringify", ([value]) => JSON.stringify(value)) });
    scope.set(
      "String",
      native("String", ([value]) => String(value)),
    );
    scope.set(
      "Number",
      native("Number", ([value]) => Number(value)),
    );
    scope.set(
      "Boolean",
      native("Boolean", ([value]) => Boolean(value)),
    );
    scope.set(
      "parseInt",
      native("parseInt", ([value, radix]) =>
        Number.parseInt(String(value), radix === undefined ? 10 : Number(radix)),
      ),
    );
    scope.set(
      "parseFloat",
      native("parseFloat", ([value]) => Number.parseFloat(String(value))),
    );
    scope.set("NaN", Number.NaN);
    scope.set("Infinity", Number.POSITIVE_INFINITY);
    return scope;
  }

  private sized(length: number): unknown[] {
    if (!Number.isInteger(length) || length < 0 || length > MAX_ITEMS) {
      throw new SourceFailure(`An array of ${length} items is more than a design holds`, 0);
    }
    return new Array(length).fill(undefined);
  }

  private fail(message: string, at: number): never {
    throw new SourceFailure(message, at);
  }

  /**
   * `pieces` as the layout in `source` renders them: its default export called
   * with them as `children`, and the document shell a root layout adds
   * (`<html>`, `<head>`, `<body>`) taken off — a screen is what goes in the
   * body, in a `div` carrying the body's own classes when it has any.
   */
  wrap(
    layout: { file: string; source: string },
    pieces: Array<SourceElement | SourceText>,
  ): Array<SourceElement | SourceText> {
    const parser = new SourceParser(layout.source);
    const program = parser.program(false, true);
    const scope = new Scope(this.globals(), { imports: parser.imports, file: layout.file });
    this.run(program.statements, scope);
    const entry = program.entry === undefined ? undefined : scope.get(program.entry);
    if (!(entry instanceof Closure)) {
      throw new SourceFailure("it has no default-exported component", 0);
    }
    const rendered = this.invoke(entry, [{ children: new Rendered(pieces) }], entry.shape.at);
    const out = this.pieces(rendered, entry.shape.at);
    const html = out.find(
      (piece): piece is SourceElement => "tag" in piece && piece.tag === "html",
    );
    if (!html) return out;
    const body = html.children.find(
      (piece): piece is SourceElement => "tag" in piece && piece.tag === "body",
    );
    if (!body) return out;
    const classes = body.attributes.filter((attribute) => attribute.name === "className");
    return classes.length === 0
      ? body.children
      : [{ tag: "div", attributes: classes, children: body.children, offset: body.offset }];
  }

  // -- statements --

  run(statements: Statement[], scope: Scope): Returned | null {
    for (const statement of statements) {
      switch (statement.k) {
        case "declare":
          this.bind(
            statement.pattern,
            statement.init ? this.value(statement.init, scope) : undefined,
            scope,
          );
          break;
        case "return":
          return new Returned(statement.value ? this.value(statement.value, scope) : undefined);
        case "if": {
          const branch = this.value(statement.test, scope) ? statement.then : statement.otherwise;
          const returned = this.run(branch, new Scope(scope));
          if (returned) return returned;
          break;
        }
        case "expression":
          this.value(statement.expr, scope);
          break;
      }
    }
    return null;
  }

  private bind(pattern: Pattern, given: unknown, scope: Scope): void {
    const value =
      given === undefined && pattern.fallback ? this.value(pattern.fallback, scope) : given;
    switch (pattern.k) {
      case "name":
        scope.set(pattern.name, value);
        return;
      case "object": {
        // `const { Header, Content } = Layout` names the parts of an imported component.
        const part = (key: string): unknown =>
          value instanceof ComponentName ? this.member(value, key, 0) : undefined;
        const source = isPlainObject(value) ? value : {};
        const taken = new Set<string>();
        for (const entry of pattern.entries) {
          taken.add(entry.key);
          this.bind(
            entry.value,
            Object.hasOwn(source, entry.key) ? source[entry.key] : part(entry.key),
            scope,
          );
        }
        if (pattern.rest) {
          scope.set(
            pattern.rest,
            Object.fromEntries(Object.entries(source).filter(([key]) => !taken.has(key))),
          );
        }
        return;
      }
      case "array": {
        const source = Array.isArray(value) ? value : [];
        pattern.items.forEach((item, index) => {
          if (item) this.bind(item, source[index], scope);
        });
        if (pattern.rest) scope.set(pattern.rest, source.slice(pattern.items.length));
        return;
      }
    }
  }

  // -- expressions --

  value(expr: Expr, scope: Scope): unknown {
    this.steps += 1;
    if (this.steps > MAX_STEPS) this.fail("This source is too much to evaluate as a design", 0);
    switch (expr.k) {
      case "lit":
        return expr.value;
      case "template":
        return expr.quasis
          .map((quasi, index) => {
            const part = expr.parts[index];
            return part ? quasi + this.text(this.value(part, scope)) : quasi;
          })
          .join("");
      case "id":
        return this.lookup(expr.name, scope, expr.at);
      case "array": {
        const out: unknown[] = [];
        for (const item of expr.items) {
          if ("spread" in item) {
            const spread = this.value(item.spread, scope);
            if (Array.isArray(spread)) out.push(...spread);
            else if (typeof spread === "string") out.push(...spread);
          } else out.push(this.value(item, scope));
        }
        if (out.length > MAX_ITEMS) this.fail("That list is more than a design holds", 0);
        return out;
      }
      case "object": {
        const out: Record<string, unknown> = {};
        for (const entry of expr.entries) {
          if ("spread" in entry) {
            const spread = this.value(entry.spread, scope);
            if (isPlainObject(spread)) Object.assign(out, spread);
            continue;
          }
          const key =
            typeof entry.key === "string" ? entry.key : String(this.value(entry.key, scope));
          if (UNSAFE_KEY.test(key)) this.fail("unsafe object key", 0);
          out[key] = this.value(entry.value, scope);
        }
        return out;
      }
      case "member": {
        const object = this.value(expr.object, scope);
        if (object === null || object === undefined) {
          if (expr.optional) return undefined;
          const name =
            typeof expr.property === "string" ? expr.property : this.value(expr.property, scope);
          this.fail(`Can't read \`${String(name)}\` of ${String(object)}`, expr.at);
        }
        const key =
          typeof expr.property === "string" ? expr.property : this.value(expr.property, scope);
        return this.member(object, key, expr.at);
      }
      case "call":
        return this.callExpression(expr, scope);
      case "new":
        return this.construct(expr, scope);
      case "unary": {
        if (expr.op === "typeof") {
          const operand = expr.operand;
          if (operand.k === "id" && !scope.has(operand.name)) return "undefined";
          const value = this.value(operand, scope);
          if (value instanceof Closure || value instanceof Native) return "function";
          return value === null ? "object" : typeof value;
        }
        const value = this.value(expr.operand, scope);
        if (expr.op === "!") return !value;
        return expr.op === "-" ? -Number(value) : Number(value);
      }
      case "logical": {
        const left = this.value(expr.left, scope);
        if (expr.op === "&&") return left ? this.value(expr.right, scope) : left;
        if (expr.op === "||") return left ? left : this.value(expr.right, scope);
        return left === null || left === undefined ? this.value(expr.right, scope) : left;
      }
      case "binary":
        return this.binary(
          expr.op,
          this.value(expr.left, scope),
          this.value(expr.right, scope),
          expr.at,
        );
      case "conditional":
        return this.value(expr.test, scope)
          ? this.value(expr.then, scope)
          : this.value(expr.otherwise, scope);
      case "function":
        return new Closure(expr.fn, scope);
      case "jsx":
        return new Rendered(this.render(expr.element, scope));
    }
  }

  private lookup(name: string, scope: Scope, at: number): unknown {
    if (scope.has(name)) return scope.get(name);
    if (CLASS_JOINERS.has(name)) return new Native(name, (args) => joinClasses(args));
    if (HOOK_VALUES.has(name) || HOOK_EFFECTS.has(name)) return this.hook(name);
    if (name === "React") {
      return Object.fromEntries(
        [...HOOK_VALUES, ...HOOK_EFFECTS].map((hook) => [hook, this.hook(hook)]),
      );
    }
    if (/^use[A-Z]/.test(name)) {
      this.fail(
        `The hook \`${name}\` has no value in a static design. Replace its call with the value this screen should show (\`const pathname = "/reviews"\`).`,
        at,
      );
    }
    const module = scope.info();
    const imported = module?.imports.get(name);
    if (imported !== undefined) {
      const { from, exported } = imported;
      // `Inter({ variable: "--font-sans" })`: a font the framework loads. A
      // design's fonts are its theme's, so the loader yields no classes.
      if (FONT_LOADER.test(from)) {
        return new Native(name, () => ({ className: "", variable: "", style: {} }));
      }
      // `Layout`, `IconBolt` — a component, rendered as the tag it names.
      if (/^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name)) {
        return new ComponentName(name, name, from);
      }
      // `reviews`, `SHIPMENTS`, `formatPrice` — data and helpers, read from the app's own file.
      const exports = this.exportsOf(from, module?.file ?? null, at);
      if (exports === null) this.notSent(name, from, at);
      if (exported === "*") return exports;
      if (!Object.hasOwn(exports, exported)) {
        this.fail(`"${from}" has no export named \`${exported}\`.`, at);
      }
      return exports[exported];
    }
    this.fail(
      `\`${name}\` is not defined in this JSX. compose reads only the source you send: declare it above the JSX (\`const ${name} = …\`) or write the value inline.`,
      at,
    );
  }

  private notSent(name: string, from: string, at: number): never {
    this.fail(
      `\`${name}\` is imported from "${from}", which is not a file of this app that compose can read. Declare its value above the JSX (\`const ${name} = …\`) or write the values inline.`,
      at,
    );
  }

  private hook(name: string): Native {
    return new Native(name, (args) => {
      this.hooks.add(name);
      const [first, second] = args;
      const initial = (value: unknown): unknown =>
        value instanceof Closure ? this.invoke(value, [], 0) : value;
      const ignore = new Native("setter", () => undefined);
      switch (name) {
        case "useState":
          return [initial(first), ignore];
        case "useReducer":
          return [second, ignore];
        case "useMemo":
          return initial(first);
        case "useCallback":
          return first;
        case "useRef":
          return { current: first ?? null };
        case "useId":
          return "id";
        default:
          return undefined;
      }
    });
  }

  private text(value: unknown): string {
    if (value instanceof ComponentName) this.notSent(value.imported, value.from, 0);
    if (value === null || value === undefined) return String(value);
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map((item) => this.text(item)).join(",");
    return "[object Object]";
  }

  private binary(op: string, left: unknown, right: unknown, at: number): unknown {
    switch (op) {
      case "===":
        return left === right;
      case "!==":
        return left !== right;
      case "==":
        // biome-ignore lint/suspicious/noDoubleEquals: evaluating the source's own loose comparison
        return left == right;
      case "!=":
        // biome-ignore lint/suspicious/noDoubleEquals: evaluating the source's own loose comparison
        return left != right;
      case "+":
        return typeof left === "string" || typeof right === "string"
          ? this.text(left) + this.text(right)
          : Number(left) + Number(right);
      case "-":
        return Number(left) - Number(right);
      case "*":
        return Number(left) * Number(right);
      case "/":
        return Number(left) / Number(right);
      case "%":
        return Number(left) % Number(right);
      case "<":
      case ">":
      case "<=":
      case ">=": {
        const [a, b] =
          typeof left === "string" && typeof right === "string"
            ? [left, right]
            : [Number(left), Number(right)];
        if (op === "<") return a < b;
        if (op === ">") return a > b;
        return op === "<=" ? a <= b : a >= b;
      }
      default:
        return this.fail(`The operator ${op} can't be evaluated as design data`, at);
    }
  }

  private member(object: unknown, key: unknown, at: number): unknown {
    const name = typeof key === "number" ? key : String(key);
    if (typeof name === "string" && UNSAFE_KEY.test(name)) return undefined;
    if (typeof object === "string") {
      if (name === "length") return object.length;
      if (typeof name === "number" || /^\d+$/.test(name)) return object[Number(name)];
      if (STRING_METHODS.has(name)) return this.method(object, name);
      return undefined;
    }
    if (Array.isArray(object)) {
      if (name === "length") return object.length;
      if (typeof name === "number" || /^\d+$/.test(name)) return object[Number(name)];
      if (ARRAY_METHODS.has(name)) return this.method(object, name);
      return undefined;
    }
    if (typeof object === "number") {
      return typeof name === "string" && NUMBER_METHODS.has(name)
        ? this.method(object, name)
        : undefined;
    }
    if (object instanceof Native && object.name === "Array") {
      if (name === "from") {
        return new Native("Array.from", ([source, map]) => {
          const items = Array.isArray(source)
            ? [...source]
            : typeof source === "string"
              ? [...source]
              : isPlainObject(source) && typeof source.length === "number"
                ? this.sized(source.length)
                : [];
          return map === undefined
            ? items
            : items.map((item, i) => this.invoke(map, [item, i], at));
        });
      }
      if (name === "isArray") return new Native("Array.isArray", ([value]) => Array.isArray(value));
      return undefined;
    }
    if (object instanceof ComponentName) {
      return new ComponentName(`${object.name}.${String(name)}`, object.imported, object.from);
    }
    if (object instanceof Host) return this.hostMember(object, String(name), at);
    if (isPlainObject(object)) {
      return Object.hasOwn(object, String(name)) ? object[String(name)] : undefined;
    }
    return undefined;
  }

  private hostMember(host: Host, name: string, at: number): unknown {
    if (host.kind !== "date") {
      const formatter = host.value as Intl.NumberFormat | Intl.DateTimeFormat;
      if (name !== "format") return undefined;
      return new Native("format", ([value]) =>
        host.kind === "number-format"
          ? (formatter as Intl.NumberFormat).format(Number(value))
          : (formatter as Intl.DateTimeFormat).format(
              value instanceof Host ? (value.value as Date) : new Date(String(value)),
            ),
      );
    }
    if (!DATE_METHODS.has(name)) return undefined;
    const date = host.value as Date;
    return new Native(name, (args) => {
      const plain = args.map((arg) => this.plain(arg, at));
      const fn = (date as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
      return fn?.apply(date, plain);
    });
  }

  /** A value handed to a host function: data only, never one of this evaluator's own objects. */
  private plain(value: unknown, at: number): unknown {
    if (value instanceof Closure || value instanceof Native || value instanceof Rendered) {
      this.fail("A function or element can't be passed here", at);
    }
    return value instanceof Host ? value.value : value;
  }

  private method(target: string | number | unknown[], name: string): Native {
    return new Native(name, (args, at) => {
      if (Array.isArray(target)) return this.arrayMethod(target, name, args, at);
      const plain = args.map((arg) => this.plain(arg, at));
      if (typeof target === "string" && (name === "replace" || name === "replaceAll")) {
        if (typeof plain[0] !== "string" || typeof plain[1] !== "string") {
          this.fail(`\`${name}\` is evaluated with text arguments only`, at);
        }
      }
      if (typeof target === "string" && name === "repeat" && Number(plain[0]) > MAX_ITEMS) {
        this.fail("That text is more than a design holds", at);
      }
      const fn = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
      return fn?.apply(target, plain);
    });
  }

  private arrayMethod(list: unknown[], name: string, args: unknown[], at: number): unknown {
    const call =
      (fn: unknown) =>
      (...values: unknown[]): unknown =>
        this.invoke(fn, values, at);
    const [first, second] = args;
    switch (name) {
      case "map":
        return list.map(call(first));
      case "filter":
        return list.filter(call(first));
      case "flatMap":
        return list.flatMap(call(first));
      case "forEach":
        return undefined;
      case "find":
        return list.find(call(first));
      case "findLast":
        return list.findLast(call(first));
      case "findIndex":
        return list.findIndex(call(first));
      case "some":
        return list.some(call(first));
      case "every":
        return list.every(call(first));
      case "reduce":
        return args.length > 1 ? list.reduce(call(first), second) : list.reduce(call(first));
      case "sort":
      case "toSorted": {
        const copy = [...list];
        return first === undefined
          ? copy.sort()
          : copy.sort((a, b) => Number(this.invoke(first, [a, b], at)));
      }
      case "reverse":
      case "toReversed":
        return [...list].reverse();
      case "fill":
        return [...list].fill(first);
      case "keys":
        return list.map((_, index) => index);
      case "entries":
        return list.map((item, index) => [index, item]);
      case "join":
        return list
          .map((item) => (item === null || item === undefined ? "" : this.text(item)))
          .join(second === undefined && first === undefined ? "," : this.text(first));
      case "slice":
        return list.slice(first as number | undefined, second as number | undefined);
      case "concat":
        return list.concat(...args);
      case "includes":
        return list.includes(first);
      case "indexOf":
        return list.indexOf(first);
      case "at":
        return list.at(Number(first));
      case "flat":
        return list.flat(first === undefined ? 1 : Number(first));
      default:
        return this.fail(`\`${name}\` can't be evaluated as design data`, at);
    }
  }

  private spreadArgs(args: Array<Expr | Spread>, scope: Scope): unknown[] {
    const out: unknown[] = [];
    for (const arg of args) {
      if ("spread" in arg) {
        const spread = this.value(arg.spread, scope);
        if (Array.isArray(spread)) out.push(...spread);
      } else out.push(this.value(arg, scope));
    }
    return out;
  }

  private callExpression(expr: Extract<Expr, { k: "call" }>, scope: Scope): unknown {
    const callee = this.value(expr.callee, scope);
    if (callee === undefined || callee === null) {
      if (expr.optional) return undefined;
      this.fail(
        `${this.describe(expr.callee)} can't be evaluated: ${this.whyNot(expr.callee)}`,
        expr.at,
      );
    }
    return this.invoke(callee, this.spreadArgs(expr.args, scope), expr.at, expr.callee);
  }

  private describe(expr: Expr): string {
    if (expr.k === "id") return `\`${expr.name}()\``;
    if (expr.k === "member" && typeof expr.property === "string") return `\`.${expr.property}()\``;
    return "That call";
  }

  private whyNot(expr: Expr): string {
    return expr.k === "member"
      ? "only the array, text and number methods a render uses (`.map`, `.filter`, `.join`, `.toFixed`, …) are read as design data. Write the resulting value inline."
      : "it is not a function this source defines.";
  }

  invoke(fn: unknown, args: unknown[], at: number, callee?: Expr): unknown {
    if (fn instanceof Native) return fn.call(args, at);
    if (fn instanceof ComponentName) this.notSent(fn.imported, fn.from, at);
    if (!(fn instanceof Closure)) {
      return this.fail(
        `${callee ? this.describe(callee) : "That value"} is not a function this source defines`,
        at,
      );
    }
    this.depth += 1;
    if (this.depth > MAX_DEPTH) this.fail("This source recurses too deeply to evaluate", at);
    const home = fn.scope.info()?.file ?? null;
    try {
      const scope = new Scope(fn.scope);
      fn.shape.params.forEach((param, index) => {
        this.bind(param, args[index], scope);
      });
      if (fn.shape.rest) scope.set(fn.shape.rest, args.slice(fn.shape.params.length));
      const body = fn.shape.body;
      if ("unreadable" in body) throw body.unreadable;
      if ("expr" in body) return this.value(body.expr, scope);
      return this.run(body.statements, scope)?.value;
    } catch (error) {
      // A function from another file fails at an offset in that file; the
      // source being composed can only point at where it called it.
      if (error instanceof SourceFailure && home !== this.file && !this.foreign.has(error)) {
        const wrapped = new SourceFailure(
          `In ${fn.shape.name ? `\`${fn.shape.name}\`` : "a function"} from another file: ${error.message}`,
          at,
        );
        this.foreign.add(wrapped);
        throw wrapped;
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  private construct(expr: Extract<Expr, { k: "new" }>, scope: Scope): unknown {
    const name =
      expr.callee.k === "id"
        ? expr.callee.name
        : expr.callee.k === "member" &&
            expr.callee.object.k === "id" &&
            typeof expr.callee.property === "string"
          ? `${expr.callee.object.name}.${expr.callee.property}`
          : "";
    const args = this.spreadArgs(expr.args, scope).map((arg) => this.plain(arg, expr.at));
    try {
      if (name === "Intl.NumberFormat") {
        return new Host(
          "number-format",
          new Intl.NumberFormat(args[0] as string | undefined, args[1] as Intl.NumberFormatOptions),
        );
      }
      if (name === "Intl.DateTimeFormat") {
        return new Host(
          "date-format",
          new Intl.DateTimeFormat(
            args[0] as string | undefined,
            args[1] as Intl.DateTimeFormatOptions,
          ),
        );
      }
      if (name === "Date") {
        if (args.length === 0) {
          this.fail(
            '`new Date()` is the moment the design is read, which changes every time. Give it the date this screen should show (`new Date("2026-03-14")`).',
            expr.at,
          );
        }
        return new Host("date", new Date(...(args as [string])));
      }
      if (name === "Array") return this.sized(Number(args[0] ?? 0));
    } catch (error) {
      if (error instanceof SourceFailure) throw error;
      this.fail(`\`new ${name}(…)\` failed: ${(error as Error).message}`, expr.at);
    }
    return this.fail(
      `\`new ${name || "…"}\` can't be evaluated as design data; write the resulting value inline.`,
      expr.at,
    );
  }

  // -- JSX --

  /** The elements and text one JSX element produces — several, for a fragment or a local component. */
  render(node: JsxNode, scope: Scope): Array<SourceElement | SourceText> {
    let tag = node.tag === "Fragment" || node.tag === "React.Fragment" ? null : node.tag;
    // A tag the source binds: a component it defines, one it imported under
    // another name or keeps in data (`<item.icon />`), or an element chosen by
    // a string (`const Tag = "h2"`).
    let local: unknown;
    const [head, ...path] = tag?.split(".") ?? [];
    if (head !== undefined && scope.has(head)) {
      local = scope.get(head);
      for (const part of path)
        local = local == null ? undefined : this.member(local, part, node.at);
      if (local instanceof ComponentName) tag = local.name;
      else if (typeof local === "string" && local !== "") tag = local;
    }

    if (local instanceof Closure) {
      const props: Record<string, unknown> = {};
      for (const attribute of node.attributes) {
        if ("spread" in attribute) {
          const spread = this.value(attribute.spread, scope);
          if (isPlainObject(spread)) Object.assign(props, spread);
        } else if (attribute.name !== "key" && attribute.name !== "ref") {
          props[attribute.name] =
            attribute.value === true ? true : this.value(attribute.value, scope);
        }
      }
      const children = this.children(node.children, scope);
      if (children.length > 0) {
        const only = children.length === 1 ? children[0] : undefined;
        props.children =
          only && !("tag" in only) && only.literal ? only.text : new Rendered(children);
      }
      this.inlined.set(tag as string, (this.inlined.get(tag as string) ?? 0) + 1);
      return this.pieces(this.invoke(local, [props], node.at), node.at);
    }

    const children = this.children(node.children, scope);
    // A fragment is its children wherever it sits; the root keeps its own (see `readJsxSource`).
    if (tag === null) return children;

    this.elements += 1;
    if (this.elements > MAX_ITEMS)
      this.fail("This source renders more than a design holds", node.at);
    const attributes: SourceAttribute[] = [];
    const spreadNames = new Set<string>();
    const put = (name: string, raw: unknown, offset: number, fromSpread: boolean): void => {
      if (name === "key" || name === "ref") return;
      if (/^on[A-Z]/.test(name) || raw instanceof Closure || raw instanceof Native) {
        this.dropped.set(name, (this.dropped.get(name) ?? 0) + 1);
        return;
      }
      if (raw === undefined) return;
      if (raw instanceof ComponentName) {
        this.fail(
          `"${raw.name}" is a component type, which a design can't hold. Pass an element instead (\`${name}={<${raw.name} />}\`), or nest the content inside <${raw.name}>.`,
          offset,
        );
      }
      let value = raw;
      if (raw instanceof Rendered) {
        const elements = raw.pieces.filter((piece): piece is SourceElement => "tag" in piece);
        const words = raw.pieces.filter((piece) => !("tag" in piece) && piece.text.trim() !== "");
        if (elements.length === 1 && words.length === 0) {
          value = new ElementValue(elements[0] as SourceElement);
        } else if (elements.length === 0) {
          value = raw.pieces.map((piece) => ("tag" in piece ? "" : piece.text)).join("");
        } else {
          this.fail(
            `The prop \`${name}\` holds several elements; a prop takes one. Wrap them in a single element.`,
            offset,
          );
        }
      } else if (raw instanceof Host) {
        this.fail(
          `The prop \`${name}\` holds a formatter or date, not its text; call \`.format(…)\` or \`.toLocaleDateString()\`.`,
          offset,
        );
      }
      const existing = attributes.findIndex((attribute) => attribute.name === name);
      // A later value wins over a spread's, as in React; two written-out
      // attributes of one name stay a mistake for the compiler to report.
      if (existing !== -1 && (fromSpread || spreadNames.has(name))) attributes.splice(existing, 1);
      if (fromSpread) spreadNames.add(name);
      attributes.push({ name, value, offset });
    };
    for (const attribute of node.attributes) {
      if ("spread" in attribute) {
        const spread = this.value(attribute.spread, scope);
        if (isPlainObject(spread)) {
          for (const [name, value] of Object.entries(spread)) {
            if (name === "children") continue;
            put(name, value, attribute.at, true);
          }
        }
      } else {
        put(
          attribute.name,
          attribute.value === true ? true : this.attribute(attribute.value, scope),
          attribute.at,
          false,
        );
      }
    }
    return [{ tag, attributes, children, offset: node.at }];
  }

  /**
   * An attribute's value. A bare capitalised name nothing defines is a
   * component *type* (`component={ScrollArea}`, `as={Link}`) — a polymorphic
   * prop a design can't hold, and naming that beats "not defined".
   */
  private attribute(expr: Expr, scope: Scope): unknown {
    const path = (candidate: Expr): string | null =>
      candidate.k === "id"
        ? candidate.name
        : candidate.k === "member" && typeof candidate.property === "string"
          ? ((base) => (base ? `${base}.${candidate.property as string}` : null))(
              path(candidate.object),
            )
          : null;
    const name = path(expr);
    const root = name?.split(".")[0] ?? "";
    if (name && /^[A-Z]/.test(name) && !scope.has(root) && !scope.info()?.imports.has(root)) {
      this.fail(
        `"${name}" is a component type, which a design can't hold. Pass an element instead (\`icon={<${name} />}\`), or nest the content inside <${name}>.`,
        expr.k === "id" || expr.k === "member" ? expr.at : 0,
      );
    }
    return this.value(expr, scope);
  }

  private children(children: JsxChild[], scope: Scope): Array<SourceElement | SourceText> {
    const out: Array<SourceElement | SourceText> = [];
    for (const child of children) {
      if ("text" in child) out.push({ text: child.text, offset: child.at });
      else if ("expr" in child) out.push(...this.pieces(this.value(child.expr, scope), child.at));
      else out.push(...this.render(child, scope));
    }
    return out;
  }

  /** A value in child position, as React renders it. */
  private pieces(value: unknown, at: number): Array<SourceElement | SourceText> {
    if (value === null || value === undefined || typeof value === "boolean") return [];
    if (typeof value === "string" || typeof value === "number") {
      return [{ text: String(value), offset: at, literal: true }];
    }
    if (Array.isArray(value)) return value.flatMap((item) => this.pieces(item, at));
    if (value instanceof Rendered) return value.pieces;
    if (value instanceof ElementValue) return [value.element];
    if (value instanceof ComponentName) this.notSent(value.imported, value.from, at);
    return this.fail(
      value instanceof Closure || value instanceof Native
        ? "A function can't be rendered as a child; call it, or write the element it returns."
        : "An object can't be rendered as a child; write the field to show (`{item.label}`).",
      at,
    );
  }
}

/**
 * Parse and statically evaluate compose's JSX. `siblings` lets several roots
 * stand side by side, as an append takes them.
 */
export function readJsxSource(source: string, options: ReadOptions = {}): ReadSource {
  const parser = new SourceParser(source);
  const program = parser.program(options.siblings ?? false);
  const file = options.file ?? null;
  const evaluator = new Evaluator(options.modules, file);
  const scope = new Scope(evaluator.globals(), { imports: parser.imports, file });
  evaluator.run(program.statements, scope);

  let pieces: Array<SourceElement | SourceText>;
  let offset = 0;
  if (program.entry !== undefined) {
    const entry = scope.get(program.entry);
    let rendered: unknown = entry;
    if (entry instanceof Closure) {
      try {
        rendered = evaluator.invoke(entry, [{}], entry.shape.at);
      } catch (error) {
        const props = propNames(entry.shape.params[0]);
        if (!(error instanceof SourceFailure) || props.length === 0) throw error;
        // Composed on its own, a component that takes props was given none.
        throw new SourceFailure(
          `${error.message} — \`${program.entry}\` takes props (${props.join(", ")}) and the source gives it none. End the source with the element to compose: \`<${program.entry} ${props[0]}={…} />\`.`,
          error.offset,
        );
      }
    }
    if (!(rendered instanceof Rendered)) {
      throw new SourceFailure(
        `\`${program.entry}\` returns no markup: the component to compose has to return JSX.`,
        entry instanceof Closure ? entry.shape.at : 0,
      );
    }
    pieces = rendered.pieces;
    offset = entry instanceof Closure ? entry.shape.at : 0;
  } else {
    pieces = [];
    for (const root of program.roots) {
      if (root.k !== "jsx") continue;
      // The root's own fragment survives: `<>…</>` with several roots is the
      // author's mistake to hear about, not ours to flatten away.
      if (root.element.tag === null && program.roots.length === 1) {
        return finish(
          {
            tag: null,
            attributes: [],
            children: evaluator.render(root.element, scope),
            offset: root.element.at,
          },
          evaluator,
        );
      }
      offset = offset || root.element.at;
      pieces.push(...evaluator.render(root.element, scope));
    }
  }
  const wrapped: string[] = [];
  for (const layout of options.layouts ?? []) {
    try {
      pieces = evaluator.wrap(layout, pieces);
      wrapped.push(layout.label);
    } catch (error) {
      if (!(error instanceof SourceFailure)) throw error;
      // The page is still worth having; say what is missing around it.
      evaluator.remarks.push(
        `The app renders this page inside \`${layout.label}\`, which could not be read (${error.message}) — the screen holds the page without what that layout puts around it. Compose that around it yourself.`,
      );
      break;
    }
  }
  if (wrapped.length > 0) {
    evaluator.remarks.push(
      `Composed inside ${wrapped.map((label) => `\`${label}\``).join(", then ")} — the layout the app renders this page in.`,
    );
  }
  const elements = pieces.filter((piece): piece is SourceElement => "tag" in piece);
  const words = pieces.some((piece) => !("tag" in piece) && piece.text.trim() !== "");
  const root =
    elements.length === 1 && !words
      ? (elements[0] as SourceElement)
      : { tag: null, attributes: [], children: pieces, offset };
  return finish(root, evaluator);
}

function propNames(pattern: Pattern | undefined): string[] {
  if (!pattern) return [];
  return pattern.k === "object" ? pattern.entries.map((entry) => entry.key) : [];
}

function finish(root: SourceElement, evaluator: Evaluator): ReadSource {
  const notes: string[] = [...evaluator.remarks];
  const tally = (counts: Map<string, number>): string =>
    [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(", ");
  if (evaluator.inlined.size > 0) {
    notes.push(
      `Components defined in the source were written out where they are used (${tally(evaluator.inlined)}): a design holds elements, not functions. To keep one reusable, make it a snippet with add_snippet and compose its tag.`,
    );
  }
  if (evaluator.dropped.size > 0) {
    notes.push(
      `Dropped props a static design can't hold — handlers and other functions: ${tally(evaluator.dropped)}.`,
    );
  }
  if (evaluator.hooks.size > 0) {
    notes.push(
      `Read ${[...evaluator.hooks].map((hook) => `\`${hook}\``).join(", ")} as the initial value: the design shows the screen's first state.`,
    );
  }
  return { root, notes };
}
