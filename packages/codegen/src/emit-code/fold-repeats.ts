/**
 * Emit a run of look-alike siblings as the list it is.
 *
 * A design tree holds every repeated element written out — four stat cards are
 * four subtrees — and emitting it one-to-one hands an agent four copies of the
 * same markup to type back in, where the code it would write is one template
 * over an array. So where three or more consecutive siblings emit to the same
 * JSX apart from literal values (a label, a number, a class list, an image),
 * they are emitted once, as `{[…rows].map((item, index) => (…))}`, with those
 * values as the rows.
 *
 * It works on the JSX each sibling already emitted, not on the nodes: two
 * nodes are "the same apart from values" exactly when their emitted code is,
 * whatever lowering, class merging or prop renaming happened on the way — a
 * `Heading` whose `level` differs emits a different tag and simply doesn't
 * match.
 */

interface Token {
  /** `fixed` text is the skeleton; a `value` is a literal that may vary between siblings. */
  kind: "fixed" | "value";
  text: string;
  /** For a value: the attribute it belongs to, or `text` for a child. */
  name?: string;
  /** For a value: whether it sits in child position (text or a `{…}` child). */
  child?: boolean;
}

/** The index just past the `}` closing the `{` at `open`, skipping strings. */
function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i] as string;
    if (char === '"' || char === "'" || char === "`") {
      i += 1;
      while (i < source.length && source[i] !== char) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
    } else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * One emitted element, cut into its skeleton and its literal values. Null when
 * the text isn't an element the emitter wrote (a bare text line, or anything
 * the scan can't account for) — such a sibling is never folded.
 */
