/**
 * Pinned anonymous-feedback issuer public keys (SPKI base64) per cloud
 * origin. GENERATED — velloo-cloud's deploy_vultr.sh rewrites and commits
 * this file when the production issuer key is created or a new cloud origin
 * is deployed; do not edit by hand. Origins not listed (dev, self-hosted)
 * fall back to trust-on-first-use in feedback-tokens.ts.
 *
 * Why pinning matters: a malicious issuer could hand each user a different
 * signing key to tag their "anonymous" tokens. With one key committed here,
 * every open-source client verifies against the same value — tagged tokens
 * simply fail. A change to this file is a key rotation; review it like one.
 */
export const PINNED_ISSUER_KEYS: Record<string, string> = {
  "https://api.velloo.ai":
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs54VddkMfc1b0S+2i8GOouyseMo4mb6+zPYBv/Omu1sZQfTYFVFttZOWO0vw6ObT8EVBC/4qCgZPa1d8To55rNe6ZSWJkvXFuoEeOaVDlfDhxduFnVFa5QelxEwVXAFpVSSdPwcFicoCNxuhHTbezPQl3yKLZVwIUncMNhpwsjXVyrKEtSp+5cAY1SH2axLBpqPT1nReH5HAZmAmUcZFvJND45htig2o2tvFSTkOCurFt6lw9HiCWjNE1L1C3Y/VuGkvIVbQShNipyBvgn1ZtJxFvkY4M4ULUj9G9JMb6pYtUupUddPLfpROXSPFvbDk22JOOP2VWtv5r9mXeTCAIQIDAQAB",
};
