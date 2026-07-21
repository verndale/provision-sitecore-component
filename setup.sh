#!/usr/bin/env bash
#
# setup.sh — one-command GLOBAL install of the provision-sitecore-component
# skill and its guardrails.
#
# Per tool, three steps (all idempotent, all printed as they land):
#
#   1. Symlink skills/provision-sitecore-component into the tool's user-level
#      skills directory, so the skill is available in every project:
#
#        Claude Code -> ~/.claude/skills/provision-sitecore-component
#        Codex       -> ~/.codex/skills/provision-sitecore-component
#        Cursor      -> ~/.cursor/skills/provision-sitecore-component
#
#   2. Claude Code + Codex only: register the PreToolUse guard
#      (scripts/hooks/pretooluse-guard.cjs) in the tool's user hook config
#      (~/.claude/settings.json / ~/.codex/hooks.json) via
#      scripts/hooks/install.cjs. Cursor has no hook surface — its guardrails
#      remain the prose in SKILL.md.
#
#   3. Offer a one-time credential bootstrap for the Authoring API: writes
#      ~/.config/provision-sitecore-component/.env (chmod 600, values never
#      echoed). Skippable; exported env vars and a per-repo ./.env override it
#      (see skills/provision-sitecore-component/references/authoring-api.md).
#
# Usage (from anywhere; the script resolves its own repo location):
#
#   bash setup.sh [claude] [codex] [cursor] [--uninstall]
#
# With no tool args, wires every tool whose config dir already exists
# (~/.claude / ~/.codex / ~/.cursor). Re-running is safe: symlinks are
# recreated in place and hook entries are updated in place. A non-symlink
# already sitting where the symlink belongs aborts rather than being
# overwritten. --uninstall removes only the symlinks and hook entries that
# belong to this skill; the credential file is kept (path printed).
#
# The skill drives this clone's CLI and guard — keep the clone where you ran
# setup from (git pull updates everyone's copy).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
SKILL_NAME="provision-sitecore-component"
SKILL_SRC="$REPO_ROOT/skills/$SKILL_NAME"
CRED_DIR="$HOME/.config/provision-sitecore-component"
CRED_FILE="$CRED_DIR/.env"

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

credential_bootstrap() {
  if [ -f "$CRED_FILE" ]; then
    echo "credentials: keeping existing $CRED_FILE"
    return 0
  fi
  if [ ! -t 0 ]; then
    echo "credentials: non-interactive shell — create $CRED_FILE from .env.example when ready."
    return 0
  fi
  printf "Configure Sitecore authoring credentials now (one per machine)? [y/N] "
  local reply="" ep="" cid="" csec="" turl="" aud=""
  read -r reply || reply=""
  if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
    echo "  skipped. Later: re-run setup.sh, or create $CRED_FILE from .env.example."
    return 0
  fi
  printf "  SITECORE_AUTHORING_ENDPOINT: "
  read -r ep || ep=""
  printf "  SITECORE_AUTHORING_CLIENT_ID: "
  read -r cid || cid=""
  printf "  SITECORE_AUTHORING_CLIENT_SECRET (hidden): "
  read -rs csec || csec=""
  printf "\n"
  printf "  SITECORE_AUTHORING_TOKEN_URL (blank for default): "
  read -r turl || turl=""
  printf "  SITECORE_AUTHORING_AUDIENCE (blank for default): "
  read -r aud || aud=""
  umask 077
  mkdir -p "$CRED_DIR"
  {
    echo "# provision-sitecore-component — Authoring API credentials (written by setup.sh)"
    echo "# Exported env vars and a per-repo ./.env override these (authoring-api.md)."
    echo "SITECORE_AUTHORING_ENDPOINT=$ep"
    echo "SITECORE_AUTHORING_CLIENT_ID=$cid"
    echo "SITECORE_AUTHORING_CLIENT_SECRET=$csec"
    if [ -n "$turl" ]; then echo "SITECORE_AUTHORING_TOKEN_URL=$turl"; fi
    if [ -n "$aud" ]; then echo "SITECORE_AUTHORING_AUDIENCE=$aud"; fi
  } > "$CRED_FILE"
  chmod 600 "$CRED_FILE"
  echo "  wrote $CRED_FILE (600). Values were not echoed."
}

for tool in "${TOOLS[@]}"; do
  dir="$(skills_dir_for "$tool")"
  echo "$tool:"
  if [ "$UNINSTALL" -eq 1 ]; then
    uninstall_link "$dir/$SKILL_NAME"
    case "$tool" in
      claude|codex) node "$REPO_ROOT/scripts/hooks/install.cjs" "$tool" --uninstall ;;
    esac
  else
    install_link "$dir/$SKILL_NAME"
    case "$tool" in
      claude|codex) node "$REPO_ROOT/scripts/hooks/install.cjs" "$tool" ;;
      cursor) echo "  note: Cursor has no hook surface — guardrails there remain prose-only (SKILL.md)." ;;
    esac
  fi
done

if [ "$UNINSTALL" -eq 1 ]; then
  echo "Done. The skill and its guard hooks are uninstalled; this clone is untouched."
  if [ -f "$CRED_FILE" ]; then
    echo "Credentials remain at $CRED_FILE — delete the file yourself if it is no longer needed."
  fi
else
  credential_bootstrap
  echo "Done. Restart the tool if it caches skills or hooks (hook configs snapshot at session start)."
  echo "The skill drives this clone's CLI — keep the clone in place (git pull to update everyone's copy)."
fi
