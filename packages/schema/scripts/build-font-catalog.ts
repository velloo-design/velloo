/**
 * Generates and checks `src/fonts.ts`.
 *
 * The selection below is editorial — which families are worth offering, and
 * what each one is for. Everything mechanical (category, weight range, whether
 * an italic or optical-size axis exists) is read from Google's own metadata,
 * because a css2 spec that names an axis a family doesn't have comes back 400
 * and the font then silently never loads. Guessing those by hand is how you
 * ship a picker full of families that don't render.
 *
 *   bun run fonts:build   # rewrite src/fonts.ts from the list below
 *   bun run fonts:check   # CI: assert no drift, and that Google still answers
 *
 * `--check` writes nothing. It fails if the committed catalogue isn't what this
 * script would produce (an upstream rename, or a hand-edit of a generated file)
 * and if any spec no longer resolves. Both are failures you cannot see in the
 * product: a dead family renders as its fallback, silently.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What a family is good for. Drives the picker's grouping and role defaults. */
type Role = "body" | "display" | "mono";

interface Curated {
  family: string;
  roles: Role[];
  /** One line, in the voice of someone who would actually pick it. */
  note: string;
}

const CURATED: Curated[] = [
  // ── Sans ────────────────────────────────────────────────────────────────
  {
    family: "Inter",
    roles: ["body"],
    note: "The default for a reason — neutral, huge x-height, drawn for screens.",
  },
  {
    family: "Geist",
    roles: ["body"],
    note: "Tighter and more opinionated than Inter, with a mono twin.",
  },
  {
    family: "Manrope",
    roles: ["body", "display"],
    note: "Semi-rounded geometric; friendly without going soft.",
  },
  {
    family: "DM Sans",
    roles: ["body", "display"],
    note: "Low-contrast geometric that stays clean when set large.",
  },
  {
    family: "Plus Jakarta Sans",
    roles: ["body", "display"],
    note: "Geometric bones, humanist warmth; strong at both ends.",
  },
  {
    family: "Work Sans",
    roles: ["body"],
    note: "Optimised for the middle sizes where most interface text lives.",
  },
  {
    family: "Public Sans",
    roles: ["body"],
    note: "Unopinionated on purpose — a neutral civic workhorse.",
  },
  {
    family: "Figtree",
    roles: ["body", "display"],
    note: "Geometric with a little play in it; holds up small.",
  },
  {
    family: "Outfit",
    roles: ["display", "body"],
    note: "Purely geometric — strongest as a heading face.",
  },
  {
    family: "Sora",
    roles: ["display", "body"],
    note: "Angular and technical; a display sans that isn't generic.",
  },
  { family: "Lexend", roles: ["body"], note: "Wide apertures, tuned for reading proficiency." },
  {
    family: "Rubik",
    roles: ["body", "display"],
    note: "Softened corners; warm and sturdy at any weight.",
  },
  {
    family: "Karla",
    roles: ["body"],
    note: "A grotesque with quirks — good foil for a serif display.",
  },
  {
    family: "Mulish",
    roles: ["body"],
    note: "Minimal and quiet enough to disappear behind the content.",
  },
  {
    family: "Nunito Sans",
    roles: ["body"],
    note: "Rounded terminals; an approachable product voice.",
  },
  {
    family: "Source Sans 3",
    roles: ["body"],
    note: "Adobe's interface workhorse; very legible small.",
  },
  {
    family: "IBM Plex Sans",
    roles: ["body"],
    note: "Engineered and faintly technical; pairs with Plex Mono.",
  },
  {
    family: "Barlow",
    roles: ["body"],
    note: "Slightly condensed grotesque when you need the density.",
  },
  {
    family: "Archivo",
    roles: ["body", "display"],
    note: "Built for high performance; enormous weight range.",
  },
  {
    family: "Epilogue",
    roles: ["display", "body"],
    note: "Real personality once you get into the heavy weights.",
  },
  {
    family: "Onest",
    roles: ["body"],
    note: "Contemporary neutral — a fresher take on the Inter brief.",
  },
  {
    family: "Instrument Sans",
    roles: ["body"],
    note: "Compact grotesque; sharp and very current.",
  },
  {
    family: "Schibsted Grotesk",
    roles: ["body", "display"],
    note: "Editorial grotesque, drawn for a news publisher.",
  },
  {
    family: "Space Grotesk",
    roles: ["display", "body"],
    note: "Techy proportions; the default startup display face.",
  },
  {
    family: "Albert Sans",
    roles: ["body", "display"],
    note: "Geometric revival with an elegant lowercase.",
  },
  {
    family: "Bricolage Grotesque",
    roles: ["display"],
    note: "Deliberately awkward — excellent editorial headers.",
  },
  {
    family: "Hanken Grotesk",
    roles: ["body"],
    note: "Even-toned grotesque that never draws attention.",
  },
  {
    family: "Be Vietnam Pro",
    roles: ["body"],
    note: "Crisp geometric with unusually good diacritics.",
  },
  {
    family: "Red Hat Display",
    roles: ["display", "body"],
    note: "Open and geometric; corporate without being cold.",
  },

  // ── Serif ───────────────────────────────────────────────────────────────
  {
    family: "Source Serif 4",
    roles: ["body"],
    note: "Screen-first serif; comfortable over long measures.",
  },
  { family: "Lora", roles: ["body"], note: "Brushed curves — the safe editorial body serif." },
  {
    family: "Crimson Pro",
    roles: ["body"],
    note: "Old-style and book-like; low contrast survives screens.",
  },
  {
    family: "Newsreader",
    roles: ["body", "display"],
    note: "Made for news, so it works as body and as headline.",
  },
  {
    family: "Literata",
    roles: ["body"],
    note: "Google's ebook serif; sturdy down to small sizes.",
  },
  {
    family: "Spectral",
    roles: ["body"],
    note: "Screen-native serif with generous built-in spacing.",
  },
  {
    family: "EB Garamond",
    roles: ["body"],
    note: "Classic Garamond — give it size and leading to breathe.",
  },
  {
    family: "Libre Baskerville",
    roles: ["body"],
    note: "High contrast; set it larger than you think.",
  },
  {
    family: "Bitter",
    roles: ["body"],
    note: "Contemporary slab that stays strong at small sizes.",
  },
  {
    family: "Merriweather",
    roles: ["body"],
    note: "Dense and dark; built to be legible on screens.",
  },
  {
    family: "Petrona",
    roles: ["body", "display"],
    note: "Quirky text serif with a surprisingly wide range.",
  },
  {
    family: "Faustina",
    roles: ["body"],
    note: "Compact serif that packs a lot of words per line.",
  },
  {
    family: "Frank Ruhl Libre",
    roles: ["body", "display"],
    note: "Hebrew-rooted serif with striking heavy weights.",
  },
  { family: "Vollkorn", roles: ["body"], note: "Warm and slightly rough — good for long-form." },
  { family: "Zilla Slab", roles: ["body", "display"], note: "Mozilla's slab: technical but warm." },
  {
    family: "Roboto Slab",
    roles: ["body", "display"],
    note: "Neutral slab; the least surprising choice.",
  },
  { family: "Alegreya", roles: ["body"], note: "Calligraphic origins, designed for literature." },
  {
    family: "Instrument Serif",
    roles: ["display"],
    note: "High-contrast display serif; everywhere right now.",
  },

  // ── Display ─────────────────────────────────────────────────────────────
  {
    family: "Fraunces",
    roles: ["display"],
    note: "Wonky and optical-size aware; enormous personality.",
  },
  {
    family: "Playfair Display",
    roles: ["display"],
    note: "High-contrast Didone — the classic luxury headline.",
  },
  {
    family: "DM Serif Display",
    roles: ["display"],
    note: "Sharp Didone; the free Playfair alternative.",
  },
  {
    family: "Bodoni Moda",
    roles: ["display"],
    note: "True Didone with optical sizes; fashion-editorial.",
  },
  {
    family: "Abril Fatface",
    roles: ["display"],
    note: "Heavy Didone built for one-word headlines.",
  },
  {
    family: "Unbounded",
    roles: ["display"],
    note: "Geometric and loud; unmistakably brand-forward.",
  },
  { family: "Syne", roles: ["display"], note: "Deliberately odd widths — art-gallery energy." },
  { family: "Anton", roles: ["display"], note: "Ultra-condensed poster weight, and only that." },
  {
    family: "Bebas Neue",
    roles: ["display"],
    note: "All-caps condensed; posters and scoreboards.",
  },
  {
    family: "Archivo Black",
    roles: ["display"],
    note: "One very heavy weight that fills the line.",
  },
  {
    family: "Big Shoulders",
    roles: ["display"],
    note: "Tall condensed; wayfinding and data-dense headers.",
  },
  {
    family: "Cormorant Garamond",
    roles: ["display"],
    note: "Delicate high contrast — set it big or lose it.",
  },
  {
    family: "Marcellus",
    roles: ["display"],
    note: "Roman inscriptional capitals; quietly expensive.",
  },
  { family: "Prata", roles: ["display"], note: "Didone with a single weight and a lot of poise." },
  { family: "Gloock", roles: ["display"], note: "Fat high-contrast serif; editorial and current." },
  {
    family: "Yeseva One",
    roles: ["display"],
    note: "Curvy and decorative; strong at very large sizes.",
  },
  {
    family: "Chivo",
    roles: ["display", "body"],
    note: "Grotesque with heavy weights made for headlines.",
  },
  { family: "Darker Grotesque", roles: ["display"], note: "Tall, tight and slightly strange." },
  {
    family: "Familjen Grotesk",
    roles: ["display", "body"],
    note: "Swedish grotesque with a distinctive g.",
  },
  { family: "Caveat", roles: ["display"], note: "Handwritten — annotations and margin notes." },

  // ── Mono ────────────────────────────────────────────────────────────────
  {
    family: "JetBrains Mono",
    roles: ["mono"],
    note: "Tall x-height, drawn for code; the safe default.",
  },
  {
    family: "IBM Plex Mono",
    roles: ["mono"],
    note: "Pairs exactly with Plex Sans and Plex Serif.",
  },
  {
    family: "Space Mono",
    roles: ["mono", "display"],
    note: "Retro-technical and quirky; works as display mono.",
  },
  { family: "Fira Code", roles: ["mono"], note: "Programming ligatures, if you want them." },
  { family: "Source Code Pro", roles: ["mono"], note: "Adobe's code face; wide and unambiguous." },
  { family: "Roboto Mono", roles: ["mono"], note: "The neutral default nobody objects to." },
  { family: "DM Mono", roles: ["mono"], note: "Low contrast and geometric; unusually pretty." },
  { family: "Geist Mono", roles: ["mono"], note: "Geist's twin — use them together." },
  {
    family: "Martian Mono",
    roles: ["mono", "display"],
    note: "Wide and semi-condensed; a mono with presence.",
  },
  {
    family: "Azeret Mono",
    roles: ["mono"],
    note: "Boxy and deliberate; good for figures and tables.",
  },
  { family: "Red Hat Mono", roles: ["mono"], note: "Humanist mono that reads like prose." },
  { family: "Inconsolata", roles: ["mono"], note: "Narrow and efficient; fits more columns." },
];

