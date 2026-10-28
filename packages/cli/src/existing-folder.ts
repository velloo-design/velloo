import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readConfig(folder: string): Promise<Record<string, unknown>> {
  const raw: unknown = JSON.parse(await readFile(join(folder, ".design", "config.json"), "utf8"));
  return (raw ?? {}) as Record<string, unknown>;
}

/**
 * What a *second* design folder in the same repo should inherit from the
 * first: the app hasn't changed between them, so re-asking which component
 * library it uses (and where its components live) invites two folders that
 * disagree about the same app.
 */
export async function inheritedFromFolder(
  folder: string,
): Promise<{ library: string | undefined; componentsDir: string | undefined }> {
  try {
    const config = await readConfig(folder);
    const libraries = (config.libraries ?? {}) as Record<string, { id?: string | undefined }>;
    const defaultLibrary = typeof config.defaultLibrary === "string" ? config.defaultLibrary : "";
    const codegen = (config.codegen ?? {}) as { componentsDir?: string | undefined };
    return {
      library: libraries[defaultLibrary]?.id ?? Object.values(libraries)[0]?.id,
      componentsDir: codegen.componentsDir,
    };
  } catch {
    return { library: undefined, componentsDir: undefined };
  }
}
