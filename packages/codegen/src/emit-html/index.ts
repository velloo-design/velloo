import type { ComponentRegistry } from "@velloo/provider";
import { renderNativeHtml, resolveSnippetBodyForEdit } from "@velloo/renderer";
import type { Screen, Snippet } from "@velloo/schema";

export interface EmitHtmlOptions {
  /** The screen's channel-resolved registry — the same one the canvas renders with. */
  registry: ComponentRegistry;
  snippets?: Map<string, Snippet> | undefined;
}

/** Native-HTML IR: markup an HTML/htmx app pastes into its own templates. */
export interface EmitHtmlResult {
  screen: { id: string; name: string };
  format: "html";
  /** The screen body as semantic HTML with `hx-*` attributes — no canvas markers. */
  html: string;
  /** Classes the markup relies on; the app's own stylesheets must define them. */
  classesUsed: string[];
  /** Host routes the markup requests (`hx-get`, `hx-post`, …, form `action`) — the app must serve them. */
  hostRoutes: string[];
  warnings: string[];
}

export interface EmitHtmlSnippetResult extends Omit<EmitHtmlResult, "screen"> {
  id: string;
  /** Every param, with its declared default reported rather than baked into `html`. */
  params: { name: string; type: string; default?: string; optional?: true }[];
}

const REQUEST_ATTRIBUTES = [
  "hx-get",
  "hx-post",
  "hx-put",
  "hx-patch",
  "hx-delete",
  "action",
  "formaction",
];

const THEME_VARS_WARNING =
  "Inline styles reference theme variables (var(--…)); run emit_theme to write the stylesheet that defines them, and link it from the app's layout.";

export async function emitHtml(screen: Screen, opts: EmitHtmlOptions): Promise<EmitHtmlResult> {
  const html = await renderNativeHtml(screen, opts.registry, opts.snippets);
  const facts = await markupFacts(html);
  return {
    screen: { id: screen.id, name: screen.name },
    format: "html",
    html,
    ...facts,
    warnings: [
      ...(facts.hostRoutes.length > 0
        ? ["The app must serve every route in hostRoutes; Velloo does not generate handlers."]
        : []),
      ...(html.includes("var(--") ? [THEME_VARS_WARNING] : []),
    ],
  };
}

/**
 * A snippet as a template partial. Every param renders as a visible `$name`
 * marker — defaults are listed in `params`, never baked in — so each place a
 * template variable belongs is findable in the markup.
 */
export async function emitHtmlSnippet(
  snippet: Snippet,
  opts: EmitHtmlOptions,
): Promise<EmitHtmlSnippetResult> {
  const markers = Object.fromEntries(snippet.params.map((param) => [param.name, `$${param.name}`]));
  const tree = resolveSnippetBodyForEdit(snippet.tree, markers, snippet.id);
  const { screen: _screen, ...rest } = await emitHtml(
    { id: snippet.id, name: snippet.name, tree },
    opts,
  );
  const conditional = snippet.params.filter((param) => param.type === "boolean");
  return {
    ...rest,
    id: snippet.id,
    params: snippet.params.map((param) => ({
      name: param.name,
      type: param.type,
      ...(param.default !== undefined ? { default: JSON.stringify(param.default) } : {}),
      ...(param.optional ? { optional: true as const } : {}),
    })),
    warnings: [
      "Replace each $name marker with the app's template variable for that param.",
      ...(conditional.length > 0
        ? [
            `Conditional params (${conditional.map((p) => p.name).join(", ")}) show their true branch; wrap it in the template's own conditional.`,
          ]
        : []),
      ...rest.warnings,
    ],
  };
}

async function markupFacts(html: string): Promise<{ classesUsed: string[]; hostRoutes: string[] }> {
  const classes = new Set<string>();
  const routes = new Set<string>();
  const rewriter = new HTMLRewriter().on("*", {
    element(element) {
      for (const token of (element.getAttribute("class") ?? "").split(/\s+/)) {
        if (token) classes.add(token);
      }
      for (const name of REQUEST_ATTRIBUTES) {
        const value = element.getAttribute(name);
        if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("#")) {
          routes.add(value);
        }
      }
    },
  });
  await rewriter.transform(new Response(html)).text();
  return { classesUsed: [...classes].sort(), hostRoutes: [...routes].sort() };
}
