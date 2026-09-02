#!/usr/bin/env bash
# Installs the AI secretary at USER scope (~/.claude/), so it is available in
# every Claude Code chat on this machine, regardless of which project is open.
#
# What this does:
#   1. npm install the memory MCP server (local vector DB + local embeddings).
#   2. Register it with Claude Code at user scope (`claude mcp add -s user`).
#   3. Copy the `ai-secretary` skill into ~/.claude/skills/.
#
# Safe to re-run: MCP registration is idempotent (removes and re-adds), and
# the skill copy overwrites the previous version.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER_DIR="$SCRIPT_DIR/mcp-server"
SKILL_SRC="$SCRIPT_DIR/skills/ai-secretary"
SKILL_DEST="$HOME/.claude/skills/ai-secretary"

command -v node >/dev/null 2>&1 || { echo "node is required (v18+)." >&2; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "the 'claude' CLI is required on PATH." >&2; exit 1; }

echo "==> Installing MCP server dependencies ($MCP_SERVER_DIR)"
(cd "$MCP_SERVER_DIR" && npm install)

echo "==> Registering ai-secretary-memory MCP server at user scope"
claude mcp remove -s user ai-secretary-memory >/dev/null 2>&1 || true
claude mcp add -s user ai-secretary-memory -- node "$MCP_SERVER_DIR/src/index.js"

echo "==> Installing the ai-secretary skill to $SKILL_DEST"
mkdir -p "$HOME/.claude/skills"
rm -rf "$SKILL_DEST"
cp -r "$SKILL_SRC" "$SKILL_DEST"

cat <<'EOF'

Done.

The ai-secretary-memory MCP server is registered at user scope and the
ai-secretary skill is installed to ~/.claude/skills/ai-secretary.

Restart any running Claude Code sessions (or start a new one) to pick up the
new MCP server. The first time a memory is stored or recalled, the embedding
model (~90MB, Xenova/all-MiniLM-L6-v2) will be downloaded once from
huggingface.co and cached under ~/.claude/ai-secretary/models — this needs
outbound network access to huggingface.co on this machine.

Try it: ask Claude something like "覚えておいて: 私は朝型で、午前中に集中したい"
in any project, then in a different project ask for a recommendation and see
it factor that in.
EOF