// ── Google metadata ───────────────────────────────────────────────────────

interface Axis {
  tag: string;
  min: number;
  max: number;
}
interface FamilyMeta {
  family: string;
  category: string;
  stroke: string | null;
  axes: Axis[];
  fonts: Record<string, unknown>;
}

const METADATA_URL = "https://fonts.google.com/metadata/fonts";

async function fetchMetadata(): Promise<Map<string, FamilyMeta>> {
  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`metadata: ${res.status}`);
  // The endpoint prefixes its JSON with an anti-hijacking guard.
  const parsed = JSON.parse((await res.text()).replace(/^\)\]\}'\n?/, "")) as {
    familyMetadataList: FamilyMeta[];
  };
  return new Map(parsed.familyMetadataList.map((f) => [f.family, f]));
}

/** Category as the picker groups them, from Google's own classification. */
function categoryOf(meta: FamilyMeta): string {
  switch (meta.category) {
    case "Sans Serif":
      return "sans";
    case "Serif":
      return "serif";
    case "Monospace":
      return "mono";
    case "Handwriting":
      return "handwriting";
    default:
      return "display";
  }
}

/**
 * The stack tail. A webfont that fails to load should degrade to something of
 * the same shape, so this follows the family's own skeleton rather than the
 * role it was assigned to.
 */
