export const BUN_VERSION = "1.4.2";

export interface RuntimeTarget {
  id: string;
  packageName: string;
  os: "darwin" | "linux" | "win32";
  cpu: "arm64" | "x64";
  libc?: "glibc" | "musl";
}

/**
 * Exact official Bun 1.4.2 npm packages. x64 uses the baseline builds so
 * Velloo also works on CPUs without AVX2.
 */
export const RUNTIME_TARGETS: readonly RuntimeTarget[] = [
  {
    id: "darwin-arm64",
    packageName: "@oven/bun-darwin-aarch64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    id: "darwin-x64",
    packageName: "@oven/bun-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    id: "linux-arm64",
    packageName: "@oven/bun-linux-aarch64",
    os: "linux",
    cpu: "arm64",
    libc: "glibc",
  },
  {
    id: "linux-arm64-musl",
    packageName: "@oven/bun-linux-aarch64-musl",
    os: "linux",
    cpu: "arm64",
    libc: "musl",
  },
  {
    id: "linux-x64",
    packageName: "@oven/bun-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
  },
  {
    id: "linux-x64-musl",
    packageName: "@oven/bun-linux-x64-musl-baseline",
    os: "linux",
    cpu: "x64",
    libc: "musl",
  },
  {
    id: "win32-arm64",
    packageName: "@oven/bun-windows-aarch64",
    os: "win32",
    cpu: "arm64",
  },
  {
    id: "win32-x64",
    packageName: "@oven/bun-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
];

export function runtimeTarget(id: string): RuntimeTarget {
  const target = RUNTIME_TARGETS.find((candidate) => candidate.id === id);
  if (!target) {
    throw new Error(
      `unknown runtime target "${id}"; expected ${RUNTIME_TARGETS.map((candidate) => candidate.id).join(", ")}`,
    );
  }
  return target;
}

export function currentRuntimeTarget(): RuntimeTarget {
  const cpu = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
  let id = `${process.platform}-${cpu}`;
  // Node types the report as a bare `object`; glibc builds carry this field, musl builds don't.
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  if (process.platform === "linux" && !report?.header?.glibcVersionRuntime) {
    id += "-musl";
  }
  return runtimeTarget(id);
}
