/**
 * Test script for sequel/variant detection system
 * 
 * This demonstrates how the app now handles games with similar names:
 * - Assetto Corsa vs Assetto Corsa Evo
 * - Hollow Knight vs Hollow Knight Silksong
 * - Resident Evil 2 vs Resident Evil 2 Remake
 * 
 * Run with: node test-sequel-detection.js
 */

// Simulate the areTitlesRelated function (updated: requires min 2 words)
function areTitlesRelated(title1, title2) {
  const clean1 = title1.toLowerCase().trim();
  const clean2 = title2.toLowerCase().trim();
  
  if (clean1 === clean2) {
    return false;
  }
  
  const words1 = clean1.split(/\s+/);
  const words2 = clean2.split(/\s+/);
  
  // Both titles must have at least 2 words
  if (words1.length < 2 || words2.length < 2) {
    return false;
  }
  
  const shorter = words1.length <= words2.length ? words1 : words2;
  const longer = words1.length <= words2.length ? words2 : words1;
  
  // Don't trigger if same length
  if (shorter.length === longer.length) {
    return false;
  }
  
  if (shorter.length < 2) {
    return false;
  }
  
  const isSubset = (shorter, longer) => {
    let longerIndex = 0;
    for (const word of shorter) {
      let found = false;
      for (let i = longerIndex; i < longer.length; i++) {
        if (longer[i] === word) {
          found = true;
          longerIndex = i + 1;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  };
  
  return isSubset(shorter, longer);
}

// Test cases
const testCases = [
  // Should detect as related (sequels/variants)
  { title1: "Assetto Corsa", title2: "Assetto Corsa Evo", expected: true },
  { title1: "Hollow Knight", title2: "Hollow Knight Silksong", expected: true },
  { title1: "Dragon Ball Sparking Zero", title2: "Dragon Ball", expected: true },
  { title1: "Resident Evil 2", title2: "Resident Evil 2 Remake", expected: true },
  { title1: "Cities Skylines", title2: "Cities Skylines 2", expected: true },
  
  // Should NOT detect as related (different games)
  { title1: "Call of Duty", title2: "Battlefield", expected: false },
  { title1: "FIFA 23", title2: "PES 2023", expected: false },
  { title1: "Assassin's Creed", title2: "Prince of Persia", expected: false },
  
  // Edge cases
  { title1: "The Witcher 3", title2: "The Witcher 3", expected: false }, // Same game
  { title1: "GTA V", title2: "GTA Vice City", expected: false }, // Different words
  
  // Single-word games should NEVER trigger false matches
  { title1: "Dusk", title2: "Before Dusk", expected: false },
  { title1: "Dusk", title2: "Dusk Chronicles", expected: false },
  { title1: "Portal", title2: "Portal 2", expected: false }, // Single word vs 2 words
];

console.log("🔍 Sequel/Variant Detection Test\n");
console.log("=".repeat(60));

let passed = 0;
let failed = 0;

testCases.forEach(({ title1, title2, expected }) => {
  const result = areTitlesRelated(title1, title2);
  const status = result === expected ? "✅ PASS" : "❌ FAIL";
  
  if (result === expected) {
    passed++;
  } else {
    failed++;
  }
  
  console.log(`\n${status}`);
  console.log(`  Title 1: "${title1}"`);
  console.log(`  Title 2: "${title2}"`);
  console.log(`  Expected: ${expected}, Got: ${result}`);
  
  if (result) {
    console.log(`  → Related games detected - Will use Steam API to differentiate`);
  }
});

console.log("\n" + "=".repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

// Example workflow
console.log("=".repeat(60));
console.log("\n📝 How it works in the app:\n");
console.log("1. User tries to track 'Assetto Corsa Evo'");
console.log("2. App detects user already tracks 'Assetto Corsa'");
console.log("3. App calls Steam API to search both titles");
console.log("4. Steam API returns:");
console.log("   - Assetto Corsa (Steam ID: 244210)");
console.log("   - Assetto Corsa Evo (Steam ID: 1870050)");
console.log("5. Different IDs = distinct games ✅");
console.log("6. Both games stored with their Steam IDs");
console.log("7. No conflict - user can track both!\n");
