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
router.get("/search", authenticateToken, async (req, res) => {
  try {
    const { q, genre, platform } = req.query;
    let url = `${GAMEAPI_URL}/games/search?`;
    
    if (q) url += `q=${encodeURIComponent(q)}&`;
    if (genre) url += `genre=${encodeURIComponent(genre)}&`;
    if (platform) url += `platform=${encodeURIComponent(platform)}&`;
    
    const response = await fetch(url.slice(0, -1)); // Remove trailing &
    const results = await response.json();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: "Search failed" });
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

// Get all updates
router.get("/updates", authenticateToken, async (req, res) => {
  try {
    const response = await fetch(`${GAMEAPI_URL}/games/updates`);
    const updates = await response.json();
    res.json(updates);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch updates" });
  }
});

// Check for game updates
router.post("/check-updates", authenticateToken, async (req, res) => {
  try {
    const { gameIds } = req.body; // Array of game IDs to check
    
    if (!gameIds || !Array.isArray(gameIds)) {
      return res.status(400).json({ error: "gameIds array required" });
    }

    const updatePromises = gameIds.map(async (id) => {
      try {
        const response = await fetch(`${GAMEAPI_URL}/games/${id}/updates`);
        if (response.ok) {
          const updates = await response.json();
          return { gameId: id, updates, hasUpdates: updates.length > 0 };
        }
        return { gameId: id, updates: [], hasUpdates: false };
      } catch (error) {
        return { gameId: id, updates: [], hasUpdates: false, error: error.message };
      }
    });

    const results = await Promise.all(updatePromises);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to check for updates" });
  }
});

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

// Get tracked games
router.get("/tracked", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const trackedGames = await TrackedGame.find({ userId });
    res.json(trackedGames);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tracked games" });
  }
});

export default router;