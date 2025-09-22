// Test script to demonstrate enhanced piracy tag handling

function cleanTitle(title) {
  return title
    .toLowerCase()
    // Remove common piracy/release tags first
    .replace(/\b(denuvoless|cracked|repack|fitgirl|dodi|empress|codex|skidrow|plaza)\b/gi, '')
    .replace(/\b(free download|full version|complete edition)\b/gi, '')
    .replace(/\b(all dlc|with dlc|dlc included)\b/gi, '')
    .replace(/\b(pre-installed|preinstalled)\b/gi, '')
    .replace(/\b(update \d+|hotfix|patch)\b/gi, '')
    // Remove common edition tags that don't affect core identity
    .replace(/\b(deluxe|digital deluxe|premium|ultimate|collectors?)\s+edition\b/gi, '')
    .replace(/\b(goty|game of the year)\s+edition\b/gi, '')
    // Remove year tags like (2023), (2024) etc
    .replace(/\(\d{4}\)/g, '')
    // Remove scene groups
    .replace(/-[A-Z0-9]{3,}/g, '') 
    // Remove bracketed/parenthetical content
    .replace(/\[[^\]]*\]/g, '')    
    .replace(/\([^)]*\)/g, '')     
    // Normalize apostrophes and dashes
    .replace(/[']/g, '')           // Remove apostrophes (Assassin's -> Assassins)
    .replace(/[-:]/g, ' ')         // Convert dashes/colons to spaces
    // Remove version indicators
    .replace(/\bv?\d+\.\d+(?:\.\d+)*\b/gi, '')
    // Remove special characters and normalize
    .replace(/[^\w\s]/g, ' ')       
    .replace(/\s+/g, ' ')          
    .trim();
}

function calculateSimilarity(title1, title2) {
  const clean1 = cleanTitle(title1);
  const clean2 = cleanTitle(title2);
  
  console.log(`Original 1: "${title1}"`);
  console.log(`Cleaned 1:  "${clean1}"`);
  console.log(`Original 2: "${title2}"`);
  console.log(`Cleaned 2:  "${clean2}"`);
  
  if (clean1 === clean2) return 1.0;
  
  // Exact substring matches (high score)
  if (clean1.includes(clean2) || clean2.includes(clean1)) {
    const shorter = Math.min(clean1.length, clean2.length);
    const longer = Math.max(clean1.length, clean2.length);
    return Math.max(0.85, shorter / longer * 0.95); // Ensure high scores for substring matches
  }
  
  // Word-based similarity with enhanced scoring
  const words1 = clean1.split(/\s+/).filter(word => word.length > 1);
  const words2 = clean2.split(/\s+/).filter(word => word.length > 1);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  // Calculate exact word matches
  const exactMatches = words1.filter(word => words2.includes(word));
  
  // Calculate fuzzy matches for common variations
  let fuzzyMatches = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      if (!exactMatches.includes(word1) && !exactMatches.includes(word2)) {
        // Check for partial matches on longer words
        if (word1.length >= 4 && word2.length >= 4) {
          if (word1.includes(word2) || word2.includes(word1)) {
            fuzzyMatches += 0.7; // Partial credit for fuzzy matches
            break;
          }
        }
      }
    }
  }
  
  const totalMatches = exactMatches.length + fuzzyMatches;
  const union = [...new Set([...words1, ...words2])];
  const jaccard = totalMatches / union.length;
  
  // Boost score for games with similar word count
  const wordCountSimilarity = 1 - Math.abs(words1.length - words2.length) / Math.max(words1.length, words2.length);
  
  // Enhanced scoring with higher weight on word matches
  return Math.min(1.0, (jaccard * 0.85) + (wordCountSimilarity * 0.15));
}

// Test cases with piracy tags
const testCases = [
  {
    piracy: "Assassins Creed Mirage (2023) Denuvoless + ALL DLC",
    steam: "Assassin's Creed Mirage"
  },
  {
    piracy: "Cyberpunk 2077 v2.1 EMPRESS Cracked Full Version",
    steam: "Cyberpunk 2077"
  },
  {
    piracy: "The Witcher 3 Wild Hunt GOTY FitGirl Repack",
    steam: "The Witcher 3: Wild Hunt - Game of the Year Edition"
  },
  {
    piracy: "Hogwarts Legacy Deluxe Edition (2023) Pre-Installed",
    steam: "Hogwarts Legacy"
  },
  {
    piracy: "Baldurs Gate 3 Digital Deluxe Edition v4.1.1.5622896 + ALL DLC",
    steam: "Baldur's Gate 3"
  }
];

console.log("🧪 Testing Enhanced Piracy Tag Handling\n");
console.log("=" .repeat(60));

testCases.forEach((testCase, index) => {
  console.log(`\nTest ${index + 1}:`);
  console.log("-".repeat(40));
  
  const similarity = calculateSimilarity(testCase.piracy, testCase.steam);
  
  console.log(`Similarity Score: ${similarity.toFixed(3)} (${Math.round(similarity * 100)}%)`);
  console.log(`Result: ${similarity > 0.8 ? '✅ HIGH MATCH' : similarity > 0.6 ? '🟡 MEDIUM MATCH' : '❌ LOW MATCH'}`);
  console.log("");
});

console.log("🎉 Testing completed!");
console.log("\nKey improvements:");
console.log("- Removes 'Denuvoless', 'Cracked', 'Repack', etc.");
console.log("- Handles year tags like '(2023)'");
console.log("- Cleans 'ALL DLC', 'Full Version', 'Pre-Installed'");
console.log("- Normalizes scene group and version tags");
console.log("- Better word-based similarity matching");