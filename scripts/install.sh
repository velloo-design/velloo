#!/usr/bin/env bash
# Install or update Velloo with its private Bun runtime.
#
#   curl -fsSL https://get.velloo.design/install.sh | bash
#
# Overrides for mirrors/tests: VELLOO_VERSION, VELLOO_DOWNLOAD_BASE,
# VELLOO_HOME, and VELLOO_BIN_DIR.
set -euo pipefail

VERSION="${VELLOO_VERSION:-@VELLOO_VERSION@}"
DOWNLOAD_BASE="${VELLOO_DOWNLOAD_BASE:-@VELLOO_DOWNLOAD_BASE@}"
INSTALL_ROOT="${VELLOO_HOME:-$HOME/.velloo}"
BIN_DIR="${VELLOO_BIN_DIR:-$HOME/.local/bin}"

# Colour only for a person at a terminal, and never under NO_COLOR (no-color.org).
colour_out=0
colour_err=0
if [ -z "${NO_COLOR:-}" ]; then
  [ -t 1 ] && colour_out=1
  [ -t 2 ] && colour_err=1
fi
paint() {
  if [ "$1" = 1 ]; then printf '\033[%sm%s\033[0m\n' "$2" "$3"; else printf '%s\n' "$3"; fi
}
note() { paint "$colour_out" 36 "$*"; }
ok() { paint "$colour_out" 32 "$*"; }
warn() { paint "$colour_out" 33 "$*"; }
err() { paint "$colour_err" 31 "$*" >&2; }
die() { err "velloo install: $*"; exit 1; }

tilde() {
  case "$1" in
    "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Where another velloo came from, and how to remove it, when that is knowable
# from its symlink: npm and Homebrew both link their commands into a bin dir.
origin_of() {
  target="$(readlink "$1" 2>/dev/null || true)"
  case "$target" in
    *node_modules/velloo/*) printf '  (npm global install: npm uninstall -g velloo)' ;;
    *Cellar/velloo/*) printf '  (Homebrew: brew uninstall velloo)' ;;
    *.velloo/current/*) printf '  (an earlier curl install linked from another directory)' ;;
  esac
}

# The line that puts BIN_DIR on PATH for the user's login shell.
path_setup_line() {
  shown="$(tilde "$BIN_DIR")"
  case "$shown" in "~"/*) shown="\$HOME${shown#"~"}" ;; esac
  case "$(basename "${SHELL:-sh}")" in
    zsh) printf 'echo '"'"'export PATH="%s:$PATH"'"'"' >> ~/.zshrc' "$shown" ;;
    bash)
      if [ "$(uname -s)" = "Darwin" ]; then rc="~/.bash_profile"; else rc="~/.bashrc"; fi
      printf 'echo '"'"'export PATH="%s:$PATH"'"'"' >> %s' "$shown" "$rc"
      ;;
    fish) printf 'fish_add_path %s' "$(tilde "$BIN_DIR")" ;;
    *) printf 'echo '"'"'export PATH="%s:$PATH"'"'"' >> ~/.profile' "$shown" ;;
  esac
}

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
note "Checksum verified (SHA-256 ${actual:0:12}…)."

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
# Replace `current` with one rename. A plain `mv` resolves an existing
# `current` to the version directory it points at and moves the new link
# *inside* it, so an upgrade would unpack and then keep running the old
# version. GNU and BusyBox spell "the destination is not a directory" -T,
# BSD and macOS spell it -h; `ln -sfn` is the non-atomic last resort.
if ! mv -fT "$link" "$INSTALL_ROOT/current" 2>/dev/null &&
  ! mv -fh "$link" "$INSTALL_ROOT/current" 2>/dev/null; then
  rm -f "$link"
  ln -sfn "versions/$VERSION" "$INSTALL_ROOT/current"
fi
[ "$(readlink "$INSTALL_ROOT/current")" = "versions/$VERSION" ] ||
  die "could not switch $INSTALL_ROOT/current to $VERSION"
# Links an earlier installer misplaced inside a version directory.
find "$INSTALL_ROOT/versions" -mindepth 2 -maxdepth 2 -type l -name '.current-*' -exec rm -f {} +
ln -sf "$INSTALL_ROOT/current/bin/velloo" "$BIN_DIR/velloo"
[ ! -e "$old" ] || rm -rf "$old"

ok "✓ Velloo $VERSION installed with private Bun"
echo "  installed in  $(tilde "$INSTALL_ROOT/versions/$VERSION")"
echo "  command       $(tilde "$BIN_DIR/velloo")"

# Which `velloo` a shell would actually run. Everything below is advice: the
# install itself already succeeded.
bin_real="$(CDPATH= cd -- "$BIN_DIR" && pwd -P)"
on_path=""
before=""
after=""
# Resolved directories already reported: PATH often names one twice, or via a
# symlink. Reports show the entry as the user's PATH spells it.
seen=""
old_ifs="$IFS"
IFS=:
set -f
for dir in $PATH; do
  real="$(CDPATH= cd -- "${dir:-.}" 2>/dev/null && pwd -P)" || continue
  if [ "$real" = "$bin_real" ]; then
    on_path=1
    continue
  fi
  [ -x "$real/velloo" ] && [ ! -d "$real/velloo" ] || continue
  case "
$seen
" in
    *"
$real
"*) continue ;;
  esac
  seen="$seen${seen:+
}$real"
  if [ -n "$on_path" ]; then
    after="$after${after:+
}${dir%/}/velloo"
  else
    before="$before${before:+
}${dir%/}/velloo"
  fi
done
set +f
IFS="$old_ifs"

list_installs() {
  printf '%s\n' "$1" | while IFS= read -r other; do
    echo "    $(tilde "$other")$(origin_of "$other")"
  done
}

if [ -z "$on_path" ]; then
  echo
  warn "! $(tilde "$BIN_DIR") is not on your PATH. Add it with:"
  echo "    $(path_setup_line)"
  echo "  then open a new terminal."
  if [ -n "$before" ]; then
    echo "  Until then \`velloo\` runs another install:"
    list_installs "$before"
  fi
elif [ -n "$before" ]; then
  echo
  warn "! Another velloo comes before $(tilde "$BIN_DIR") on your PATH, so \`velloo\` runs that one:"
  list_installs "$before"
  echo "  Remove it, or move $(tilde "$BIN_DIR") ahead of its directory in PATH."
elif [ -n "$after" ]; then
  # A terminal that ran the older install remembers where it found it, so it
  # keeps running that one (zsh's `which` reports it too) until the cache is
  # cleared — even though this install now comes first on PATH.
  echo
  note "Another velloo is also on your PATH, after this one:"
  list_installs "$after"
  echo "  A terminal that already ran it may keep doing so: run \`hash -r\` there, or open a new one."
fi
echo
note "Get started:"
echo "  velloo init        scaffold a design folder"
echo "  velloo run         open the canvas"
echo "  velloo --help      everything else"
