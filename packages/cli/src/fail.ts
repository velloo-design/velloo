import pc from "picocolors";

/**
 * Single exit point for command failures: print the prefixed message to
 * stderr and exit 1. Keeping the exit here rather than sprinkled at
 * call sites makes command flow read linearly and gives tests one
 * contract — failures print `velloo <cmd>: <reason>` and exit non-zero.
 */
export function fail(command: string, message: string): never {
  console.error(`${pc.red(`velloo ${command}:`)} ${message}`);
  process.exit(1);
}

/**
 * Exit for an error that escaped a command's run(). Users get one clean
 * line — never Bun's uncaught dump (source excerpt + call stack), which is
 * what citty's fallback produces by console.error-ing the Error object.
 * Messages crafted for the user carry a `velloo: ` prefix (e.g. the
 * design-folder schema-version gate); anything else is an unexpected bug,
 * so a dim hint points at VELLOO_DEBUG=1 for the real stack.
 */
export function failWithError(command: string, err: unknown): never {
  if (process.env.VELLOO_DEBUG) {
    console.error(err);
    process.exit(1);
  }
  const raw = err instanceof Error ? err.message : String(err);
  const crafted = raw.startsWith("velloo: ");
  console.error(`${pc.red(`velloo ${command}:`)} ${crafted ? raw.slice("velloo: ".length) : raw}`);
  if (!crafted) {
    console.error(pc.dim("  (unexpected — re-run with VELLOO_DEBUG=1 for a stack trace)"));
  }
  process.exit(1);
}
