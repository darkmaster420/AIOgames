// Quick test for version suffix handling
// Run with: node test-version-suffix.js

// Test cleanGameTitle
function cleanGameTitle(title) {
  return title
    .toLowerCase()
    .replace(/\b(denuvoless|cracked|repack|fitgirl|dodi|empress|codex|skidrow|plaza|rune|tenoke|p2p|0xdeadcode)\b/gi, '')
    // Version patterns with letter suffixes
    .replace(/v\d+(?:\.\d+)*(?:\.[a-z])?(?:-[A-Z0-9]+)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Test version extraction regex
const versionPattern = /v(\d+(?:\.\d+)+(?:\.[a-z])?(?:[-_]?(?:alpha|beta|rc|pre|preview|dev|final|release|hotfix|patch)(?:\d+)?)?)/i;

// Test cases
const testCases = [
  { input: 'PEAK v1.33.a-0xdeadcode', expectedClean: 'peak', expectedVersion: '1.33.a' },
  { input: 'Game v2.0.1.b-CODEX', expectedClean: 'game', expectedVersion: '2.0.1.b' },
  { input: 'Test v1.5a-P2P', expectedClean: 'test', expectedVersion: '1.5a' },
  { input: 'Another v3.2-beta', expectedClean: 'another', expectedVersion: '3.2-beta' },
];

console.log('Testing Version Suffix Handling\n');
console.log('='.repeat(60));

let allPassed = true;

testCases.forEach((test, index) => {
  console.log(`\nTest ${index + 1}: "${test.input}"`);
  
  // Test clean title
  const cleaned = cleanGameTitle(test.input);
  const cleanMatch = cleaned === test.expectedClean;
  console.log(`  Clean Title: "${cleaned}" ${cleanMatch ? '✅' : '❌ Expected: "' + test.expectedClean + '"'}`);
  
  // Test version extraction
  const match = test.input.match(versionPattern);
  const version = match ? match[1] : null;
  const versionMatch = version === test.expectedVersion;
  console.log(`  Version: "${version || 'not found'}" ${versionMatch ? '✅' : '❌ Expected: "' + test.expectedVersion + '"'}`);
  
  if (!cleanMatch || !versionMatch) {
    allPassed = false;
  }
});

console.log('\n' + '='.repeat(60));
console.log(allPassed ? '\n✅ All tests passed!' : '\n❌ Some tests failed!');
