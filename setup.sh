#!/usr/bin/env bash
#
# setup.sh — one-command GLOBAL install of the provision-sitecore-component skill.
#
# Symlinks skills/provision-sitecore-component into each tool's user-level skills
# directory, so the skill is available in every project without per-repo wiring:
#
#   Claude Code -> ~/.claude/skills/provision-sitecore-component
#   Codex       -> ~/.codex/skills/provision-sitecore-component
#   Cursor      -> ~/.cursor/skills/provision-sitecore-component
#
# Usage (from anywhere; the script resolves its own repo location):
#
#   bash setup.sh [claude] [codex] [cursor] [--uninstall]
#
# With no tool args, wires every tool whose config dir already exists
# (~/.claude / ~/.codex / ~/.cursor). Re-running is safe: an existing symlink is
# recreated in place. A non-symlink already sitting where the symlink belongs is
# left untouched and aborts with an error rather than being overwritten.
# --uninstall removes only symlinks that point into this repo.
#
# The skill is self-contained (SKILL.md + references/) — one symlink per tool.
# The CLI it drives stays in this clone; keep the clone where you ran setup from.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
SKILL_NAME="provision-sitecore-component"
SKILL_SRC="$REPO_ROOT/skills/$SKILL_NAME"

[ -f "$SKILL_SRC/SKILL.md" ] || { echo "error: $SKILL_SRC/SKILL.md not found (run from a full clone)" >&2; exit 1; }

UNINSTALL=0
TOOLS=()
for a in "$@"; do
  case "$a" in
    --uninstall) UNINSTALL=1 ;;
    claude|codex|cursor) TOOLS+=("$a") ;;
    -*) echo "error: unknown flag \"$a\" (expected: --uninstall)" >&2; exit 2 ;;
    *) echo "error: unknown tool \"$a\" (expected: claude | codex | cursor)" >&2; exit 2 ;;
  esac
done

# No explicit tools: auto-detect installed tools by their user config dir.
if [ "${#TOOLS[@]}" -eq 0 ]; then
  [ -d "$HOME/.claude" ] && TOOLS+=(claude)
  [ -d "$HOME/.codex" ] && TOOLS+=(codex)
  [ -d "$HOME/.cursor" ] && TOOLS+=(cursor)
fi
if [ "${#TOOLS[@]}" -eq 0 ]; then
  echo "usage: bash setup.sh [claude] [codex] [cursor] [--uninstall]" >&2
  echo "  (no ~/.claude, ~/.codex, or ~/.cursor found to auto-detect — name at least one tool)" >&2
  exit 2
fi

skills_dir_for() {
  case "$1" in
    claude) echo "$HOME/.claude/skills" ;;
    codex) echo "$HOME/.codex/skills" ;;
    cursor) echo "$HOME/.cursor/skills" ;;
  esac
}

install_link() {
  local link="$1"
  mkdir -p "$(dirname "$link")"
  if [ -L "$link" ]; then rm "$link"; fi
  if [ -e "$link" ]; then
    echo "error: $link exists and is not a symlink — refusing to overwrite" >&2
    exit 1
  fi
  ln -s "$SKILL_SRC" "$link"
  echo "  symlinked $link -> $SKILL_SRC"
}

uninstall_link() {
  local link="$1"
  if [ -L "$link" ]; then
    local target
    target="$(readlink "$link")"
    if [ "$target" = "$SKILL_SRC" ]; then
      rm "$link"
      echo "  removed $link"
    else
      echo "  skipped $link (points elsewhere: $target)"
    fi
  elif [ -e "$link" ]; then
    echo "  skipped $link (not a symlink)"
  else
    echo "  not installed: $link"
  fi
}

for tool in "${TOOLS[@]}"; do
  dir="$(skills_dir_for "$tool")"
  echo "$tool:"
  if [ "$UNINSTALL" -eq 1 ]; then
    uninstall_link "$dir/$SKILL_NAME"
  else
    install_link "$dir/$SKILL_NAME"
  fi
done

if [ "$UNINSTALL" -eq 1 ]; then
  echo "Done. The skill is uninstalled; this clone is untouched."
else
  echo "Done. Restart the tool if it caches skills. The skill drives this clone's CLI — keep the clone in place (git pull to update everyone's copy)."
fi
