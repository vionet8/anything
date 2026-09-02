import { pipeline, env } from "@huggingface/transformers";
import { EMBEDDING_MODEL, MODEL_CACHE_DIR } from "./config.js";

// Keep the model weights inside our own directory instead of the default
// ~/.cache/huggingface, so the whole "AI secretary" install is self-contained.
env.cacheDir = MODEL_CACHE_DIR;

let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", EMBEDDING_MODEL, {
      dtype: "q8",
    });
  }
  return extractorPromise;
}

/**
 * Embeds text into a normalized vector suitable for cosine-similarity search.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}
