import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(__dirname, "../../storage-config.json");

// Default storage configuration
const defaultConfig = {
  downloadPaths: {
    aria2: "/downloads/aria2",
    qbittorrent: "/downloads/qbittorrent", 
    jdownloader: "/downloads/jdownloader"
  },
  tempPath: "/downloads/temp",
  completedPath: "/downloads/completed",
  categories: {
    games: "/downloads/games",
    software: "/downloads/software",
    media: "/downloads/media",
    other: "/downloads/other"
  }
};

// Load storage configuration
async function loadConfig() {
  try {
    const data = await fs.readFile(configFile, 'utf8');
    return { ...defaultConfig, ...JSON.parse(data) };
  } catch (error) {
    // If file doesn't exist, return default config
    return defaultConfig;
  }
}

// Save storage configuration
async function saveConfig(config) {
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
}

// Get storage configuration
router.get("/", async (req, res) => {
  try {
    const config = await loadConfig();
    
    // Check if directories exist and get their status
    const status = {};
    for (const [service, dirPath] of Object.entries(config.downloadPaths)) {
      try {
        await fs.access(dirPath);
        const stats = await fs.stat(dirPath);
        status[service] = {
          path: dirPath,
          exists: true,
          writable: true, // We'll assume writable if accessible
          isDirectory: stats.isDirectory()
        };
      } catch (error) {
        status[service] = {
          path: dirPath,
          exists: false,
          writable: false,
          isDirectory: false,
          error: error.message
        };
      }
    }
    
    res.json({
      config,
      status
    });
  } catch (error) {
    console.error('Error getting storage config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update storage configuration
router.put("/", async (req, res) => {
  try {
    const newConfig = req.body;
    
    // Validate configuration
    if (!newConfig.downloadPaths || typeof newConfig.downloadPaths !== 'object') {
      return res.status(400).json({ error: 'Invalid downloadPaths configuration' });
    }
    
    // Create directories if they don't exist
    for (const [service, dirPath] of Object.entries(newConfig.downloadPaths)) {
      try {
        await fs.mkdir(dirPath, { recursive: true });
        console.log(`Created directory: ${dirPath}`);
      } catch (error) {
        console.warn(`Failed to create directory ${dirPath}:`, error.message);
      }
    }
    
    // Create category directories if specified
    if (newConfig.categories) {
      for (const [category, dirPath] of Object.entries(newConfig.categories)) {
        try {
          await fs.mkdir(dirPath, { recursive: true });
          console.log(`Created category directory: ${dirPath}`);
        } catch (error) {
          console.warn(`Failed to create category directory ${dirPath}:`, error.message);
        }
      }
    }
    
    // Save configuration
    await saveConfig(newConfig);
    
    res.json({ success: true, config: newConfig });
  } catch (error) {
    console.error('Error updating storage config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a directory
router.post("/mkdir", async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    
    if (!dirPath) {
      return res.status(400).json({ error: 'Directory path is required' });
    }
    
    // Security check - ensure path is within allowed directories
    const allowedPaths = ['/downloads', '/workspaces/AIOgames/downloads'];
    const isAllowed = allowedPaths.some(allowed => dirPath.startsWith(allowed));
    
    if (!isAllowed) {
      return res.status(403).json({ error: 'Directory path not allowed' });
    }
    
    await fs.mkdir(dirPath, { recursive: true });
    
    res.json({ success: true, path: dirPath });
  } catch (error) {
    console.error('Error creating directory:', error);
    res.status(500).json({ error: error.message });
  }
});

// List directory contents
router.get("/browse/*", async (req, res) => {
  try {
    const dirPath = req.params[0] || '/downloads';
    
    // Security check
    const allowedPaths = ['/downloads', '/workspaces/AIOgames/downloads'];
    const isAllowed = allowedPaths.some(allowed => dirPath.startsWith(allowed));
    
    if (!isAllowed) {
      return res.status(403).json({ error: 'Directory path not allowed' });
    }
    
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const contents = items.map(item => ({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
      path: path.join(dirPath, item.name)
    }));
    
    res.json({
      currentPath: dirPath,
      contents
    });
  } catch (error) {
    console.error('Error browsing directory:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;