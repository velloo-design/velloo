import { relative } from "node:path";
import { log, select } from "@clack/prompts";
import { importThemeFromDesignMd } from "../scaffold/import-design-md.ts";
import type { DetectedHost } from "./answers.ts";
import { isAborted, subtitled } from "./prompt-kit.ts";

/**
 * Offer a DESIGN.md the scan found as the theme source, ahead of the
 * stylesheet. The question names the system and how many color roles it
 * reaches, because a file written in neither velloo's nor Material 3's
 * vocabulary maps poorly — then the stylesheet is the recommended answer,
 * said now rather than discovered on the canvas. Undefined when there is
 * nothing to ask, null on cancel.
 */
export async function promptDesignMd(
  detected: DetectedHost | undefined,
  appRoot: string,
  themePreset: string | undefined,
): Promise<boolean | undefined | null> {
  const path = detected?.designMdPath;
  if (!path) return undefined;
  const shown = relative(appRoot, path) || path;
  const stylesheet = detected.globalsCssPath;
  const imported = importThemeFromDesignMd(path, themePreset);
  if (!imported) {
    log.info(
      `${shown} names no color roles Velloo can map, so the theme comes from ${stylesheet ? "your stylesheet" : "a preset"}. Your design agents still follow its prose.`,
    );
    return undefined;
  }
  const { semantic, semanticTotal } = imported.coverage;
  const weak = semantic < semanticTotal / 2;
  const picked = await select<boolean>({
    message: subtitled(
      `Theme your design from the "${imported.designSystem}" design system?`,
      `${shown} names ${semantic} of the ${semanticTotal} color roles Velloo themes with; the rest keep the preset's colors.`,
    ),
    options: [
      {
        value: true,
        label: `Use ${shown}`,
        hint: `${semantic}/${semanticTotal} color roles`,
      },
      {
        value: false,
        label: stylesheet
          ? `Use your stylesheet (${relative(appRoot, stylesheet)})`
          : "Use a preset",
        hint:
          weak && stylesheet
            ? "recommended — the DESIGN.md maps few roles"
            : "agents still follow the DESIGN.md's prose",
      },
    ],
    initialValue: !(weak && stylesheet),
  });
  return isAborted(picked) ? null : picked;
}
