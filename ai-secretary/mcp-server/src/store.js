import { LocalIndex } from "vectra";
import { randomUUID } from "node:crypto";
import { INDEX_DIR } from "./config.js";
import { embed } from "./embeddings.js";

const index = new LocalIndex(INDEX_DIR);

async function ensureIndex() {
  if (!(await index.isIndexCreated())) {
    await index.createIndex();
  }
}

/**
 * Stores a new memory (a fact/preference about the user) with its embedding.
 * @param {{text: string, category?: string, tags?: string[], importance?: number}} entry
 */
export async function remember({ text, category = "general", tags = [], importance = 3 }) {
  await ensureIndex();
  const vector = await embed(text);
  const now = new Date().toISOString();
  const item = await index.insertItem({
    id: randomUUID(),
    vector,
    metadata: {
      text,
      category,
      tags: tags.join(","),
      importance,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id: item.id, ...item.metadata };
}

/**
 * Semantic search over stored memories.
 * @param {{query: string, topK?: number, category?: string}} params
 */
export async function recall({ query, topK = 5, category }) {
  await ensureIndex();
  const vector = await embed(query);
  const filter = category ? { category: { $eq: category } } : undefined;
  const results = await index.queryItems(vector, query, topK, filter, false);
  return results.map((r) => ({
    id: r.item.id,
    score: r.score,
    ...r.item.metadata,
  }));
}

/** Deletes a memory by id. Returns true if it existed. */
export async function forget(id) {
  await ensureIndex();
  const existing = await index.getItem(id);
  if (!existing) return false;
  await index.deleteItem(id);
  return true;
}

/** Lists the most recently created memories, optionally filtered by category. */
export async function listRecent({ limit = 20, category } = {}) {
  await ensureIndex();
  const items = category
    ? await index.listItemsByMetadata({ category: { $eq: category } })
    : await index.listItems();
  return items
    .map((item) => ({ id: item.id, ...item.metadata }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

/** Aggregate stats: total count and per-category breakdown. */
export async function stats() {
  await ensureIndex();
  const items = await index.listItems();
  const byCategory = {};
  for (const item of items) {
    const cat = item.metadata.category || "general";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }
  return { total: items.length, byCategory };
}
