/**
 * Module-level connection flag, mirrored from the WS client (which already
 * reconnects with backoff). Lives outside the zustand store so the API layer
 * can gate mutations without importing the store (store → api → store would
 * cycle). Fetches stay allowed — they're what reconnect recovery uses.
 */
let connected = true;

export function setApiConnected(next: boolean): void {
  connected = next;
}

/**
 * Throw before a mutating request leaves the canvas while the daemon is
 * unreachable. Failing fast here (instead of letting fetch time out or the
 * caller swallow a network error) is what keeps disconnection from turning
 * into silent no-ops or half-applied edits.
 */
export function ensureConnected(): void {
  if (!connected) {
    throw new Error("Disconnected from the velloo daemon — edits are paused until it reconnects.");
  }
}
