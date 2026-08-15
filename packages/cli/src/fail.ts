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
