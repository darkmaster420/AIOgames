// Sequel Detection Utility Functions

interface SequelDetectionResult {
  isSequel: boolean;
  sequelType: 'numbered_sequel' | 'named_sequel' | 'expansion' | 'remaster' | 'definitive';
  similarity: number;
  confidence: number;
  baseTitle: string;
  detectedNumber?: number;
  detectedName?: string;
}

// Extract base game title by removing common sequel indicators
function extractBaseTitle(title: string): string {
  return title
    .toLowerCase()
    // Remove scene groups
    .replace(/-[A-Z0-9]{3,}/g, '')
    // Remove bracketed/parenthetical content
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    // Remove common version/edition indicators
    .replace(/\b(goty|game of the year|definitive|ultimate|enhanced|complete|deluxe|premium)\b/gi, '')
    .replace(/\b(remaster|remake|remastered|remade)\b/gi, '')
    .replace(/\b(edition|version|ver)\b/gi, '')
    // Remove numbers and common sequel words at the end
    .replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b$/gi, '')
    .replace(/\b\d+$/g, '')
    // Remove special characters and normalize whitespace
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detect if a game is a sequel of another game
export function detectSequel(originalTitle: string, candidateTitle: string): SequelDetectionResult | null {
  const baseOriginal = extractBaseTitle(originalTitle);
  const baseCandidate = extractBaseTitle(candidateTitle);
  
  if (baseOriginal === baseCandidate) {
    return null; // Same game
  }

  const baseSimilarity = calculateBaseSimilarity(baseOriginal, baseCandidate);
  
  // Check for numbered sequels
  const numberedResult = detectNumberedSequel(baseOriginal, candidateTitle);
  if (numberedResult.isSequel) {
    return {
      isSequel: true,
      sequelType: 'numbered_sequel',
      similarity: baseSimilarity,
      confidence: 0.9,
      baseTitle: baseOriginal,
      detectedNumber: numberedResult.number
    };
  }
  
  // Check for named sequels
  const namedResult = detectNamedSequel(baseOriginal, candidateTitle);
  if (namedResult.isSequel && baseSimilarity > 0.6) {
    return {
      isSequel: true,
      sequelType: 'named_sequel',
      similarity: baseSimilarity,
      confidence: 0.8,
      baseTitle: baseOriginal,
      detectedName: namedResult.subtitle
    };
  }
  
  // Check for expansions
  const expansionResult = detectExpansion(originalTitle, candidateTitle);
  if (expansionResult.isSequel) {
    return {
      isSequel: true,
      sequelType: 'expansion',
      similarity: baseSimilarity,
      confidence: 0.7,
      baseTitle: baseOriginal,
      detectedName: expansionResult.subtitle
    };
  }
  
  // Check for remasters
  const remasterResult = detectRemaster(originalTitle, candidateTitle);
  if (remasterResult.isSequel) {
    return {
      isSequel: true,
      sequelType: remasterResult.type === 'remaster' ? 'remaster' : 'definitive',
      similarity: baseSimilarity,
      confidence: 0.6,
      baseTitle: baseOriginal
    };
  }
  
  return null;
}

