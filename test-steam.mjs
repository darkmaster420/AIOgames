// Simple test script for Steam API functions
import { searchSteamGames, getSteamGameById, findSteamMatches } from '../src/utils/steamApi.js';

async function testSteamApi() {
  try {
    console.log('🧪 Testing Steam API integration...\n');
    
    // Test 1: Search for a popular game
    console.log('Test 1: Searching for "Cyberpunk 2077"');
    const searchResult = await searchSteamGames('Cyberpunk 2077', 3);
    console.log(`✓ Found ${searchResult.results.length} results from ${searchResult.source}`);
    if (searchResult.results.length > 0) {
      console.log(`  Top result: "${searchResult.results[0].name}" (${searchResult.results[0].appid})`);
    }
    console.log('');
    
    // Test 2: Get game by App ID
    console.log('Test 2: Getting game by App ID 1091500 (Cyberpunk 2077)');
    const gameById = await getSteamGameById('1091500');
    console.log(`✓ Found game: "${gameById.name}"`);
    console.log(`  Type: ${gameById.type}`);
    console.log(`  Developers: ${gameById.developers?.join(', ') || 'N/A'}`);
    console.log('');
    
    // Test 3: Enhanced matching
    console.log('Test 3: Enhanced matching for "Silent Hill f"');
    const matches = await findSteamMatches('Silent Hill f', 0.5, 3);
    console.log(`✓ Found ${matches.length} enhanced matches`);
    matches.forEach((match, index) => {
      console.log(`  ${index + 1}. "${match.name}" (similarity: ${match.similarity.toFixed(2)}, confidence: ${match.confidence.toFixed(2)})`);
    });
    console.log('');
    
    console.log('🎉 All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testSteamApi();