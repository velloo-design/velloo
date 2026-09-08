/**
 * The document a frame shows when its screen could not be rendered at all.
 *
 * The render guard contains a component that throws by standing in for it, so
 * most failures still produce a screen. What is left over are the ones it
 * cannot contain — a throw it could not attribute to any single component, or
 * more distinct failures than it will stand in for — and those take the whole
 * render down. The frame used to go blank, which looks exactly like a screen
 * that renders nothing, so the one case that most needs explaining was the one
 * case that said least.
 *
 * Deliberately self-contained: no Tailwind, no theme CSS, no fonts, no script.
 * Whatever went wrong upstream, this document has to be renderable.
 */

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  amber: string;
  code: string;
}

const DARK: Palette = {
  bg: "#0D0C0A",
  fg: "#F3EEE3",
  muted: "#9A9488",
  border: "#2A2823",
  accent: "#FF6F4D",
  amber: "#FFAB1F",
  code: "#17150F",
};

const LIGHT: Palette = {
  bg: "#FBFAF7",
  fg: "#1A1815",
  muted: "#6B6558",
  border: "#E4E0D6",
  accent: "#D8502C",
  amber: "#B8790A",
  code: "#F2EFE8",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RenderErrorPage {
  /** Headline: what happened, in the reader's terms. */
  title: string;
  /** One sentence on why, and what it means for the rest of the folder. */
  lede: string;
  /** The underlying message, shown verbatim — it usually names the fix. */
  detail: string;
  /** What the reader should do about it. */
  hint: string;
  screenName: string;
  dark: boolean;
}

/**
 * Sibling of velloo-cloud's missing-link page: the same rounded-square motif
 * and drifting sparks, with the loose piece dashed — a part that did not make
 * it into the frame.
 */
export function renderErrorDocument(page: RenderErrorPage): string {
  const c = page.dark ? DARK : LIGHT;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)} · ${escapeHtml(page.screenName)}</title>
<style>
  :root{color-scheme:${page.dark ? "dark" : "light"}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:${c.bg};color:${c.fg};
    font:400 15px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}
  main{width:min(460px,calc(100vw - 48px));text-align:center;padding:32px 0}
  .art{display:block;margin:0 auto 26px;width:min(180px,52vw);height:auto;overflow:visible}
  .drift{animation:drift 5s ease-in-out infinite}
  .spark{animation:twinkle 5s ease-in-out infinite}
  .spark.mid{animation-delay:.18s}
  .spark.late{animation-delay:.36s}
  @keyframes drift{0%,100%{transform:translate(0,0)}50%{transform:translate(-7px,-6px)}}
  @keyframes twinkle{0%,100%{opacity:.15}50%{opacity:.8}}
  @media (prefers-reduced-motion:reduce){.drift,.spark{animation:none}}
  h1{font:600 21px/1.3 ui-sans-serif,system-ui,sans-serif;margin:0 0 10px;letter-spacing:-.01em}
  p.lede{margin:0 0 20px;color:${c.muted}}
  pre{margin:0 0 18px;padding:12px 14px;border:1px solid ${c.border};border-radius:8px;
    background:${c.code};color:${c.fg};text-align:left;white-space:pre-wrap;word-break:break-word;
    font:400 12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
  p.hint{margin:0;color:${c.muted};font-size:13px}
  .screen{display:inline-block;margin-bottom:18px;padding:3px 9px;border:1px solid ${c.border};
    border-radius:999px;color:${c.muted};
    font:500 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
</style></head>
<body><main>
<svg class="art" viewBox="0 0 200 132" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="118" y="24" width="58" height="58" rx="20" stroke="${c.amber}" stroke-width="11" stroke-linejoin="round"/>
  <circle class="spark" cx="102" cy="54" r="1.8" fill="${c.accent}"/>
  <circle class="spark mid" cx="90" cy="66" r="2.5" fill="${c.accent}"/>
  <circle class="spark late" cx="77" cy="78" r="3.2" fill="${c.accent}"/>
  <g class="drift">
    <path d="M44 22 L44 29 A15 15 0 0 1 29 44 L15 44 A15 15 0 0 1 0 29 L0 15 A15 15 0 0 1 15 0 L26 0"
      stroke="${c.accent}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round" transform="rotate(-22 44 86) translate(22 64)"/>
  </g>
</svg>
<h1>${escapeHtml(page.title)}</h1>
<div class="screen">${escapeHtml(page.screenName)}</div>
<p class="lede">${escapeHtml(page.lede)}</p>
<pre>${escapeHtml(page.detail)}</pre>
<p class="hint">${escapeHtml(page.hint)}</p>
</main></body></html>`;
}
