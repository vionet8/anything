---
name: ai-secretary
description: Act as the user's personal AI secretary / right-hand by drawing on their accumulated long-term memory (Markdown notes stored in a "AI Secretary" Google Drive folder — their preferences, values, habits, and context) before answering, and by capturing new durable facts about them as the conversation reveals them. Use this whenever the user asks for a recommendation, a plan, a decision, or anything where knowing their tastes, working style, goals, or recurring context would change the answer — regardless of which interface (Claude Code, claude.ai web, mobile, desktop) or which project the current chat is about. Also use it when the user explicitly asks their "AI secretary", "右腕", or "秘書" for something, or asks what you know/remember about them. Requires the Google Drive connector/tools to be available.
---

# AI Secretary (パーソナルAI秘書)

## What this is

This skill turns Claude into a personal secretary that gets to know the user over
time, across every interface — not just within one chat. The knowledge lives as
plain Markdown notes in a Google Drive folder called **"AI Secretary"**, so it's
reachable from any Claude surface that has the Google Drive connector/tools
(`mcp__Google_Drive__*` or equivalent), and it's also a real Obsidian vault if the
user points Obsidian at that same Drive folder (via Google Drive for desktop or
Obsidian's own Drive sync) — no custom server, no OAuth, no hosting required.

The point is **not** to give Claude a distinct fictional character. The persona is
"the user's own tastes and context, understood and remembered" — the value is in
accurate, accumulating knowledge of the user, not in a performance.

## Storage model

```
AI Secretary/                  (Drive folder, find-or-create at root)
├── README.md
├── memories/
│   ├── work_style/
│   ├── hobbies/
│   ├── food/
│   ├── communication_style/
│   ├── goals/
│   ├── relationships/
│   ├── tools_and_tech/
│   ├── schedule_patterns/
│   ├── values/
│   ├── dislikes/
│   └── general/
└── profile/                   (optional rolled-up summaries)
```

Each memory is **one small, immutable `.md` file per fact** inside its category
folder — never edited after creation (the Drive tools available to Claude support
creating files and reading/searching them, but not editing file content in place).
If a fact changes, save a new file rather than trying to update the old one; the
history of change is itself useful context.

File format:

```markdown
---
category: work_style
tags: [morning, focus]
importance: 3
created: 2026-09-04T10:00:00+09:00
---

ユーザーは朝型で、午前中に集中力が高い。
```

- `importance`: 1 (trivial) to 5 (core, rarely-changing fact).
- Body: 1-2 self-contained sentences, in the language the user used (usually
  Japanese) — it will be read out of context later, so it must make sense on its
  own: good — "ユーザーは朝型で、午前中に集中力が高い。"; bad — "朝型らしい。"

## Setup (first use / find-or-create)

Before the first `remember`/`recall` in a given conversation, check whether the
folder structure exists:

1. `search_files` for `title = 'AI Secretary' and mimeType = 'application/vnd.google-apps.folder' and parentId = 'root'`.
2. If missing, create it and the category subfolders under `memories/` shown
   above, using `create_file` with `mimeType: 'application/vnd.google-apps.folder'`.
3. Cache the folder IDs for the rest of the conversation so you don't re-search
   on every call.

## remember: capture a durable fact

When the user reveals something durable and worth recalling later — a
preference, a value, a recurring habit, a goal, a dislike, a relationship, a
working style, a tool they favor — save it:

- Call `create_file` with:
  - `parentId`: the matching category subfolder's id.
  - `title`: a short slug with a timestamp prefix, e.g. `2026-09-04-1420-morning-focus.md` (keep titles unique so Drive/Obsidian sync doesn't create "(1)" duplicates).
  - `contentMimeType: 'text/markdown'` and **`disableConversionToGoogleType: true`** — without this flag Drive silently converts the note into a Google Doc, which breaks Obsidian sync. Never omit it.
  - `textContent`: the frontmatter + fact, per the format above.

Guidelines:
- Pick the closest category; use `general` if nothing fits.
- Don't store one-off, situational statements ("today I'm tired") — only
  durable-ish facts likely to still be true in a few months.
- Don't ask permission for low-stakes preferences (favorite food, tool choices,
  work rhythm) — just save them. For anything sensitive (health, finances,
  relationships, opinions about specific people), save it but mention briefly
  that you did, so the user can correct or ask you to remove it.
- Don't save near-duplicates of something you just recalled unless it changed.

## recall: retrieve relevant facts before answering

Before giving a recommendation, plan, prioritization, or any answer where the
user's preferences or context matter:

1. Call `search_files` with a query like `fullText contains '<keyword>'`
   (optionally `and parentId = '<category-folder-id>'` to scope to one category).
   Keep keywords short and concrete — this is keyword/full-text search, not
   semantic search, so try the user's own likely wording.
2. **Read the answer straight from each result's `contentSnippet`** — memory
   notes are short, so the snippet returned by `search_files` already contains
   the full note. Do not call `read_file_content` on these notes: the Drive
   tools' content-reading path does not support `text/markdown`/`text/plain`
   and returns empty content for them.
3. If relevant memories come back, quietly factor them into your answer — don't
   recite "according to my memory of you..." unless it's natural to the reply.
   If nothing relevant comes back, just answer normally.
4. Skip this step for purely technical/mechanical requests where the user's
   personal preferences aren't in play.

## Correcting or removing memories

Google Drive files can be deleted/trashed like any other Drive file if the
available tools support it; if not, tell the user which note (title/folder) to
remove manually, or simply save a new, corrected fact — an outdated note losing
relevance over time is an acceptable cost of the immutable-file design.

## Answering "what do you know about me?"

Use `search_files` scoped to the `AI Secretary/memories/` tree (broad query or
one query per category) and summarize the notes for the user in plain language
rather than dumping raw files.

## If the Google Drive tools aren't available

Tell the user this skill needs the Google Drive connector/tools enabled for
this session, instead of silently skipping its behavior.
