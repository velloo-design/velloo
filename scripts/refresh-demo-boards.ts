/** Refresh the runnable framework demos from the exact velloo init scaffold. */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDefaultConfig } from "../packages/cli/src/scaffold/default-config.ts";
import { buildDefaultTheme } from "../packages/cli/src/scaffold/default-theme.ts";
import { buildElsewhereScaffold } from "../packages/cli/src/scaffold/elsewhere-sample.ts";
import { ConfigSchema } from "../packages/schema/src/index.ts";

const root = resolve(import.meta.dir, "..");
const json = async (path: string, value: unknown) => {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};
const manifest = JSON.parse(await readFile(resolve(root, "velloo.json"), "utf8"));
for (const library of ["shadcn-upstream", "mui", "antd", "chakra", "none"] as const) {
  const relative = `demo-boards/${library}`;
  const folder = resolve(root, relative);
  const { createProvider } = await import(`../packages/provider-${library}/src/index.ts`);
  const provider = createProvider();
  const scaffold = buildElsewhereScaffold(library, buildDefaultTheme());
  const configPath = resolve(folder, ".design/config.json");
  const previous = await readFile(configPath, "utf8")
    .then(JSON.parse)
    .catch(() => undefined);
  const config = buildDefaultConfig({
    library: { id: library, version: provider.version, source: "binary", componentsPath: "binary" },
    defaultBoard: "main",
    defaultScreen: "elsewhere-discover",
    hostApp: { root: "../.." },
    ...(library === "none" ? { styling: { framework: "none" as const } } : {}),
  });
  if (previous?.folderId) config.folderId = previous.folderId;
  config.boardOrder = scaffold.boards.map((b) => b.id);
  await json(configPath, ConfigSchema.parse(config));
  for (const group of ["screens", "boards", "snippets"] as const) {
    for (const item of scaffold[group]) await json(resolve(folder, group, `${item.id}.json`), item);
  }
  for (const note of scaffold.notes)
    await json(resolve(folder, "boards", `${note.boardId}.notes.json`), note.entries);
  await json(resolve(folder, "theme/default.json"), scaffold.theme);
  await writeFile(resolve(folder, "theme/custom.css"), scaffold.customCss ?? "");
  await json(resolve(folder, "assets.json"), scaffold.assetMetadata);
  await mkdir(resolve(folder, "assets"), { recursive: true });
  for (const [path, source] of Object.entries(scaffold.assetFiles ?? {}))
    await copyFile(source, resolve(folder, path));
  for (const [path, text] of Object.entries(scaffold.documents ?? {}))
    await writeFile(resolve(folder, path), text);
  await writeFile(resolve(folder, ".gitignore"), ".design/cache/\n.velloo/\n");
  await writeFile(
    resolve(folder, "README.md"),
    `# Elsewhere · ${provider.label}\n\nRun from the repo root with \`velloo run demo-${library}\`.\n\nGenerated from the welcome scaffold with \`bun scripts/refresh-demo-boards.ts\`.\nCanvas edits here are local explorations; refresh overwrites the generated sample files.\n`,
  );
  manifest.projects[`demo-${library}`] = relative;
  console.log(relative);
}
await json(resolve(root, "velloo.json"), manifest);
