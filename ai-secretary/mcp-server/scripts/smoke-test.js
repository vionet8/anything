import { remember, recall, stats, listRecent } from "../src/store.js";

async function main() {
  await remember({ text: "ユーザーはカレーライスが好物で、辛口を好む。", category: "food" });
  await remember({ text: "ユーザーは朝型で、午前中に集中力が高い。", category: "work_style" });
  await remember({ text: "ユーザーは登山が趣味で、月1回は山に行く。", category: "hobbies" });

  const results = await recall({ query: "週末におすすめのアクティビティは?", topK: 2 });
  console.log("recall results:", JSON.stringify(results, null, 2));

  const recent = await listRecent({ limit: 5 });
  console.log("recent count:", recent.length);

  const s = await stats();
  console.log("stats:", s);

  if (results.length === 0) {
    throw new Error("recall returned no results — vector search is not working");
  }
  const topCategories = results.map((r) => r.category);
  if (!topCategories.includes("hobbies")) {
    console.warn("WARNING: expected 'hobbies' memory to rank near the top for an activity question");
  }
  console.log("SMOKE TEST OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