function fallbackOf(meta: FamilyMeta): string {
  if (meta.category === "Monospace") return "ui-monospace, SFMono-Regular, monospace";
  if (meta.category === "Handwriting") return "ui-rounded, cursive";
  const serifish = meta.category === "Serif" || meta.stroke === "Serif";
  return serifish ? "ui-serif, Georgia, serif" : "ui-sans-serif, system-ui, sans-serif";
}

/** Static families ship one file per weight, so only ask for the useful ones. */
const STATIC_WEIGHTS = [400, 500, 600, 700];

/**
 * Build the css2 axis spec — the part after `family=<name>:`.
 *
 * Variable families get their full `wght` range: it is one file whatever range
 * you ask for, so narrowing it only loses weights. `opsz` rides along when the
 * family has it, since that is what makes a display serif look right large.
 * Italics are text-face only — they double the download, and nobody sets a
 * headline or a code block in italic.
 */
function axisSpec(meta: FamilyMeta, roles: Role[]): string | true {
  const wght = meta.axes.find((a) => a.tag === "wght");
  const opsz = meta.axes.find((a) => a.tag === "opsz");
  const wantItalic = roles.includes("body") && Object.keys(meta.fonts).some((k) => k.endsWith("i"));

  if (!wght) {
    // Not variable on weight: enumerate the static weights that exist.
    const weights = Object.keys(meta.fonts)
      .filter((k) => /^\d+$/.test(k))
      .map(Number)
      .filter((w) => STATIC_WEIGHTS.includes(w))
      .sort((a, b) => a - b);
    if (weights.length === 0) return true;
    return `wght@${weights.join(";")}`;
  }

  const range = `${wght.min}..${wght.max}`;
  const opszRange = opsz ? `${opsz.min}..${opsz.max}` : null;

  // css2 wants the axis tags sorted, and the value tuples in the same order.
  const tags = [...(wantItalic ? ["ital"] : []), ...(opszRange ? ["opsz"] : []), "wght"];
  const body = opszRange ? `${opszRange},${range}` : range;
  const values = wantItalic ? `0,${body};1,${body}` : body;
  return `${tags.join(",")}@${values}`;
}

