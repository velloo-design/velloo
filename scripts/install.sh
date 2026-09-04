#!/usr/bin/env bash
# Install or update Velloo with its private Bun runtime.
#
#   curl -fsSL https://get.velloo.design/install.sh | bash
#
# Overrides for mirrors/tests: VELLOO_VERSION, VELLOO_DOWNLOAD_BASE,
# VELLOO_HOME, and VELLOO_BIN_DIR.
set -euo pipefail

VERSION="${VELLOO_VERSION:-@VELLOO_VERSION@}"
DOWNLOAD_BASE="${VELLOO_DOWNLOAD_BASE:-https://get.velloo.design}"
INSTALL_ROOT="${VELLOO_HOME:-$HOME/.velloo}"
BIN_DIR="${VELLOO_BIN_DIR:-$HOME/.local/bin}"

note() { printf '\033[36m%s\033[0m\n' "$*"; }
ok() { printf '\033[32m%s\033[0m\n' "$*"; }
err() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
die() { err "velloo install: $*"; exit 1; }

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) die "unsupported operating system $(uname -s); use npm install -g velloo on Windows" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) die "unsupported architecture $(uname -m); expected arm64 or x64" ;;
esac

target="$os-$arch"
if [ "$os" = "linux" ]; then
  if [ -f /etc/alpine-release ] || (command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl); then
    target="$target-musl"
  fi
fi

artifact="velloo-$VERSION-$target.tar.gz"
url="$DOWNLOAD_BASE/$artifact"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

note "Downloading Velloo $VERSION for ${target}…"
curl -fsSL "$url" -o "$tmp/$artifact" || die "could not download $url"
curl -fsSL "$url.sha256" -o "$tmp/$artifact.sha256" || die "could not download checksum"

expected="$(awk 'NR == 1 { print $1 }' "$tmp/$artifact.sha256")"
if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$artifact" | awk '{ print $1 }')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$artifact" | awk '{ print $1 }')"
else
  die "SHA-256 verification requires shasum or sha256sum"
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || die "artifact checksum mismatch"

mkdir -p "$INSTALL_ROOT/versions" "$BIN_DIR"
payload="$tmp/payload"
mkdir -p "$payload"
tar -xzf "$tmp/$artifact" -C "$payload"
[ -x "$payload/runtime/bun" ] || die "artifact has no private Bun runtime"
[ -x "$payload/bin/velloo" ] || die "artifact has no Velloo launcher"
[ "$(tr -d '\r\n' < "$payload/VERSION")" = "$VERSION" ] || die "artifact version mismatch"

destination="$INSTALL_ROOT/versions/$VERSION"
old="$INSTALL_ROOT/versions/.old-$VERSION-$$"
if [ -e "$destination" ]; then mv "$destination" "$old"; fi
mv "$payload" "$destination"
link="$INSTALL_ROOT/.current-$$"
ln -s "versions/$VERSION" "$link"
mv -f "$link" "$INSTALL_ROOT/current"
ln -sf "$INSTALL_ROOT/current/bin/velloo" "$BIN_DIR/velloo"
[ ! -e "$old" ] || rm -rf "$old"

ok "✓ Velloo $VERSION installed with private Bun"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) note "Add $BIN_DIR to PATH, then open a new shell." ;;
esac
echo
note "Get started:"
echo "  velloo init        scaffold a design folder"
echo "  velloo run         open the canvas"
echo "  velloo --help      everything else"
