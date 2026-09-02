# ai-secretary-memory (MCP server)

A local, personal long-term memory for an AI secretary: a real vector database
of facts/preferences about the user, searched by semantic similarity.

- **Storage**: [vectra](https://github.com/Stevenic/vectra), a pure-JS local
  vector index (no native compilation, no external service) persisted under
  `~/.claude/ai-secretary/memory-index/`.
- **Embeddings**: [@huggingface/transformers](https://github.com/huggingface/transformers.js)
  running the small `Xenova/all-MiniLM-L6-v2` model (384 dims, ~90MB quantized)
  fully locally — no API key, no per-call network cost. The model is
  downloaded once and cached under `~/.claude/ai-secretary/models/`.
- **Scale**: similarity search is a brute-force cosine scan over all stored
  items. That's the right tradeoff at personal scale (thousands of memories,
  not millions) — it avoids native index dependencies entirely.

## Tools exposed

| Tool | Purpose |
|---|---|
| `remember` | Store a fact/preference about the user (`text`, `category`, `tags`, `importance`). |
| `recall` | Semantic search for memories relevant to a query, optionally filtered by `category`. |
| `forget` | Delete a memory by id. |
| `list_recent_memories` | List the most recently stored memories. |
| `memory_stats` | Total count and per-category breakdown. |

## Manual install / registration

Normally you'd run `../install.sh` instead of doing this by hand, but for
reference:

```bash
npm install
claude mcp add -s user ai-secretary-memory -- node "$(pwd)/src/index.js"
```

`-s user` registers it at **user scope**, so it's available from any project
directory, not just this repo.

## Configuration

Environment variables (set via `claude mcp add -e KEY=value ...` if you need
to override the defaults):

- `AI_SECRETARY_HOME` — root directory for data + model cache. Defaults to
  `~/.claude/ai-secretary`.
- `AI_SECRETARY_MODEL` — embedding model id. Defaults to
  `Xenova/all-MiniLM-L6-v2`. Any sentence-embedding model supported by
  `@huggingface/transformers` works, but changing it invalidates previously
  stored vectors (they were embedded with the old model) — you'd need to
  re-embed existing memories or start a fresh index.

## Development

```bash
npm run smoke-test   # exercises remember/recall/list/stats end to end
                      # (downloads the embedding model on first run — needs
                      # network access to huggingface.co)
```
