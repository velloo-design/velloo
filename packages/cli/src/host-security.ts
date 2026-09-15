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
 * Velloo's canvas and mutation-capable MCP endpoints do not authenticate
 * callers, and the server rejects any request whose Host or Origin is not
 * loopback. A network bind would expose nothing usable and invite a false sense
 * of access, so it is refused outright at every process boundary that can start
 * a daemon.
 */
export function assertLoopbackHost(host: string): void {
  if (isLoopbackHost(host)) return;
  throw new Error(
    `refusing to bind ${JSON.stringify(host)}: the canvas and MCP endpoints have no authentication ` +
      "and only serve loopback (use 127.0.0.1, localhost or ::1)",
  );
}
