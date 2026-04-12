import fs from "node:fs";
import path from "node:path";

/** @type {readonly string[]} Official GoEmotions labels (incl. neutral) */
export const GO_EMOTIONS = [
  "admiration",
  "amusement",
  "anger",
  "annoyance",
  "approval",
  "caring",
  "confusion",
  "curiosity",
  "desire",
  "disappointment",
  "disapproval",
  "disgust",
  "embarrassment",
  "excitement",
  "fear",
  "gratitude",
  "grief",
  "joy",
  "love",
  "nervousness",
  "optimism",
  "pride",
  "realization",
  "relief",
  "remorse",
  "sadness",
  "surprise",
  "neutral",
];

const POSITIVE = new Set([
  "admiration",
  "amusement",
  "approval",
  "caring",
  "excitement",
  "gratitude",
  "joy",
  "love",
  "optimism",
  "pride",
  "relief",
  "desire",
  "curiosity",
]);

const NEGATIVE = new Set([
  "anger",
  "annoyance",
  "disappointment",
  "disapproval",
  "disgust",
  "embarrassment",
  "fear",
  "grief",
  "nervousness",
  "remorse",
  "sadness",
]);

/**
 * Parse emotion_words.csv (GoEmotions release) into word → [{ emotion, weight }].
 * @param {string} csvPath
 * @returns {Map<string, Array<{ emotion: string, weight: number }>>}
 */
export function loadEmotionWordIndex(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const index = new Map();
  const lines = raw.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const emotion = parts[0].toLowerCase().trim();
    const word = parts[1].toLowerCase().trim();
    const weight = parseFloat(parts[2]);
    if (!emotion || !word || Number.isNaN(weight)) continue;
    if (!index.has(word)) index.set(word, []);
    index.get(word).push({ emotion, weight });
  }
  return index;
}

/**
 * @param {Map<string, Array<{ emotion: string, weight: number }>>} index
 * @param {string} text
 */
export function analyzeWithLexicon(index, text) {
  /** @type {Record<string, number>} */
  const scores = Object.fromEntries(GO_EMOTIONS.map((e) => [e, 0]));
  const tokens = text.toLowerCase().match(/\b[a-z']+\b/g) || [];
  for (const t of tokens) {
    const hits = index.get(t);
    if (!hits) continue;
    for (const { emotion, weight } of hits) {
      if (scores[emotion] !== undefined) scores[emotion] += weight;
    }
  }

  const nonNeutral = GO_EMOTIONS.filter((e) => e !== "neutral");
  let dominant = nonNeutral.reduce((best, e) => (scores[e] > scores[best] ? e : best), nonNeutral[0]);
  if (scores[dominant] <= 0) dominant = "neutral";

  const totalRaw = GO_EMOTIONS.reduce((s, e) => s + scores[e], 0);
  /** @type {Record<string, number>} */
  const emotions = Object.fromEntries(GO_EMOTIONS.map((e) => [e, 0]));

  if (totalRaw <= 0) {
    emotions.neutral = 100;
    return {
      emotions,
      dominant: "neutral",
      sentiment: "neutral",
      source: "goemotions_lexicon",
    };
  }

  for (const e of GO_EMOTIONS) {
    emotions[e] = Math.round((scores[e] / totalRaw) * 100);
  }

  let pos = 0;
  let neg = 0;
  for (const e of GO_EMOTIONS) {
    const p = emotions[e] || 0;
    if (POSITIVE.has(e)) pos += p;
    if (NEGATIVE.has(e)) neg += p;
  }
  let sentiment = "neutral";
  if (pos > neg * 1.15) sentiment = "positive";
  else if (neg > pos * 1.15) sentiment = "negative";

  return {
    emotions,
    dominant,
    sentiment,
    source: "goemotions_lexicon",
  };
}

export function defaultLexiconPath(rootDir) {
  return path.join(rootDir, "server", "data", "emotion_words.csv");
}
