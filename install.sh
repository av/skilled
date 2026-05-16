#!/bin/sh

# Install script for skilled
# Usage: curl -fsSL https://raw.githubusercontent.com/av/skilled/main/install.sh | sh

set -e

REPO="av/skilled"
BINARY="skilled"

detect_platform() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)  platform="linux" ;;
    Darwin) platform="darwin" ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "Error: Windows detected. Use the npm or pip package instead." >&2
      echo "  npm install -g @avcodes/skilled" >&2
      echo "  pip install skilled" >&2
      exit 1
      ;;
    *)
      echo "Error: Unsupported operating system: $os" >&2
      exit 1
      ;;
  esac

  case "$arch" in
    x86_64|amd64)  arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      echo "Error: Unsupported architecture: $arch" >&2
      echo "Supported: x86_64/amd64, aarch64/arm64" >&2
      exit 1
      ;;
  esac

  echo "${platform}-${arch}"
}

detect_install_dir() {
  if [ -w "/usr/local/bin" ]; then
    echo "/usr/local/bin"
  elif [ -d "$HOME/.local/bin" ]; then
    echo "$HOME/.local/bin"
  else
    mkdir -p "$HOME/.local/bin"
    echo "$HOME/.local/bin"
  fi
}

get_latest_version() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/'
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/'
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

download() {
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    echo "Error: curl or wget is required" >&2
    exit 1
  fi
}

main() {
  target="$(detect_platform)"
  version="${SKILLED_VERSION:-$(get_latest_version)}"
  install_dir="$(detect_install_dir)"

  if [ -z "$version" ]; then
    echo "Error: Could not determine latest version" >&2
    exit 1
  fi

  artifact="${BINARY}-${target}"
  url="https://github.com/${REPO}/releases/download/${version}/${artifact}.tar.gz"

  echo "Installing ${BINARY} ${version} (${target})..."

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  echo "Downloading ${url}..."
  download "$url" "${tmpdir}/${artifact}.tar.gz"

  echo "Extracting..."
  tar xzf "${tmpdir}/${artifact}.tar.gz" -C "$tmpdir"

  echo "Installing to ${install_dir}..."
  install -m 755 "${tmpdir}/${BINARY}" "${install_dir}/${BINARY}"
  install -m 755 "${tmpdir}/${BINARY}-index" "${install_dir}/${BINARY}-index"

  echo ""
  echo "Successfully installed ${BINARY} and ${BINARY}-index to ${install_dir}/"

  case ":$PATH:" in
    *":${install_dir}:"*) ;;
    *)
      echo ""
      echo "Note: ${install_dir} is not in your PATH."
      echo "Add it with:"
      echo "  export PATH=\"${install_dir}:\$PATH\""
      ;;
  esac
}

main
