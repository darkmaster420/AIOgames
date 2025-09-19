// backend/src/api/games.js
import express from "express";
import fetch from "node-fetch";
import jwt from "jsonwebtoken";
import TrackedGame from "../models/trackedGame.js";

const router = express.Router();
const GAMEAPI_URL = "https://gameapi.a7a8524.workers.dev";

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "supersecret");
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ error: "Invalid token" });
  }
}

// Get recent games
router.get("/recent", async (req, res) => {
  try {
    console.log('Fetching recent games from:', `${GAMEAPI_URL}/recent`);
    const response = await fetch(`${GAMEAPI_URL}/recent`);
    if (!response.ok) {
      throw new Error(`Game API returned status ${response.status}`);
    }
    const games = await response.json();
    console.log('Recent games:', games);
    res.json(games);
  } catch (error) {
    console.error('Recent games error:', error);
    res.status(500).json({ error: error.message || "Failed to fetch recent games from API" });
  }
});

// Get all games
router.get("/", authenticateToken, async (req, res) => {
  try {
    const response = await fetch(`${GAMEAPI_URL}/games`);
    const games = await response.json();
    res.json(games);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch games from API" });
  }
});

// Search games
router.get("/search", async (req, res) => {
  try {
    const { search, site } = req.query;
    let url = `${GAMEAPI_URL}?`;
    
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (site && site !== 'all') url += `site=${encodeURIComponent(site)}&`;
    
    console.log('Fetching from:', url);
    const response = await fetch(url.slice(0, -1)); // Remove trailing &
    const results = await response.json();
    console.log('Search results:', results);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: "Search failed" });
  }
});

// Get tracked games with full details
router.get("/tracked", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`Fetching tracked games for user: ${userId}`);
    const trackedGames = await TrackedGame.find({ userId });
    console.log(`Found ${trackedGames.length} tracked games:`, trackedGames);

    if (trackedGames.length === 0) {
      return res.json([]);
    }

    // Fetch full game details by searching for each tracked game
    const trackedWithDetails = await Promise.all(
      trackedGames.map(async (game) => {
        try {
          // Search for the game to get current details
          const searchUrl = `${GAMEAPI_URL}/search?search=${encodeURIComponent(game.title)}&limit=1`;
          console.log(`Searching for game: ${game.title} at ${searchUrl}`);
          const response = await fetch(searchUrl);
          if (response.ok) {
            const data = await response.json();
            console.log(`Search result for ${game.title}:`, data);
            if (data.success && data.results && data.results.length > 0) {
              const gameDetails = data.results[0];
              return {
                ...gameDetails,
                tracked: true,
                trackedSince: game.createdAt,
                originalId: game.gameId
              };
            }
          } else {
            console.log(`Search failed for ${game.title}, status: ${response.status}`);
          }
          // If search fails, return basic tracked info
          return {
            id: game.gameId,
            title: game.title,
            tracked: true,
            trackedSince: game.createdAt,
            excerpt: 'No details available',
            source: 'Unknown'
          };
        } catch (error) {
          console.error(`Failed to fetch details for game ${game.title}:`, error);
          // Return basic info on error
          return {
            id: game.gameId,
            title: game.title,
            tracked: true,
            trackedSince: game.createdAt,
            excerpt: 'Error loading details',
            source: 'Unknown'
          };
        }
      })
    );

    console.log(`Returning ${trackedWithDetails.length} games with details`);
    res.json(trackedWithDetails);
  } catch (error) {
    console.error('Failed to fetch tracked games:', error);
    res.status(500).json({ error: "Failed to fetch tracked games" });
  }
});

// Get all updates (enhanced with better detection)
router.get("/updates", authenticateToken, async (req, res) => {
  try {
    // Get tracked games with updates for the user
    const gamesWithUpdates = await TrackedGame.findWithUpdates(req.user.id);
    
    if (gamesWithUpdates.length === 0) {
      return res.json({ 
        updates: [], 
        count: 0,
        message: "No updates available for tracked games" 
      });
    }

    // Format the updates with enhanced information
    const updates = gamesWithUpdates.map(game => ({
      id: game.gameId,
      title: game.title,
      currentVersion: game.currentVersion,
      lastKnownVersion: game.lastKnownVersion,
      hasUpdates: game.hasUpdates,
      status: game.status,
      lastChecked: game.lastChecked,
      trackedSince: game.dateAdded,
      updateHistory: game.updateHistory.slice(-3), // Last 3 updates
      metadata: game.metadata,
      updateCount: game.updateHistory.length
    }));

    res.json({ 
      updates, 
      count: updates.length,
      lastCheck: new Date()
    });
  } catch (error) {
    console.error('Error fetching updates:', error);
    res.status(500).json({ error: "Failed to fetch updates", details: error.message });
  }
});

// Get game details
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const response = await fetch(`${GAMEAPI_URL}/games/${id}`);
    
    if (!response.ok) {
      return res.status(404).json({ error: "Game not found" });
    }
    
    const game = await response.json();
    res.json(game);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch game details" });
  }
});

