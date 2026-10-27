/** A plain object's fields, or none: how every adapter reads a provider's untrusted JSON. */
export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
