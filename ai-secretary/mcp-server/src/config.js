import os from "node:os";
import path from "node:path";

// Everything the AI secretary owns lives under ~/.claude/ai-secretary/, so it
// survives independently of any single project checkout and is reachable
// from any Claude Code session on this machine.
export const HOME_DIR =
  process.env.AI_SECRETARY_HOME || path.join(os.homedir(), ".claude", "ai-secretary");

export const INDEX_DIR = path.join(HOME_DIR, "memory-index");
export const MODEL_CACHE_DIR = path.join(HOME_DIR, "models");

// Small, fully local sentence-embedding model (384 dims, quantized ~23MB).
// No API key and no network calls after the first download.
export const EMBEDDING_MODEL = process.env.AI_SECRETARY_MODEL || "Xenova/all-MiniLM-L6-v2";
