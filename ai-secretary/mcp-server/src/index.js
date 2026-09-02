#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { remember, recall, forget, listRecent, stats } from "./store.js";

const server = new McpServer({
  name: "ai-secretary-memory",
  version: "1.0.0",
});

server.registerTool(
  "remember",
  {
    title: "Remember a fact about the user",
    description:
      "Store a durable fact, preference, or piece of context about the user in their long-term " +
      "memory (a local vector database). Use this whenever the user reveals something worth " +
      "recalling later: a preference, a value, a recurring habit, a goal, a dislike, a relationship, " +
      "or a working style. Write the fact as a short, self-contained statement (it will be read out " +
      "of context later, so it must make sense on its own).",
    inputSchema: {
      text: z.string().min(1).describe("The fact, written as a short self-contained statement."),
      category: z
        .string()
        .optional()
        .describe(
          "A short label such as work_style, hobbies, food, communication_style, goals, " +
            "relationships, tools_and_tech, schedule_patterns, values, or dislikes. Defaults to 'general'."
        ),
      tags: z.array(z.string()).optional().describe("Optional free-form tags for extra filtering."),
      importance: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe("1 (trivial) to 5 (core, rarely-changing fact). Defaults to 3."),
    },
  },
  async ({ text, category, tags, importance }) => {
    const saved = await remember({ text, category, tags, importance });
    return {
      content: [{ type: "text", text: `Saved memory ${saved.id}: "${saved.text}" [${saved.category}]` }],
    };
  }
);

server.registerTool(
  "recall",
  {
    title: "Recall relevant facts about the user",
    description:
      "Semantic search over the user's long-term memory to retrieve facts and preferences relevant " +
      "to the current topic. Call this before giving recommendations, making plans, or answering " +
      "questions where knowing the user's tastes, habits, or prior context would change the answer.",
    inputSchema: {
      query: z.string().min(1).describe("What you want to know about the user right now."),
      topK: z.number().min(1).max(20).optional().describe("Max results to return. Defaults to 5."),
      category: z.string().optional().describe("Optional category filter."),
    },
  },
  async ({ query, topK, category }) => {
    const results = await recall({ query, topK, category });
    if (results.length === 0) {
      return { content: [{ type: "text", text: "No relevant memories found." }] };
    }
    const text = results
      .map((r) => `- [${r.category}] ${r.text} (relevance: ${r.score.toFixed(2)})`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "forget",
  {
    title: "Forget a stored memory",
    description: "Delete a stored memory by id, e.g. because the user asked to remove it or it is stale.",
    inputSchema: {
      id: z.string().min(1).describe("The memory id, as returned by remember/recall/list_recent."),
    },
  },
  async ({ id }) => {
    const existed = await forget(id);
    return {
      content: [{ type: "text", text: existed ? `Deleted memory ${id}.` : `No memory found with id ${id}.` }],
    };
  }
);

server.registerTool(
  "list_recent_memories",
  {
    title: "List recent memories",
    description: "List the most recently saved memories, optionally filtered by category.",
    inputSchema: {
      limit: z.number().min(1).max(100).optional().describe("Defaults to 20."),
      category: z.string().optional(),
    },
  },
  async ({ limit, category }) => {
    const results = await listRecent({ limit, category });
    if (results.length === 0) {
      return { content: [{ type: "text", text: "No memories stored yet." }] };
    }
    const text = results.map((r) => `- (${r.id}) [${r.category}] ${r.text}`).join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "memory_stats",
  {
    title: "Memory statistics",
    description: "Get the total number of stored memories and a breakdown by category.",
    inputSchema: {},
  },
  async () => {
    const s = await stats();
    const breakdown = Object.entries(s.byCategory)
      .map(([cat, count]) => `  - ${cat}: ${count}`)
      .join("\n");
    return {
      content: [{ type: "text", text: `Total memories: ${s.total}\n${breakdown}` }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
