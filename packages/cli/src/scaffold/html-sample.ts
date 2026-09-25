import type { Board, ComponentNode, Screen, Theme } from "@velloo/schema";
import type { Scaffold } from "./scaffold.ts";

const ink = "#183b37";
const muted = "#63706e";
const panel = "#ffffff";
const line = "#d7dfda";

function html(
  as: string,
  props: Record<string, unknown> = {},
  children: ComponentNode[] = [],
): ComponentNode {
  return { $ref: "Html", props: { as, ...props }, ...(children.length ? { children } : {}) };
}

const text = (as: string, value: string, style: Record<string, unknown> = {}) =>
  html(as, { children: value, ...(Object.keys(style).length ? { style } : {}) });

/** A native HTML starter that renders without a host and demonstrates htmx wiring. */
export function buildHtmlSampleScaffold(theme: Theme): Scaffold {
  const screen: Screen = {
    id: "contacts",
    name: "Contacts · HTML and htmx",
    route: "/contacts",
    tree: html(
      "main",
      {
        style: {
          boxSizing: "border-box",
          minHeight: "100vh",
          padding: "48px 28px",
          background: "#f5f3ed",
          color: ink,
          fontFamily: "system-ui, sans-serif",
        },
      },
      [
        html("div", { style: { maxWidth: 840, margin: "0 auto" } }, [
          html("header", { style: { marginBottom: 28 } }, [
            text("small", "PEOPLE DIRECTORY", { letterSpacing: "0.14em", fontWeight: 700 }),
            text("h1", "Contacts", { fontSize: 44, margin: "10px 0 4px" }),
            text("p", "A native HTML screen. Edit the elements, then emit a server template.", {
              color: muted,
            }),
          ]),
          html(
            "section",
            {
              style: {
                padding: 24,
                background: panel,
                border: `1px solid ${line}`,
                borderRadius: 12,
              },
            },
            [
              text("h2", "Directory", { marginTop: 0 }),
              html(
                "form",
                {
                  "hx-get": "/contacts/search",
                  "hx-target": "#contact-results",
                  "hx-trigger": "submit, keyup changed delay:300ms from:input",
                  style: { display: "flex", gap: 8, marginBottom: 20 },
                },
                [
                  html("input", {
                    name: "q",
                    type: "search",
                    placeholder: "Search contacts",
                    "aria-label": "Search contacts",
                    style: { flex: 1, padding: 12, border: `1px solid ${line}`, borderRadius: 6 },
                  }),
                  html("button", {
                    type: "submit",
                    style: {
                      padding: "10px 20px",
                      border: 0,
                      borderRadius: 6,
                      background: ink,
                      color: panel,
                      cursor: "pointer",
                    },
                    children: "Search",
                  }),
                ],
              ),
              html("ul", { id: "contact-results", style: { lineHeight: 2 } }, [
                text("li", "Alex Rivera"),
                text("li", "Morgan Lee"),
                text("li", "Sam Patel"),
              ]),
              html("details", { style: { marginTop: 24, color: muted } }, [
                text("summary", "Connect a live server route"),
                text(
                  "p",
                  "Set hostApp.previewUrl, then serve /contacts/search with HTML list items. Add an HtmlFragment to mount an existing route directly.",
                ),
              ]),
            ],
          ),
        ]),
      ],
    ),
  };
  const board: Board = {
    id: "main",
    name: "HTML + htmx",
    groups: [],
    frames: [
      { id: "contacts-desktop", screen: screen.id, x: 0, y: 0, w: 1200, h: 850 },
      { id: "contacts-mobile", screen: screen.id, x: 1320, y: 0, w: 390, h: 850 },
    ],
  };
  return { theme, screens: [screen], boards: [board], snippets: [], annotations: [], notes: [] };
}
