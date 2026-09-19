import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const FIXTURE = resolve(import.meta.dir, "../../__tests__/fixtures/repo-custom");
/** A workspace package that depends on React and ReactDOM, to borrow them from. */
const REACT_OWNER = resolve(import.meta.dir, "../../../../renderer");

/**
 * The custom-component fixture as an installed app: copied to a temp dir with
 * `react` and `react-dom` linked into its own `node_modules`, the way a real
 * app has them. The monorepo's isolated linker hoists neither, so bundling
 * straight from the checked-in fixture would find no React to mount with.
 */
export async function fixtureApp(): Promise<{
  root: string;
  folder: string;
  cleanup(): Promise<void>;
}> {
  const tmp = await mkdtemp(join(tmpdir(), "velloo-repo-app-"));
  const root = join(tmp, "app");
  await cp(FIXTURE, root, { recursive: true });
  await mkdir(join(root, "node_modules"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    const manifest = Bun.resolveSync(`${pkg}/package.json`, REACT_OWNER);
    await symlink(dirname(manifest), join(root, "node_modules", pkg), "dir");
  }
  return {
    root,
    folder: join(root, "velloo"),
    cleanup: () => rm(tmp, { recursive: true, force: true }),
  };
}
