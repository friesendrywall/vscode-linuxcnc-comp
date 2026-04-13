#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh — Build and install the linuxcnc-comp VSCode extension
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$EXT_DIR"

echo "📦  Installing npm dependencies..."
npm install --silent

echo "🔨  Compiling TypeScript..."
npm run compile

echo ""
echo "Choose installation method:"
echo "  1) Install as .vsix package  (recommended — cleanest)"
echo "  2) Symlink extension folder  (easier for development/editing)"
echo "  3) Just compile, I'll install manually"
read -rp "Enter choice [1/2/3]: " choice

case $choice in
  1)
    echo "📦  Packaging .vsix..."
    npx vsce package --no-dependencies 2>/dev/null || npm install -g @vscode/vsce && npx vsce package --no-dependencies
    VSIX_FILE=$(ls -t linuxcnc-comp-*.vsix 2>/dev/null | head -1)
    if [ -z "$VSIX_FILE" ]; then
      echo "❌  Could not find .vsix file"
      exit 1
    fi
    echo "🔌  Installing $VSIX_FILE..."
    code --install-extension "$VSIX_FILE"
    echo "✅  Done! Restart VSCode (or reload window: Ctrl+Shift+P → Reload Window)"
    ;;
  2)
    EXT_INSTALL_DIR="$HOME/.vscode/extensions/linuxcnc-comp-local"
    echo "🔗  Symlinking to $EXT_INSTALL_DIR ..."
    rm -rf "$EXT_INSTALL_DIR"
    ln -s "$EXT_DIR" "$EXT_INSTALL_DIR"
    echo "✅  Done! Restart VSCode (or reload window: Ctrl+Shift+P → Reload Window)"
    ;;
  3)
    echo "✅  Compiled to ./out/extension.js"
    echo "    To install manually: vsce package then: code --install-extension linuxcnc-comp-*.vsix"
    ;;
  *)
    echo "Invalid choice."
    exit 1
    ;;
esac
