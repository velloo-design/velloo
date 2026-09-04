#!/usr/bin/env bash
# Blank-machine install test.
#
# Boots a pristine Linux container (nothing installed — no bun, no node, no
# playwright) and runs velloo's REAL one-liner install flow
# (scripts/install.sh, what `curl -fsSL https://get.velloo.design/install.sh |
# bash` serves) against a locally built direct archive — so you watch exactly
# what a new user sees: platform detection, checksum verification, and the
# app-owned private Bun install. It then hands you an interactive shell where
# `velloo` is on PATH — the closest thing to ssh-ing into a fresh box:
#
#   velloo --version
#   mkdir app && cd app && velloo init
#
# Build release artifacts first with `bun run release:build`.
#
# Usage:
#   scripts/blank-install-test.sh [distro] [--arch amd64|arm64] [--publish <port>]
#                                 [--keep] [--cmd '<sh>']
#
#   distro     ubuntu (default) | debian | fedora | alpine
#   --arch     force a platform (default: your machine's native arch); amd64 on
#              an Apple Silicon Mac exercises the x64 native binaries under
#              emulation
#   --publish  expose a container port on your host (repeatable). To reach the
#              canvas from your host browser, bind it to all interfaces inside:
#                velloo run --host 0.0.0.0 --port 7300 --background
#              then open http://localhost:7300 on the host. (The default
#              127.0.0.1 bind is unreachable through Docker's port proxy.)
#   --keep     don't wipe the box on exit (default is docker --rm: everything
#              vanishes when the shell exits). Keeps a container named
#              "velloo-blankbox" — resume it with `docker start -ai
#              velloo-blankbox`, discard it with `docker rm -f velloo-blankbox`.
#   --cmd      run this instead of the interactive shell (CI / smoke tests;
#              runs non-interactively),
#              e.g. --cmd 'velloo --version'
#
# Other experiments worth running inside:
#   - screenshot deps:  velloo browser install --with-deps
#   - offline runtime:  re-run with docker's --network none after an install
# A second shell into a running box: docker exec -it velloo-blankbox bash
# (with --keep; unnamed --rm boxes: docker ps → docker exec -it <id> bash)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  sed -n '2,44p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

distro="ubuntu"
arch=""
cmd=""
keep=""
publish=()
while [ $# -gt 0 ]; do
  case "$1" in
    ubuntu | debian | fedora | alpine) distro="$1" ;;
    --arch)
      arch="${2:?--arch needs amd64|arm64}"
      shift
      ;;
    --publish)
      publish+=("${2:?--publish needs a port}")
      shift
      ;;
    --keep) keep=1 ;;
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
    prereqs="apt-get update -qq >/dev/null && apt-get install -y -qq curl ca-certificates >/dev/null"
    ;;
  debian)
    image="debian:bookworm"
    prereqs="apt-get update -qq >/dev/null && apt-get install -y -qq curl ca-certificates >/dev/null"
    ;;
  fedora)
    image="fedora:latest"
    prereqs="dnf install -y -q curl >/dev/null"
    ;;
  alpine)
    # musl: Velloo picks its musl private runtime; bash isn't preinstalled.
    image="alpine:latest"
    prereqs="apk add --no-cache -q curl unzip bash libgcc libstdc++"
    ;;
esac

version="$(bun -e 'console.log(require(process.argv[1]).version)' "$repo_root/packages/cli/package.json")"
machine_arch="${arch:-$(uname -m)}"
case "$machine_arch" in
  amd64 | x86_64) artifact_arch=x64 ;;
  arm64 | aarch64) artifact_arch=arm64 ;;
  *) artifact_arch="$machine_arch" ;;
esac
musl=""
[ "$distro" != "alpine" ] || musl="-musl"
artifact="$repo_root/release-artifacts/velloo-$version-linux-$artifact_arch$musl.tar.gz"
if [ ! -f "$artifact" ] || [ ! -f "$artifact.sha256" ]; then
  echo "missing $(basename "$artifact") + checksum — run \`bun run release:build\` first." >&2
  exit 1
fi
echo "▸ testing $(basename "$artifact") on $image${arch:+ (linux/$arch)}"

docker_args=(--hostname blankbox --workdir /root)
if [ -n "$keep" ]; then
  # Named + not --rm: the box survives exit. `docker start -ai velloo-blankbox`
  # resumes it; `docker rm -f velloo-blankbox` discards it (also required
  # before a fresh --keep run).
  docker_args+=(--name velloo-blankbox)
  echo "▸ --keep: resume later with \`docker start -ai velloo-blankbox\`, discard with \`docker rm -f velloo-blankbox\`"
else
  docker_args+=(--rm)
fi
docker_args+=(-v "$repo_root/release-artifacts:/tmp/downloads:ro")
docker_args+=(-v "$repo_root/scripts/install.sh:/tmp/install.sh:ro")
[ -n "$arch" ] && docker_args+=(--platform "linux/$arch")
# `:` no-op default — this line lands inside the bootstrap string, and an
# empty value there must not be a failing command under its `set -e`.
canvas_hint=":"
for p in "${publish[@]+"${publish[@]}"}"; do
  docker_args+=(-p "$p:$p")
  canvas_hint="echo '   canvas from your host browser: velloo run --host 0.0.0.0 --port $p --background  →  http://localhost:$p'"
done

# `cat | bash` (not `bash /tmp/install.sh`) keeps the real pipe-from-curl
# semantics. file:// serves the local archive through the installer's real
# download and checksum path unchanged.
bootstrap="
set -e
echo \"── blank box: \$(. /etc/os-release && echo \$PRETTY_NAME) \$(uname -m) ──\"
$prereqs
echo '── curl -fsSL https://get.velloo.design/install.sh | bash  (served from local artifacts) ──'
cat /tmp/install.sh | VELLOO_VERSION=$version VELLOO_DOWNLOAD_BASE=file:///tmp/downloads bash
export PATH=\"\$HOME/.local/bin:\$PATH\"
echo
echo \"── velloo \$(velloo --version) on a box that had nothing ──\"
echo '   try: mkdir app && cd app && velloo init'
$canvas_hint
echo
"

# Outer shell is sh, not bash — alpine has no bash until prereqs install it.
if [ -n "$cmd" ]; then
  exec docker run "${docker_args[@]}" "$image" sh -c "$bootstrap$cmd"
fi

# Hand the console over (bash exists everywhere post-prereqs).
exec docker run -it "${docker_args[@]}" "$image" sh -c "${bootstrap}exec bash -i"
