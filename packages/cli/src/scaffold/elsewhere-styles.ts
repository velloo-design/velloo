/** The welcome design's utility vocabulary, translated to framework-native CSS.
 * Deliberately scoped to this sample, not a general Tailwind transpiler. Unknown
 * utilities fail loudly so an updated canonical design cannot silently lose style.
 */
export type Style = { [key: string]: string | number | Style };
const token = (name: string) => `var(--color-${name})`;
const sizes: Record<string, string> = {
  xs: "12px",
  sm: "14px",
  base: "16px",
  lg: "18px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "30px",
  "4xl": "36px",
  "5xl": "48px",
};
const fixed: Record<string, Style> = {
  flex: { display: "flex" },
  grid: { display: "grid" },
  hidden: { display: "none" },
  "inline-flex": { display: "inline-flex" },
  relative: { position: "relative" },
  absolute: { position: "absolute" },
  "inset-0": { inset: "0px" },
  "flex-col": { flexDirection: "column" },
  "flex-wrap": { flexWrap: "wrap" },
  "flex-1": { flex: "1 1 0%" },
  "shrink-0": { flexShrink: 0 },
  "items-center": { alignItems: "center" },
  "items-start": { alignItems: "flex-start" },
  "items-end": { alignItems: "flex-end" },
  "items-baseline": { alignItems: "baseline" },
  "justify-between": { justifyContent: "space-between" },
  "justify-center": { justifyContent: "center" },
  "justify-start": { justifyContent: "flex-start" },
  "self-center": { alignSelf: "center" },
  "self-start": { alignSelf: "flex-start" },
  "overflow-hidden": { overflow: "hidden" },
  "min-h-screen": { minHeight: "100vh" },
  "min-w-0": { minWidth: "0px" },
  "font-display": { fontFamily: "var(--font-display, Georgia, serif)" },
  "font-sans": { fontFamily: "var(--font-sans, sans-serif)" },
  "font-normal": { fontWeight: 400 },
  "font-semibold": { fontWeight: 600 },
  uppercase: { textTransform: "uppercase" },
  "text-center": { textAlign: "center" },
  "text-inherit": { color: "inherit" },
  "whitespace-pre-line": { whiteSpace: "pre-line" },
  "resize-none": { resize: "none" },
  "bg-transparent": { backgroundColor: "transparent" },
  "rounded-lg": { borderRadius: "8px" },
  "rounded-xl": { borderRadius: "12px" },
  "rounded-2xl": { borderRadius: "16px" },
  "rounded-full": { borderRadius: "9999px" },
  "shadow-none": { boxShadow: "none" },
  "shadow-sm": { boxShadow: "0 1px 3px #00000012" },
  "shadow-lg": { boxShadow: "0 10px 20px #00000018" },
  border: { borderWidth: "1px", borderStyle: "solid" },
  "border-0": { borderWidth: "0px" },
  "border-2": { borderWidth: "2px", borderStyle: "solid" },
  "border-dashed": { borderStyle: "dashed" },
  "border-b": { borderBottom: "1px solid var(--color-border)" },
  "border-t": { borderTop: "1px solid var(--color-border)" },
  "border-l": { borderLeft: "1px solid var(--color-border)" },
  "border-r": { borderRight: "1px solid var(--color-border)" },
  "divide-y": { "& > * + *": { borderTop: "1px solid var(--color-border)" } },
  "divide-border": {},
  "ring-2": { outline: "2px solid var(--color-primary)" },
  "ring-primary": {},
  "tracking-wider": { letterSpacing: ".05em" },
  "tracking-widest": { letterSpacing: ".1em" },
  "ew-photo-shade": {
    background: "linear-gradient(90deg,rgba(8,24,19,.65),rgba(8,24,19,.05) 90%)",
  },
  "ew-route-map": {},
};
function value(raw: string): string {
  if (raw.startsWith("[")) return raw.slice(1, -1).replaceAll("_", " ");
  if (raw === "full") return "100%";
  if (raw === "auto") return "auto";
  return `${Number(raw) * 4}px`;
}
function utility(c: string): Style {
  if (fixed[c]) return fixed[c];
  let m = c.match(
    /^(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|w|h|min-h|max-w|size|top|left|right|bottom)-(.+)$/,
  );
  if (c === "-space-x-2") return { "& > * + *": { marginLeft: "-8px" } };
  if (c.startsWith("-")) {
    const s = utility(c.slice(1));
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, `-${v}`]));
  }
  if (m) {
    const [, k = "", r = ""] = m;
    const v =
      k === "max-w" && r === "xl" ? "576px" : k === "max-w" && r === "2xl" ? "672px" : value(r);
    const keys: Record<string, string[]> = {
      p: ["padding"],
      px: ["paddingLeft", "paddingRight"],
      py: ["paddingTop", "paddingBottom"],
      pt: ["paddingTop"],
      pb: ["paddingBottom"],
      pl: ["paddingLeft"],
      pr: ["paddingRight"],
      m: ["margin"],
      mx: ["marginLeft", "marginRight"],
      my: ["marginTop", "marginBottom"],
      mt: ["marginTop"],
      mb: ["marginBottom"],
      ml: ["marginLeft"],
      mr: ["marginRight"],
      gap: ["gap"],
      w: ["width"],
      h: ["height"],
      "min-h": ["minHeight"],
      "max-w": ["maxWidth"],
      size: ["width", "height"],
      top: ["top"],
      left: ["left"],
      right: ["right"],
      bottom: ["bottom"],
    };
    return Object.fromEntries((keys[k] ?? []).map((key) => [key, v]));
  }
  m = c.match(/^space-y-(\d+)$/);
  if (m) return { "& > * + *": { marginTop: value(m[1] ?? "") } };
  m = c.match(/^grid-(cols|rows)-(.+)$/);
  if (m)
    return {
      [m[1] === "cols" ? "gridTemplateColumns" : "gridTemplateRows"]: m[2]?.startsWith("[")
        ? value(m[2] ?? "")
        : `repeat(${m[2]}, minmax(0, 1fr))`,
    };
  m = c.match(/^text-(.+)$/);
  if (m) {
    const r = m[1] ?? "";
    if (sizes[r] || r.startsWith("[")) return { fontSize: sizes[r] ?? value(r) };
    return { color: color(r) };
  }
  m = c.match(/^(bg|border)-(.+)$/);
  if (m) return { [m[1] === "bg" ? "backgroundColor" : "borderColor"]: color(m[2] ?? "") };
  m = c.match(/^leading-(.+)$/);
  if (m) return { lineHeight: value(m[1] ?? "") };
  m = c.match(/^tracking-(.+)$/);
  if (m) return { letterSpacing: value(m[1] ?? "") };
  m = c.match(/^z-(\d+)$/);
  if (m) return { zIndex: Number(m[1]) };
  throw new Error(`Elsewhere: unsupported sample utility ${c}`);
}
function color(s: string): string {
  const [name, alpha] = s.split("/");
  const base = name === "white" ? "#fff" : token(name ?? "");
  return alpha ? `color-mix(in srgb, ${base} ${alpha}%, transparent)` : base;
}
export function sampleStyle(className: string): Style {
  const result: Style = {};
  for (const cls of className.split(/\s+/).filter(Boolean)) {
    const responsive = cls.startsWith("md:");
    if (responsive) result["@media (min-width: 768px)"] ??= {};
    const target = responsive ? (result["@media (min-width: 768px)"] as Style) : result;
    const next = utility(responsive ? cls.slice(3) : cls);
    for (const [k, v] of Object.entries(next))
      target[k] = typeof v === "object" ? { ...((target[k] as Style) ?? {}), ...v } : v;
  }
  return result;
}