function css2Url(family: string, spec: string | true): string {
  const param = family.replace(/ /g, "+");
  const value = spec === true ? param : `${param}:${spec}`;
  return `https://fonts.googleapis.com/css2?family=${value}&display=swap`;
}

// ── Emit ──────────────────────────────────────────────────────────────────

const HEADER = `// Generated by scripts/build-font-catalog.ts — do not edit by hand.
//
// The selection is editorial; the axis specs are read from Google's font
// metadata, so every entry here is one the css2 API actually answers.

/** What a family is good for — drives grouping and the default role name. */
export type FontRole = "body" | "display" | "mono";

/** How the picker groups families. Google's own classification. */
export type FontCategory = "sans" | "serif" | "display" | "mono" | "handwriting";

export interface CatalogFont {
  /** Family name, spelled as Google Fonts spells it. */
  family: string;
  category: FontCategory;
  /**
   * The css2 axis spec — the part after \`family=<name>:\` — or \`true\` for a
   * family with nothing worth asking for beyond its single weight. Exactly the
   * shape \`set_fonts\` takes as its \`google\` argument.
   */
  google: string | true;
  /** CSS stack tail, following the family's skeleton rather than its role. */
  fallback: string;
  roles: FontRole[];
  note: string;
}
`;

const FOOTER = `
/** Families offered for a role, best fit first. */
export function fontsForRole(role: FontRole): CatalogFont[] {
  return FONT_CATALOG.filter((f) => f.roles.includes(role)).sort(
    (a, b) => a.roles.indexOf(role) - b.roles.indexOf(role),
  );
}

/** Look up a curated family by name. */
export function catalogFont(family: string): CatalogFont | undefined {
  return FONT_CATALOG.find((f) => f.family === family);
}

/** The CSS stack \`set_fonts\` would write for this family. */
export function fontStack(font: CatalogFont): string {
  return \`"\${font.family}", \${font.fallback}\`;
}

/**
 * A css2 URL for one family. \`text\` asks Google for just the glyphs in that
 * string, which is how the picker previews eighty families without pulling
 * eighty full fonts.
 */
export function googleFontUrl(spec: string | true, family: string, text?: string): string {
  const param = family.replace(/ /g, "+");
  const value = spec === true ? param : \`\${param}:\${spec}\`;
  const suffix = text ? \`&text=\${encodeURIComponent(text)}\` : "";
  return \`https://fonts.googleapis.com/css2?family=\${value}\${suffix}&display=swap\`;
}
`;

