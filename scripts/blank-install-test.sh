#!/usr/bin/env bash
# Blank-machine install test.
#
# Boots a pristine Linux container (nothing installed — no bun, no node, no
# playwright) and runs velloo's REAL one-liner install flow
# (scripts/install.sh, what `curl -fsSL https://get.velloo.dev/install.sh |
# bash` serves) against the locally packed tarball — so you watch exactly
# what a new user sees: the Bun prompt, the Bun installer's output, then the
# global velloo install. It then hands you an interactive shell where
# `velloo` is on PATH — the closest thing to ssh-ing into a fresh box:
#
#   velloo --version
#   mkdir app && cd app && velloo init
#
# Build the tarball first with `bun run cli:build` (velloo-*.tgz at the repo
# root).
#
# Usage:
#   scripts/blank-install-test.sh [distro] [--arch amd64|arm64] [--cmd '<sh>']
#
#   distro   ubuntu (default) | debian | fedora | alpine
#   --arch   force a platform (default: your machine's native arch); amd64 on
#            an Apple Silicon Mac exercises the x64 native binaries under
#            emulation
#   --cmd    run this instead of the interactive shell (CI / smoke tests;
#            implies VELLOO_ASSUME_YES=1 so the Bun prompt doesn't block),
#            e.g. --cmd 'velloo --version'
#
# Other experiments worth running inside:
#   - screenshot deps:  bunx playwright-core install --with-deps chromium
#   - offline runtime:  re-run with docker's --network none after an install
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  sed -n '2,31p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

distro="ubuntu"
arch=""
cmd=""
while [ $# -gt 0 ]; do
  case "$1" in
    ubuntu | debian | fedora | alpine) distro="$1" ;;
    --arch)
      arch="${2:?--arch needs amd64|arm64}"
      shift
      ;;
    --cmd)
      cmd="${2:?--cmd needs a shell command}"
      shift
      ;;
    -h | --help) usage 0 ;;
    *)
      echo "unknown argument: $1" >&2
      usage 1
      ;;
  esac
  shift
done

case "$distro" in
  ubuntu)
    image="ubuntu:24.04"
    prereqs="apt-get update -qq >/dev/null && apt-get install -y -qq curl unzip ca-certificates >/dev/null"
    ;;
  debian)
    image="debian:bookworm"
    prereqs="apt-get update -qq >/dev/null && apt-get install -y -qq curl unzip ca-certificates >/dev/null"
    ;;
  fedora)
    image="fedora:latest"
    prereqs="dnf install -y -q curl unzip >/dev/null"
    ;;
  alpine)
    # musl: bun's installer picks its musl build; bash isn't preinstalled.
    image="alpine:latest"
    prereqs="apk add --no-cache -q curl unzip bash libgcc libstdc++"
    ;;
esac

tgz="$(ls -t "$repo_root"/velloo-*.tgz 2>/dev/null | head -1 || true)"
if [ -z "$tgz" ]; then
  echo "no velloo-*.tgz at the repo root — run \`bun run cli:build\` first." >&2
  exit 1
fi
echo "▸ testing $(basename "$tgz") on $image${arch:+ (linux/$arch)}"

docker_args=(--rm --hostname blankbox --workdir /root)
docker_args+=(-v "$tgz:/tmp/velloo.tgz:ro")
docker_args+=(-v "$repo_root/scripts/install.sh:/tmp/install.sh:ro")
[ -n "$arch" ] && docker_args+=(--platform "linux/$arch")

# `cat | bash` (not `bash /tmp/install.sh`) keeps the real pipe-from-curl
# semantics: install.sh reads its Bun-install prompt from /dev/tty because
# stdin is the pipe. VELLOO_TARBALL_URL is a curl URL, so file:// serves the
# local tarball through the script's own download path unchanged.
bootstrap="
set -e
echo \"── blank box: \$(. /etc/os-release && echo \$PRETTY_NAME) \$(uname -m) ──\"
$prereqs
echo '── curl -fsSL https://get.velloo.dev/install.sh | bash  (served from the local tarball) ──'
cat /tmp/install.sh | VELLOO_TARBALL_URL=file:///tmp/velloo.tgz bash
export PATH=\"\$HOME/.bun/bin:\$PATH\"
echo
echo \"── velloo \$(velloo --version) on a box that had nothing ──\"
echo '   try: mkdir app && cd app && velloo init'
echo
"

# Outer shell is sh, not bash — alpine has no bash until prereqs install it.
if [ -n "$cmd" ]; then
  exec docker run -e VELLOO_ASSUME_YES=1 "${docker_args[@]}" "$image" sh -c "$bootstrap$cmd"
fi

# Hand the console over (bash exists everywhere post-prereqs); the Bun
# question inside install.sh is answered by you, on the real prompt.
exec docker run -it "${docker_args[@]}" "$image" sh -c "${bootstrap}exec bash -i"
