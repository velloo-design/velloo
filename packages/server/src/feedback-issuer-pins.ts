/**
 * Pinned anonymous-feedback issuer public keys (SPKI base64) per cloud
 * origin. A pin is committed once, when a production origin's issuer key is
 * first created; velloo-cloud's deploy pipeline (scripts/fly-up.sh) refuses
 * a prod deploy whose FEEDBACK_ISSUER_PRIVATE_KEY doesn't match the pin
 * here. Origins not listed (the dev environment, self-hosted) intentionally
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
