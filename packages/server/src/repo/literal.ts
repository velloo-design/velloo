/**
 * Parse a JavaScript literal expression — the shape a story's `args` or a JSX
 * attribute's `{…}` usually has — into JSON data without evaluating anything.
 * Accepts single/double/backtick strings (no `${}`), numbers, booleans, null,
 * undefined, arrays and objects with identifier or quoted keys and trailing
 * commas. Anything else (an identifier, a call, an arrow) is not a literal.
 */
export type LiteralResult = { ok: true; value: unknown } | { ok: false };

export function parseLiteral(source: string): LiteralResult {
  const parser = new LiteralParser(source);
  try {
    const value = parser.value();
    parser.skip();
    return parser.done() ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

class NotLiteral extends Error {}

class LiteralParser {
  private pos = 0;
  constructor(private readonly src: string) {}

  done(): boolean {
    return this.pos >= this.src.length;
  }

  skip(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos] ?? "";
      if (/\s/.test(ch)) this.pos++;
      else if (this.src.startsWith("//", this.pos)) {
        const end = this.src.indexOf("\n", this.pos);
        this.pos = end === -1 ? this.src.length : end;
      } else if (this.src.startsWith("/*", this.pos)) {
        const end = this.src.indexOf("*/", this.pos + 2);
        this.pos = end === -1 ? this.src.length : end + 2;
      } else break;
    }
  }

  value(): unknown {
    this.skip();
    const ch = this.src[this.pos];
    if (ch === "{") return this.object();
    if (ch === "[") return this.array();
    if (ch === '"' || ch === "'" || ch === "`") return this.string();
    const number = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.pos));
    if (number) {
      this.pos += number[0].length;
      return Number(number[0]);
    }
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
      ["undefined", undefined],
    ] as const) {
      if (
        this.src.startsWith(word, this.pos) &&
        !/[\w$]/.test(this.src[this.pos + word.length] ?? "")
      ) {
        this.pos += word.length;
        return value;
      }
    }
    throw new NotLiteral();
  }

  private string(): string {
    const quote = this.src[this.pos];
    this.pos++;
    let out = "";
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos] ?? "";
      if (ch === quote) {
        this.pos++;
        return out;
      }
      if (quote === "`" && ch === "$" && this.src[this.pos + 1] === "{") throw new NotLiteral();
      if (ch === "\\") {
        const next = this.src[this.pos + 1] ?? "";
        out += next === "n" ? "\n" : next === "t" ? "\t" : next;
        this.pos += 2;
        continue;
      }
      out += ch;
      this.pos++;
    }
    throw new NotLiteral();
  }

  private array(): unknown[] {
    this.pos++;
    const out: unknown[] = [];
    for (;;) {
      this.skip();
      if (this.src[this.pos] === "]") {
        this.pos++;
        return out;
      }
      out.push(this.value());
      this.skip();
      if (this.src[this.pos] === ",") this.pos++;
      else if (this.src[this.pos] !== "]") throw new NotLiteral();
    }
  }

  private object(): Record<string, unknown> {
    this.pos++;
    const out: Record<string, unknown> = {};
    for (;;) {
      this.skip();
      if (this.src[this.pos] === "}") {
        this.pos++;
        return out;
      }
      let key: string;
      const ch = this.src[this.pos];
      if (ch === '"' || ch === "'") key = this.string();
      else {
        const ident = /^[A-Za-z_$][\w$]*/.exec(this.src.slice(this.pos));
        if (!ident) throw new NotLiteral();
        key = ident[0];
        this.pos += key.length;
      }
      this.skip();
      if (this.src[this.pos] !== ":") throw new NotLiteral();
      this.pos++;
      const value = this.value();
      if (value !== undefined) out[key] = value;
      this.skip();
      if (this.src[this.pos] === ",") this.pos++;
      else if (this.src[this.pos] !== "}") throw new NotLiteral();
    }
  }
}
