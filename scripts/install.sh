#!/usr/bin/env bash
# Install (or update) the Velloo CLI from the hosted dogfood build.
#
#   curl -fsSL https://get.velloo.dev/install.sh | bash
#
# Velloo runs on Bun (>=1.3.0). If Bun is missing this asks before installing it
# (reading the answer from the terminal, since stdin is the curl pipe). Set
# VELLOO_ASSUME_YES=1 to install Bun without prompting (CI/non-interactive).
set -euo pipefail

TARBALL_URL="${VELLOO_TARBALL_URL:-https://get.velloo.dev/velloo.tgz}"

note() { printf '\033[36m%s\033[0m\n' "$*"; }
ok() { printf '\033[32m%s\033[0m\n' "$*"; }
err() { printf '\033[31m%s\033[0m\n' "$*" >&2; }

if ! command -v bun >/dev/null 2>&1; then
  note "Velloo needs Bun (>=1.3.0), which isn't installed."
  reply=""
  if [ "${VELLOO_ASSUME_YES:-}" = "1" ]; then
    reply="y"
  elif [ -r /dev/tty ]; then
    printf 'Install Bun now via https://bun.sh/install? [y/N] '
    read -r reply < /dev/tty || reply=""
  fi
  case "$reply" in
    [yY]*)
      curl -fsSL https://bun.sh/install | bash
      export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
      export PATH="$BUN_INSTALL/bin:$PATH"
      ;;
    *)
      err "Bun is required. Install it from https://bun.sh, then re-run this command."
      exit 1
      ;;
  esac
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

note "Downloading velloo…"
curl -fsSL "$TARBALL_URL" -o "$tmp/velloo.tgz"

# Drop any prior global install first: the version is pinned, so Bun would
# otherwise treat the already-installed copy as satisfied and skip the new bits.
bun remove -g velloo >/dev/null 2>&1 || true
bun install -g "$tmp/velloo.tgz"

ok "✓ velloo installed — run: velloo --help"
bin="$(bun pm bin -g 2>/dev/null || true)"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) [ -n "$bin" ] && note "Add $bin to your PATH, then: velloo --help" ;;
esac
