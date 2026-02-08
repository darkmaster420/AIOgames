/**
 * Game title matching utilities.
 *
 * The main export — `calculateGameSimilarity` — is used by both the bulk and
 * single update-check routes.  It replaces the naïve substring check that
 * previously caused e.g. "Risk of Rain" to incorrectly match "Risk of Rain 2"
 * (and vice-versa).
 */

import { cleanGameTitle } from './steamApi';

// ── Sequel / number helpers ─────────────────────────────────────────────

/** Map of roman numerals that commonly appear in game titles → arabic. */
const ROMAN_MAP: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5,
  vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15,
};

/**
 * Extract a trailing sequel number from a cleaned, lower-cased title.
 *
 * Returns `{ base, number }` where `number` is the detected sequel number
 * (arabic or roman → arabic), or `null` if no sequel indicator was found.
 *
 * Examples:
 *   "risk of rain 2"       → { base: "risk of rain", number: 2 }
 *   "grand theft auto v"   → { base: "grand theft auto", number: 5 }
 *   "borderlands"          → null
 */
function extractSequelNumber(title: string): { base: string; number: number } | null {
  const words = title.split(/\s+/);
  if (words.length < 2) return null;

  const last = words[words.length - 1];

  // Arabic number at end (1-99)
  if (/^\d{1,2}$/.test(last)) {
    const num = parseInt(last, 10);
    if (num >= 1 && num <= 99) {
      return { base: words.slice(0, -1).join(' '), number: num };
    }
  }

  // Roman numeral at end
  const roman = ROMAN_MAP[last];
  if (roman !== undefined) {
    return { base: words.slice(0, -1).join(' '), number: roman };
  }

  return null;
}

/**
 * Returns `true` when the "extra" text that one title has beyond the other
 * looks like a sequel indicator — i.e. a number, roman numeral, colon +
 * subtitle, or another named-sequel pattern.
 *
 * We intentionally keep this check broad: if there is *any* meaningful
 * additional content the titles should be treated as different games.
 */
function isSequelDifference(remaining: string): boolean {
  const r = remaining.trim();
  if (r.length === 0) return false;

  // Starts with a number or roman numeral?
  if (/^\d{1,2}\b/.test(r)) return true;
  if (ROMAN_MAP[r.split(/\s+/)[0]] !== undefined) return true;

  // Any non-trivial word(s) left means it's a different game (subtitle etc.)
  // Filter out noise words that are just edition markers we already handle
  const editionNoise = /^(goty|game of the year|definitive|ultimate|enhanced|complete|deluxe|premium|edition|version|remaster|remastered|remake)$/i;
  const meaningful = r.split(/\s+/).filter(w => w.length > 1 && !editionNoise.test(w));
  if (meaningful.length > 0) return true;

  return false;
}

// ── Main similarity function ────────────────────────────────────────────

/**
 * Calculate how similar two game titles are, returning 0..1.
 *
 * Key behaviour changes vs the old version:
 *  - A substring match where the extra part is a sequel number/subtitle
 *    returns a **low** score (0.3) instead of 0.85.
 *  - True substring matches (e.g. same game, just one title has more tags)
 *    still get 0.85.
 */
export function calculateGameSimilarity(title1: string, title2: string): number {
  const clean1 = cleanGameTitle(title1).toLowerCase();
  const clean2 = cleanGameTitle(title2).toLowerCase();

  // Exact match after cleaning
  if (clean1 === clean2) return 1.0;

  // ── Sequel-number fast path ──────────────────────────────────────────
  // If both titles have a sequel number and their bases match, compare
  // the numbers.  Same number → 1.0, different number → 0.3.
  const seq1 = extractSequelNumber(clean1);
  const seq2 = extractSequelNumber(clean2);

  if (seq1 && seq2 && seq1.base === seq2.base) {
    return seq1.number === seq2.number ? 1.0 : 0.3;
  }

  // One has a number and the other doesn't, but bases match
  // → different games ("Risk of Rain" vs "Risk of Rain 2")
  if (seq1 && !seq2 && seq1.base === clean2) return 0.3;
  if (seq2 && !seq1 && seq2.base === clean1) return 0.3;

  // ── Substring check (sequel-aware) ───────────────────────────────────
  const oneContainsTwo = clean1.includes(clean2);
  const twoContainsOne = clean2.includes(clean1);

  if (oneContainsTwo || twoContainsOne) {
    // Determine the longer and shorter titles
    const longer  = oneContainsTwo ? clean1 : clean2;
    const shorter = oneContainsTwo ? clean2 : clean1;
    const remaining = longer.replace(shorter, '').trim();

    // If the remaining part looks like a sequel indicator, these are
    // different games — return low similarity.
    if (isSequelDifference(remaining)) {
      return 0.3;
    }

    // Otherwise it's likely the same game with extra tags/noise
    return 0.85;
  }

  // ── Word overlap (Jaccard) ───────────────────────────────────────────
  const words1 = clean1.split(/\s+/).filter(w => w.length > 1);
  const words2 = clean2.split(/\s+/).filter(w => w.length > 1);

  if (words1.length === 0 || words2.length === 0) return 0;

  const intersection = words1.filter(word => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];

  return intersection.length / union.length;
}
