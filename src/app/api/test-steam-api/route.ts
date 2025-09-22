// Test script for Steam API integration
// Run with: npm run dev then access /api/test-steam-api

import { NextResponse } from 'next/server';
import { searchSteamGames, getSteamGameById, findSteamMatches, extractSteamAppId, getSteamCacheStats } from '../../../utils/steamApi';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const testType = searchParams.get('type') || 'search';
  const query = searchParams.get('q') || 'Silent Hill';

  try {
    const results: Record<string, unknown> = {};

    switch (testType) {
      case 'search':
        console.log(`🧪 Testing Steam API search for: "${query}"`);
        results.searchResults = await searchSteamGames(query, 5);
        break;

      case 'appid':
        console.log(`🧪 Testing Steam API app lookup for ID: ${query}`);
        results.gameDetails = await getSteamGameById(query);
        break;

      case 'match':
        console.log(`🧪 Testing Steam API enhanced matching for: "${query}"`);
        results.matches = await findSteamMatches(query, 0.5, 5);
        break;

      case 'extract':
        console.log(`🧪 Testing Steam App ID extraction from: "${query}"`);
        const extractedIdForCase = extractSteamAppId(query);
        results.extractedId = extractedIdForCase;
        if (extractedIdForCase) {
          results.gameDetails = await getSteamGameById(extractedIdForCase);
        }
        break;

      case 'combined':
        console.log(`🧪 Running comprehensive test for: "${query}"`);
        
        // Test search
        const searchResults = await searchSteamGames(query, 3);
        results.searchResults = searchResults;
        
        // Test enhanced matching
        results.enhancedMatches = await findSteamMatches(query, 0.6, 3);
        
        // If we found results, test app ID lookup on the first one
        if (searchResults.results.length > 0) {
          const firstResult = searchResults.results[0];
          results.appIdLookup = await getSteamGameById(firstResult.appid);
        }
        
        // Test extraction (if query looks like it might contain an ID)
        const extractedIdForCombined = extractSteamAppId(query);
        if (extractedIdForCombined) {
          results.extractedGame = await getSteamGameById(extractedIdForCombined);
        }
        
        break;

      case 'cache':
        results.cacheStats = getSteamCacheStats();
        break;

      default:
        throw new Error(`Unknown test type: ${testType}`);
    }

    results.cacheInfo = getSteamCacheStats();
    results.timestamp = new Date().toISOString();
    results.testType = testType;
    results.query = query;

    return NextResponse.json({
      success: true,
      message: `Steam API ${testType} test completed successfully`,
      results
    });

  } catch (error) {
    console.error(`🧪 Steam API test failed:`, error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      testType,
      query,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// Test different scenarios with specific game titles
export async function POST(request: Request) {
  try {
    const { testGames } = await request.json();
    
    const defaultTestGames = [
      'Silent Hill f',
      'Cyberpunk 2077',
      'The Witcher 3',
      'Baldurs Gate 3',
      'Elden Ring',
      'Hogwarts Legacy'
    ];

    const gamesToTest = testGames || defaultTestGames;
    const testResults = [];

    console.log(`🧪 Running batch Steam API tests on ${gamesToTest.length} games`);

    for (const gameTitle of gamesToTest) {
      try {
        console.log(`🧪 Testing: "${gameTitle}"`);
        
        const searchResult = await searchSteamGames(gameTitle, 3);
        const enhancedMatches = await findSteamMatches(gameTitle, 0.6, 3);
        
        testResults.push({
          gameTitle,
          searchResultCount: searchResult.results.length,
          enhancedMatchCount: enhancedMatches.length,
          topMatch: searchResult.results[0] || null,
          bestEnhancedMatch: enhancedMatches[0] || null,
          searchSource: searchResult.source,
          success: true
        });
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`🧪 Test failed for "${gameTitle}":`, error);
        testResults.push({
          gameTitle,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const successCount = testResults.filter(result => result.success).length;
    const failureCount = testResults.length - successCount;

    return NextResponse.json({
      success: true,
      message: `Batch Steam API test completed`,
      summary: {
        totalGames: gamesToTest.length,
        successful: successCount,
        failed: failureCount,
        successRate: `${Math.round((successCount / gamesToTest.length) * 100)}%`
      },
      testResults,
      cacheInfo: getSteamCacheStats(),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('🧪 Batch Steam API test failed:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}