function tokenize(jsx: string): Token[] | null {
  const tokens: Token[] = [];
  const fixed = (text: string): void => {
    const last = tokens.at(-1);
    if (last?.kind === "fixed") last.text += text;
    else if (text !== "") tokens.push({ kind: "fixed", text });
  };
  if (!/^\s*<[A-Za-z_$]/.test(jsx)) return null;
  let i = 0;
  while (i < jsx.length) {
    const char = jsx[i] as string;
    if (char === "<") {
      if (jsx[i + 1] === "/") {
        const end = jsx.indexOf(">", i);
        if (end === -1) return null;
        fixed(jsx.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      const tag = /^<[A-Za-z_$][\w$.]*/.exec(jsx.slice(i));
      if (!tag) return null;
      fixed(tag[0]);
      i += tag[0].length;
      for (;;) {
        const space = /^\s*/.exec(jsx.slice(i))?.[0] ?? "";
        fixed(space);
        i += space.length;
        if (jsx.startsWith("/>", i)) {
          fixed("/>");
          i += 2;
          break;
        }
        if (jsx[i] === ">") {
          fixed(">");
          i += 1;
          break;
        }
        const name = /^[^\s=/>{}"]+/.exec(jsx.slice(i))?.[0];
        if (!name) return null;
        fixed(name);
        i += name.length;
        if (jsx[i] !== "=") continue;
        fixed("=");
        i += 1;
        const end = jsx[i] === '"' ? jsx.indexOf('"', i + 1) + 1 : closingBrace(jsx, i);
        if (end <= i || (jsx[i] !== '"' && jsx[i] !== "{")) return null;
        tokens.push({ kind: "value", text: jsx.slice(i, end), name });
        i = end;
      }
      continue;
    }
    if (char === "{") {
      const end = closingBrace(jsx, i);
      if (end === -1) return null;
      tokens.push({ kind: "value", text: jsx.slice(i, end), name: "text", child: true });
      i = end;
      continue;
    }
    let end = i;
    while (end < jsx.length && jsx[end] !== "<" && jsx[end] !== "{") end += 1;
    const run = jsx.slice(i, end);
    const text = run.trim();
    if (text === "") fixed(run);
    else {
      const lead = run.length - run.trimStart().length;
      fixed(run.slice(0, lead));
      tokens.push({ kind: "value", text, name: "text", child: true });
      fixed(run.slice(lead + text.length));
    }
    i = end;
  }
  return tokens;
}

/** What makes two siblings the same list item: their skeleton, and where its values sit. */
const skeletonOf = (tokens: Token[]): string =>
  tokens
    .map((token) => (token.kind === "fixed" ? token.text : `\u0000${token.name}\u0000`))
    .join("");

/** A value as the JavaScript expression a row holds. */
function expression(token: Token): string {
  if (token.text.startsWith("{")) return token.text.slice(1, -1).trim();
  // A quoted attribute holds no character a JS string literal would escape
  // (the emitter moves any that would into braces); plain text is the string.
  return token.child ? JSON.stringify(token.text) : token.text;
}

/**
 * The words every sibling's value starts and ends with. A class list that
 * differs by one utility is the common case: the row should hold that
 * utility, not the whole list again.
 */
function sharedWords(values: string[][]): { lead: number; trail: number } {
  const shortest = Math.min(...values.map((words) => words.length));
  const [first = []] = values;
  let lead = 0;
  while (lead < shortest && values.every((words) => words[lead] === first[lead])) lead += 1;
  let trail = 0;
  while (
    trail < shortest - lead &&
    values.every((words) => words.at(-1 - trail) === first.at(-1 - trail))
  ) {
    trail += 1;
  }
  return { lead, trail };
}

const camel = (name: string): string =>
  name.replace(/[^A-Za-z0-9_$]+([A-Za-z0-9])?/g, (_, next: string | undefined) =>
    next ? next.toUpperCase() : "",
  ) || "value";

function foldRun(run: Token[][], sources: string[], pad: string, indent: string): string | null {
  const first = run[0] as Token[];
  // The positions whose value differs in at least one sibling.
  const holes = first
    .map((token, at) => ({ token, at }))
    .filter(
      ({ token, at }) =>
        token.kind === "value" && run.some((tokens) => tokens[at]?.text !== token.text),
    );
  // A child expression that holds markup of its own (a nested list) would make
  // the rows carry JSX around; leave such siblings written out.
  if (
    holes.some(({ at }) =>
      run.some((tokens) => tokens[at]?.child && /<[A-Za-z/>]/.test(tokens[at]?.text ?? "")),
    )
  ) {
    return null;
  }
  // A quoted attribute whose siblings share leading or trailing words keeps
  // them in the template, around the part that varies.
  const partial = new Map<number, { lead: string; trail: string; rows: string[] }>();
  for (const { token, at } of holes) {
    if (token.child || !token.text.startsWith('"')) continue;
    if (!run.every((tokens) => tokens[at]?.text.startsWith('"'))) continue;
    const words = run.map((tokens) => (tokens[at] as Token).text.slice(1, -1).split(" "));
    const { lead, trail } = sharedWords(words);
    if (lead + trail === 0) continue;
    partial.set(at, {
      lead: (words[0] as string[]).slice(0, lead).join(" "),
      trail: trail > 0 ? (words[0] as string[]).slice(-trail).join(" ") : "",
      rows: words.map((list) => list.slice(lead, list.length - trail).join(" ")),
    });
  }
  const cell = (tokens: Token[], at: number, row: number): string =>
    partial.has(at)
      ? JSON.stringify(partial.get(at)?.rows[row] ?? "")
      : expression(tokens[at] as Token);
  // Two places that hold the same value in every row are one field: a delta's
  // tone on its arrow and on its figure, a row's border on each of its cells.
  const keys = new Map<number, string>();
  const columns = new Map<string, string>();
  const taken = new Map<string, number>();
  const fields: number[] = [];
  for (const { token, at } of holes) {
    const column = JSON.stringify(run.map((tokens, row) => cell(tokens, at, row)));
    const known = columns.get(column);
    if (known !== undefined) {
      keys.set(at, known);
      continue;
    }
    const base = camel(token.name ?? "value");
    const count = (taken.get(base) ?? 0) + 1;
    taken.set(base, count);
    const key = count === 1 ? base : `${base}${count}`;
    columns.set(column, key);
    keys.set(at, key);
    fields.push(at);
  }
  const slot = (at: number): string => {
    const shared = partial.get(at);
    const value = `item.${keys.get(at)}`;
    if (!shared) return `{${value}}`;
    return `{\`${shared.lead}${shared.lead ? " " : ""}\${${value}}${shared.trail ? " " : ""}${shared.trail}\`}`;
  };
  const template = first
    .map((token, at) => (keys.has(at) ? slot(at) : token.text))
    .join("")
    // Every item of a list needs a key; the index is the only one a design has.
    .replace(/^(\s*<[A-Za-z_$][\w$.]*)/, "$1 key={index}")
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
  const folded =
    holes.length === 0
      ? `${pad}{Array.from({ length: ${run.length} }, (_, index) => (\n${template}\n${pad}))}`
      : `${pad}{[\n${run
          .map(
            (tokens, row) =>
              `${pad}${indent}{ ${fields
                .map((at) => `${keys.get(at)}: ${cell(tokens, at, row)}`)
                .join(", ")} },`,
          )
          .join("\n")}\n${pad}].map((item, index) => (\n${template}\n${pad}))}`;
  // Only where it is actually less to read and write.
  const written = sources.reduce((sum, source) => sum + source.length, 0);
  return folded.length < written * 0.85 ? folded : null;
}

/** How many look-alike siblings in a row make a list. */
const MIN_RUN = 3;

/**
 * `parts` — the emitted JSX of one element's children, in order — with each run
 * of look-alike siblings replaced by one `.map` over their values. `pad` is the
 * children's own indentation and `indent` one further level.
 */
export function foldRepeats(parts: string[], pad: string, indent: string): string[] {
  if (parts.length < MIN_RUN) return parts;
  const tokens = parts.map(tokenize);
  const skeletons = tokens.map((list) => (list ? skeletonOf(list) : null));
  const out: string[] = [];
  for (let start = 0; start < parts.length; ) {
    let end = start + 1;
    while (skeletons[start] !== null && end < parts.length && skeletons[end] === skeletons[start]) {
      end += 1;
    }
    const folded =
      end - start >= MIN_RUN
        ? foldRun(tokens.slice(start, end) as Token[][], parts.slice(start, end), pad, indent)
        : null;
    if (folded !== null) out.push(folded);
    else out.push(...parts.slice(start, end));
    start = end;
  }
  return out;
}
