import { stripVTControlCharacters } from "node:util";
import { isCancel, select } from "@clack/prompts";
import type { Screen } from "@velloo/schema";
import { type PreflightSource, preflightScreens, type ScreenRenderFailure } from "@velloo/server";
import pc from "picocolors";
import { copyToClipboard } from "./clipboard.ts";
import { fail } from "./fail.ts";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The report, grouped by screen under the boards that place it, so each line
 * says where to go as well as what broke. A screen that failed outright is
 * called out apart from its components: those don't ship as placeholders, the
 * whole screen goes missing.
 */
export function formatFailures(command: string, failures: ScreenRenderFailure[]): string[] {
  const byScreen = new Map<string, ScreenRenderFailure[]>();
  for (const failure of failures) {
    byScreen.set(failure.screenId, [...(byScreen.get(failure.screenId) ?? []), failure]);
  }
  const notDrawn = [...byScreen.values()].filter((group) =>
    group.some((failure) => failure.componentId === null),
  );
  const placeholders = [...byScreen.values()]
    .filter((group) => !notDrawn.includes(group))
    .reduce((sum, group) => sum + group.length, 0);

  const consequences = [
    placeholders > 0 && `${plural(placeholders, "component")} will appear as placeholders`,
    notDrawn.length > 0 && `${plural(notDrawn.length, "screen")} will not render at all`,
  ].filter(Boolean);
  const lines = [
    `${pc.yellow(`velloo ${command}:`)} render failures on ${plural(byScreen.size, "screen")} — ${consequences.join(", and ")}:`,
  ];

  for (const group of byScreen.values()) {
    const [first] = group;
    if (!first) continue;
    const boards =
      first.boards.length > 0 ? first.boards.map((board) => board.name).join(", ") : "no board";
    lines.push(
      "",
      `  ${pc.dim(`${boards} ›`)} ${pc.bold(first.screenName)} ${pc.dim(`(${first.screenId})`)}`,
    );
    const pinned = group.some((failure) => failure.componentId !== null);
    for (const failure of group) {
      if (failure.componentId !== null) {
        lines.push(`    ${pc.cyan(failure.componentId)}: ${failure.reason}`);
      } else {
        const label = pinned
          ? "screen not drawn"
          : "screen not drawn — the error could not be pinned on one component";
        lines.push(`    ${pc.red(label)}: ${failure.reason}`);
      }
    }
  }
  return lines;
}

/**
 * Stop before turning a screen with a broken component into a file someone
 * else opens.
 *
 * The render guard means a component that throws no longer fails the render,
 * so without this an export or a publish quietly succeeds and the placeholder
 * ships. In a terminal that is a question. Without one it is a refusal: a
 * share link or a PDF is read by someone who cannot tell a placeholder from a
 * design, and a pipeline that has decided otherwise has `--yes`.
 */
export async function confirmRenderFailures(
  command: string,
  source: PreflightSource,
  screens: Iterable<Screen>,
  yes: boolean,
): Promise<void> {
  const failures = preflightScreens(source, screens);
  if (failures.length === 0) return;

  const report = formatFailures(command, failures);
  for (const line of report) console.error(line);
  console.error("");

  if (yes) return;
  if (!process.stdin.isTTY) {
    fail(command, "refusing to continue — re-run with --yes to accept the placeholders.");
  }
  // Copying is a detour, not an answer: ask again until the user decides.
  for (;;) {
    const choice = await select({
      message: "Continue anyway?",
      options: [
        { value: "cancel", label: "No, cancel" },
        { value: "continue", label: "Yes, continue with the failures" },
        { value: "copy", label: "Copy errors to clipboard" },
      ],
      initialValue: "cancel",
    });
    if (isCancel(choice) || choice === "cancel") fail(command, "cancelled.");
    if (choice === "continue") return;
    const copied = await copyToClipboard(stripVTControlCharacters(report.join("\n")));
    console.error(
      copied
        ? `  ${pc.green("✓")} Errors copied to the clipboard.`
        : pc.dim("  Couldn't reach a clipboard tool — copy the errors printed above."),
    );
  }
}
