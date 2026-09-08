import { confirm, isCancel } from "@clack/prompts";
import type { Screen } from "@velloo/schema";
import {
  failureLines,
  failureSummary,
  type PreflightSource,
  preflightScreens,
} from "@velloo/server";
import pc from "picocolors";
import { fail } from "./fail.ts";

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

  console.error(
    `${pc.yellow(`velloo ${command}:`)} ${failureSummary(failures)} failed to render, and will appear as placeholders:`,
  );
  for (const line of failureLines(failures)) console.error(`  ${pc.dim(line)}`);

  if (yes) return;
  if (!process.stdin.isTTY) {
    fail(command, "refusing to continue — re-run with --yes to accept the placeholders.");
  }
  const go = await confirm({ message: "Continue anyway?", initialValue: false });
  if (isCancel(go) || !go) fail(command, "cancelled.");
}