function calculateBaseSimilarity(title1: string, title2: string): number {
  const words1 = title1.split(/\s+/).filter(word => word.length > 2);
  const words2 = title2.split(/\s+/).filter(word => word.length > 2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const intersection = words1.filter(word => words2.includes(word));
  
  return intersection.length / Math.max(words1.length, words2.length);
}

function detectNumberedSequel(baseTitle: string, candidateTitle: string): { isSequel: boolean; number?: number } {
  const candidate = candidateTitle.toLowerCase();
  const base = baseTitle.toLowerCase();
  
  // Check for Arabic numerals (Borderlands 2, Grand Theft Auto 5)
  const arabicPattern = new RegExp(`\\b${escapeRegex(base)}\\s+(\\d+)\\b`, 'i');
  const arabicMatch = candidate.match(arabicPattern);
  if (arabicMatch) {
    const num = parseInt(arabicMatch[1]);
    if (num > 1 && num <= 20) { // Reasonable sequel range
      return { isSequel: true, number: num };
    }
  }
  
  // Check for Roman numerals (Grand Theft Auto IV, Civilization VI)
  const romanNumerals = {
    'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10
  };
  
  for (const [roman, num] of Object.entries(romanNumerals)) {
    const romanPattern = new RegExp(`\\b${escapeRegex(base)}\\s+${roman}\\b`, 'i');
    if (candidate.match(romanPattern)) {
      return { isSequel: true, number: num };
    }
  }
  
  return { isSequel: false };
}

function detectNamedSequel(baseTitle: string, candidateTitle: string): { isSequel: boolean; subtitle?: string } {
  const candidate = candidateTitle.toLowerCase();
  const base = baseTitle.toLowerCase();
  
  // Check if candidate starts with base title and has additional words
  if (candidate.startsWith(base)) {
    const remaining = candidate.slice(base.length).trim();
    if (remaining.length > 0) {
      // Filter out common edition/version words
      const filteredRemaining = remaining
        .replace(/^[:\-\s]+/, '') // Remove separators
        .replace(/\b(goty|definitive|ultimate|enhanced|complete|deluxe|premium|edition|version)\b/gi, '')
        .trim();
      
      if (filteredRemaining.length > 2) {
        return { isSequel: true, subtitle: filteredRemaining };
      }
    }
  }
  
  return { isSequel: false };
}

function detectExpansion(originalTitle: string, candidateTitle: string): { isSequel: boolean; subtitle?: string } {
  const expansionKeywords = [
    'dlc', 'expansion', 'addon', 'add-on', 'extended', 'extended edition',
    'season pass', 'episode', 'chapter', 'part'
  ];
  
  for (const keyword of expansionKeywords) {
    if (candidateTitle.includes(keyword)) {
      // Check if base game title is also in the candidate
      const originalBase = extractBaseTitle(originalTitle);
      if (candidateTitle.includes(originalBase)) {
        return { isSequel: true, subtitle: keyword };
      }
    }
  }
  
  return { isSequel: false };
}

function detectRemaster(originalTitle: string, candidateTitle: string): { isSequel: boolean; type?: 'remaster' | 'definitive' } {
  const remasterKeywords = [
    'remaster', 'remastered', 'remake', 'remade',
    'definitive edition', 'enhanced edition', 'ultimate edition',
    'goty', 'game of the year', 'complete edition'
  ];
  
  for (const keyword of remasterKeywords) {
    if (candidateTitle.includes(keyword)) {
      const originalBase = extractBaseTitle(originalTitle);
      if (candidateTitle.includes(originalBase)) {
        if (keyword.includes('remaster') || keyword.includes('remake')) {
          return { isSequel: true, type: 'remaster' };
        } else {
          return { isSequel: true, type: 'definitive' };
        }
      }
    }
  }
  
  return { isSequel: false };
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Get sequel sensitivity threshold based on user preference
export function getSequelThreshold(sensitivity: 'strict' | 'moderate' | 'loose'): number {
  switch (sensitivity) {
    case 'strict': return 0.9;
    case 'moderate': return 0.7;
    case 'loose': return 0.5;
    default: return 0.7;
  }
}

// Test examples for validation
export const SEQUEL_TEST_CASES = [
  // Numbered sequels
  { original: 'Borderlands', candidate: 'Borderlands 2', expected: true, type: 'numbered_sequel' },
  { original: 'Grand Theft Auto', candidate: 'Grand Theft Auto V', expected: true, type: 'numbered_sequel' },
  { original: 'Civilization', candidate: 'Civilization VI', expected: true, type: 'numbered_sequel' },
  
  // Named sequels
  { original: 'Far Cry', candidate: 'Far Cry New Dawn', expected: true, type: 'named_sequel' },
  { original: 'Assassins Creed', candidate: 'Assassins Creed Odyssey', expected: true, type: 'named_sequel' },
  
  // Expansions
  { original: 'The Witcher 3', candidate: 'The Witcher 3 Blood and Wine DLC', expected: true, type: 'expansion' },
  
  // Remasters
  { original: 'Skyrim', candidate: 'Skyrim Special Edition', expected: true, type: 'definitive' },
  { original: 'The Last of Us', candidate: 'The Last of Us Remastered', expected: true, type: 'remaster' },
  
  // Not sequels
  { original: 'Call of Duty', candidate: 'Medal of Honor', expected: false },
  { original: 'Borderlands', candidate: 'Battlefield', expected: false },
];