// Check for game updates (enhanced version)
router.post("/check-updates", authenticateToken, async (req, res) => {
  try {
    const { gameIds } = req.body; // Array of game IDs to check, optional
    const userId = req.user.id;
    
    let gamesToCheck;
    
    if (gameIds && Array.isArray(gameIds)) {
      // Check specific games
      gamesToCheck = await TrackedGame.find({ 
        gameId: { $in: gameIds }, 
        userId 
      });
    } else {
      // Check all user's tracked games
      gamesToCheck = await TrackedGame.find({ userId });
    }

    if (gamesToCheck.length === 0) {
      return res.json({ 
        message: "No games to check", 
        results: [] 
      });
    }

    const results = [];
    
    for (const game of gamesToCheck) {
      try {
        // Search for current game data
        const searchUrl = `${GAMEAPI_URL}/search?search=${encodeURIComponent(game.title)}&limit=3`;
        const response = await fetch(searchUrl);
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.success && data.results && data.results.length > 0) {
            // Find best matching result
            const bestMatch = findBestTitleMatch(data.results, game.title);
            
            if (bestMatch) {
              // Extract version information
              const currentVersion = extractVersionFromGameData(bestMatch);
              const hasUpdate = game.currentVersion && game.currentVersion !== currentVersion;
              
              // Update the game record if there's an update
              if (hasUpdate) {
                await game.updateVersion(currentVersion, bestMatch.excerpt, {
                  source: bestMatch.source,
                  url: bestMatch.link,
                  lastModified: bestMatch.date ? new Date(bestMatch.date) : new Date()
                });
              } else if (!game.currentVersion) {
                // First time check, set initial version
                game.currentVersion = currentVersion;
                await game.save();
              }
              
              await game.markAsChecked();
              
              results.push({
                gameId: game.gameId,
                title: game.title,
                hasUpdate,
                oldVersion: game.lastKnownVersion || 'Unknown',
                newVersion: currentVersion,
                status: game.status,
                lastChecked: new Date()
              });
            } else {
              results.push({
                gameId: game.gameId,
                title: game.title,
                hasUpdate: false,
                error: "No matching results found",
                status: 'error'
              });
            }
          } else {
            results.push({
              gameId: game.gameId,
              title: game.title,
              hasUpdate: false,
              error: "No search results",
              status: 'error'
            });
          }
        } else {
          results.push({
            gameId: game.gameId,
            title: game.title,
            hasUpdate: false,
            error: `Search failed: ${response.status}`,
            status: 'error'
          });
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        results.push({
          gameId: game.gameId,
          title: game.title,
          hasUpdate: false,
          error: error.message,
          status: 'error'
        });
      }
    }

    res.json({ 
      results, 
      totalChecked: results.length,
      updatesFound: results.filter(r => r.hasUpdate).length,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error('Error in check-updates:', error);
    res.status(500).json({ error: "Failed to check for updates", details: error.message });
  }
});

// Force update check for all user games
router.post("/force-check-all", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const allGames = await TrackedGame.find({ userId });
    
    if (allGames.length === 0) {
      return res.json({ message: "No tracked games to check" });
    }

    // Mark all games as needing check (reset lastChecked)
    await TrackedGame.updateMany(
      { userId }, 
      { lastChecked: new Date(0) } // Force immediate check
    );

    res.json({ 
      message: `Scheduled ${allGames.length} games for immediate update check`,
      gamesCount: allGames.length
    });
    
  } catch (error) {
    console.error('Error in force-check-all:', error);
    res.status(500).json({ error: "Failed to schedule update checks" });
  }
});

// Helper functions
function findBestTitleMatch(results, originalTitle) {
  if (!results || results.length === 0) return null;
  
  const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const normalizedOriginal = normalize(originalTitle);
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const result of results) {
    const normalizedResult = normalize(result.title);
    
    if (normalizedResult === normalizedOriginal) {
      return result; // Exact match
    }
    
    // Calculate simple similarity score
    const score = calculateStringSimilarity(normalizedOriginal, normalizedResult);
    if (score > bestScore && score > 0.6) {
      bestScore = score;
      bestMatch = result;
    }
  }
  
  return bestMatch;
}

function calculateStringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

function extractVersionFromGameData(gameData) {
  // Strategy 1: Look for version in title
  const titleVersionMatch = gameData.title.match(/v?(\d+\.?\d*\.?\d*)/i);
  if (titleVersionMatch) {
    return titleVersionMatch[1];
  }
  
  // Strategy 2: Look for date in title or data
  if (gameData.date) {
    return new Date(gameData.date).toISOString().split('T')[0];
  }
  
  // Strategy 3: Use post ID
  if (gameData.id) {
    return gameData.id.toString();
  }
  
  // Strategy 4: Look in excerpt
  if (gameData.excerpt) {
    const excerptVersionMatch = gameData.excerpt.match(/version?\s*:?\s*v?(\d+\.?\d*\.?\d*)/i);
    if (excerptVersionMatch) {
      return excerptVersionMatch[1];
    }
  }
  
  // Fallback: use current timestamp
  return Date.now().toString();
}

// Track a game
router.post("/track", authenticateToken, async (req, res) => {
  try {
    const { gameId, title } = req.body;
    const userId = req.user.id;

    if (!gameId || !title) {
      return res.status(400).json({ error: "gameId and title are required" });
    }

    const trackedGame = new TrackedGame({
      gameId,
      userId,
      title
    });

    await trackedGame.save();
    res.status(201).json(trackedGame);
  } catch (error) {
    if (error.code === 11000) { // Duplicate key error
      res.status(409).json({ error: "Game is already being tracked" });
    } else {
      res.status(500).json({ error: "Failed to track game" });
    }
  }
});

// Untrack a game
router.delete("/track/:gameId", authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.id;

    const result = await TrackedGame.findOneAndDelete({ gameId, userId });
    if (!result) {
      return res.status(404).json({ error: "Game not found or not tracked" });
    }

    res.json({ message: "Game untracked successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to untrack game" });
  }
});

export default router;