const check = process.argv.includes("--check");
const meta = await fetchMetadata();
const missing: string[] = [];
const entries: string[] = [];

for (const item of CURATED) {
  const m = meta.get(item.family);
  if (!m) {
    missing.push(item.family);
    continue;
  }
  const spec = axisSpec(m, item.roles);
  entries.push(
    [
      "  {",
      `    family: ${JSON.stringify(item.family)},`,
      `    category: ${JSON.stringify(categoryOf(m))},`,
      `    google: ${spec === true ? "true" : JSON.stringify(spec)},`,
      `    fallback: ${JSON.stringify(fallbackOf(m))},`,
      `    roles: [${item.roles.map((r) => JSON.stringify(r)).join(", ")}],`,
      `    note: ${JSON.stringify(item.note)},`,
      "  },",
    ].join("\n"),
  );
}

const out = `${HEADER}
export const FONT_CATALOG: CatalogFont[] = [
${entries.join("\n")}
];
${FOOTER}`;

const target = join(import.meta.dir, "..", "src", "fonts.ts");
let failed = false;

// A curated family that has been renamed or withdrawn upstream is a silent
// hole in the picker, so it fails the check rather than just warning.
if (missing.length > 0) {
  console.error(`Not in Google's catalogue: ${missing.join(", ")}`);
  if (check) failed = true;
}

if (check) {
  const onDisk = await readFile(target, "utf8").catch(() => "");
  if (onDisk === out) {
    console.error(`Catalogue matches the generator (${entries.length} families).`);
  } else {
    console.error("Catalogue is stale — run `bun run fonts:build` and commit the result.");
    failed = true;
  }
} else {
  await writeFile(target, out, "utf8");
  console.error(`Wrote ${entries.length} families to ${target}`);
}

/** One retry, because a flaky CDN read shouldn't read as a bad axis spec. */
async function loads(url: string): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 Chrome/120" } });
      if (res.ok) return 200;
      if (attempt === 1) return res.status;
    } catch {
      if (attempt === 1) return 0;
    }
  }
  return 0;
}

let rejected = 0;
for (const item of CURATED) {
  const m = meta.get(item.family);
  if (!m) continue;
  const url = css2Url(item.family, axisSpec(m, item.roles));
  const status = await loads(url);
  if (status !== 200) {
    rejected++;
    console.error(`  ${status || "network"}  ${item.family}  ${url}`);
  }
}
console.error(rejected === 0 ? "Every spec loads." : `${rejected} spec(s) rejected by Google.`);
if (rejected > 0) failed = true;

if (failed) process.exit(1);
