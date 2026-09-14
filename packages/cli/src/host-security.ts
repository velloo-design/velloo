const REMOTE_HOST_FLAG = "--unsafe-allow-remote";

/** True only for hostnames that bind exclusively to this machine. */
export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d+$/.test(part));
}
/**
 * Velloo's canvas and mutation-capable MCP endpoints do not authenticate local
 * callers. Binding them to a network interface therefore requires a conscious,
 * conspicuous opt-in at every process boundary that can start a daemon.
 */
export function assertRemoteHostAllowed(host: string, unsafeAllowRemote = false): void {
  if (isLoopbackHost(host) || unsafeAllowRemote) return;
  throw new Error(
    `refusing to bind unauthenticated canvas and MCP endpoints to ${JSON.stringify(host)}; ` +
      `use ${REMOTE_HOST_FLAG} only on a trusted network`,
  );
}
