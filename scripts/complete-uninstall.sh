#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "This script will stop only-whispers, remove the installed app, and delete caches, databases, and preferences."
read -r -p "Continue with the full uninstall? [y/N]: " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

remove_target() {
  local target="$1"
  if [[ -e "$target" ]]; then
    echo "Removing $target"
    rm -rf "$target" 2>/dev/null || sudo rm -rf "$target"
  fi
}

echo "Stopping running only-whispers/Electron processes..."
pkill -f "only-whispers" 2>/dev/null || true
pkill -f "Electron Helper.*only-whispers" 2>/dev/null || true

echo "Removing /Applications/only-whispers.app (requires admin)..."
remove_target "/Applications/only-whispers.app"

echo "Purging Application Support data..."
remove_target "$HOME/Library/Application Support/only-whispers"
remove_target "$HOME/Library/Application Support/only-whispers-development"
remove_target "$HOME/Library/Application Support/com.raythurnvoid.only-whispers"

echo "Removing caches, logs, and saved state..."
remove_target "$HOME/Library/Caches/only-whispers"
remove_target "$HOME/Library/Caches/com.raythurnvoid.only-whispers"
remove_target "$HOME/Library/Preferences/com.raythurnvoid.only-whispers.plist"
remove_target "$HOME/Library/Logs/only-whispers"
remove_target "$HOME/Library/Saved Application State/com.raythurnvoid.only-whispers.savedState"

echo "Cleaning temporary files..."
shopt -s nullglob
for tmp in /tmp/only-whispers*; do
  remove_target "$tmp"
done
for crash in "$HOME/Library/Application Support/CrashReporter"/only-whispers_*; do
  remove_target "$crash"
done
shopt -u nullglob

read -r -p "Remove downloaded models and caches (~/.cache/only-whispers, ~/.cache/whisper)? [y/N]: " wipe_models
if [[ "$wipe_models" =~ ^[Yy]$ ]]; then
  remove_target "$HOME/.cache/only-whispers"
  remove_target "$HOME/.cache/whisper"
fi

ENV_FILE="$PROJECT_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  read -r -p "Remove the local environment file at $ENV_FILE? [y/N]: " wipe_env
  if [[ "$wipe_env" =~ ^[Yy]$ ]]; then
    echo "Removing $ENV_FILE"
    rm -f "$ENV_FILE"
  fi
fi

cat <<'EOF'
macOS keeps microphone, screen recording, and accessibility approvals even after files are removed.
Reset them if you want a truly fresh start:
  tccutil reset Microphone com.raythurnvoid.only-whispers
  tccutil reset Accessibility com.raythurnvoid.only-whispers
  tccutil reset ScreenCapture com.raythurnvoid.only-whispers

Full uninstall complete. Reboot if you removed permissions, then reinstall or run pnpm scripts on a clean tree.
EOF
