#!/usr/bin/env bash
# Installs the AI secretary skill at USER scope (~/.claude/skills/), so it's
# available in every Claude Code chat on this machine, regardless of project.
#
# There is no server to run and nothing to register: the actual memory lives
# as Markdown files in a "AI Secretary" Google Drive folder, read/written via
# the Google Drive connector — which is why the same memory also works from
# claude.ai (web/mobile/desktop), not just Claude Code, as long as the Google
# Drive connector is enabled for your account (claude.ai > Settings >
# Connectors) and this skill's instructions are available to that surface.
#
# Safe to re-run: overwrites the previous copy of the skill.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$SCRIPT_DIR/skills/ai-secretary"
SKILL_DEST="$HOME/.claude/skills/ai-secretary"

echo "==> Installing the ai-secretary skill to $SKILL_DEST"
mkdir -p "$HOME/.claude/skills"
rm -rf "$SKILL_DEST"
cp -r "$SKILL_SRC" "$SKILL_DEST"

cat <<'EOF'

Done. The ai-secretary skill is installed to ~/.claude/skills/ai-secretary.

Two things to check that this script can't do for you:

1. Enable the Google Drive connector for your Claude account, if you haven't:
   claude.ai > Settings > Connectors > Google Drive.
2. (Optional, for Obsidian) Install Google Drive for desktop, then point an
   Obsidian vault at the "AI Secretary" folder it mirrors locally, so you can
   browse/edit the same memory notes in Obsidian. Claude will create the
   "AI Secretary" folder (and its category subfolders) in your Drive root the
   first time it saves a memory, if it doesn't already exist.

Try it: ask Claude something like "覚えておいて: 私は朝型で、午前中に集中したい"
in any Claude surface with Google Drive connected, then in a different one ask
for a recommendation and see it factor that in.
EOF
