import express from "express";
import * as aria2 from "../services/aria2.js";
import jdService from "../services/jdownloader.js";
import * as qbittorrent from "../services/qbittorrent.js";

const router = express.Router();

// Add new download
router.post("/", async (req, res) => {
  const { url, service = "aria2" } = req.body;
  try {
    if (service === "jdownloader" || (service === "auto" && jdService.supportsUrl(url))) {
      await jdService.connect();
      const result = await jdService.addDownload(url);
      res.json({ success: true, id: result.id });
    } else {
      const gid = await aria2.addDownload(url);
      res.json({ success: true, id: gid });
    }
  } catch (err) {
    console.error('Error adding download:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List downloads
router.get("/", async (req, res) => {
  try {
    const [ariaJobs, jdJobs] = await Promise.all([
      aria2.listDownloads().catch(err => {
        console.error('Error getting Aria2 jobs:', err);
        return [];
      }),
      jdService.getDownloads().catch(err => {
        console.error('Error getting JDownloader jobs:', err);
        return [];
      })
    ]);

    const combinedList = [
      ...ariaJobs.map(j => ({
        id: j.gid,
        name: j.files?.[0]?.path || "Unknown",
        progress: (j.completedLength / j.totalLength) * 100,
        status: j.status,
        source: "aria2"
      })),
      ...jdJobs.map(j => ({
        id: j.uuid,
        name: j.name,
        progress: j.progress,
        status: j.status,
        source: "jdownloader"
      }))
    ];

    res.json(combinedList);
  } catch (err) {
    console.error('Error listing downloads:', err);
    // Return empty array instead of 500 error when services are unavailable
    res.json([]);
  }
});

// Check supported downloaders for a game
router.get("/supported/:gameId", async (req, res) => {
  try {
    const { gameId } = req.params;
    
    // Check which services are available
    const services = {};
    
    try {
      await aria2.listDownloads();
      services.aria2 = true;
    } catch (err) {
      services.aria2 = false;
    }
    
    try {
      await qbittorrent.getVersion();
      services.qbittorrent = true;
    } catch (err) {
      services.qbittorrent = false;
    }
    
    try {
      await jdService.connect();
      services.jdownloader = true;
    } catch (err) {
      services.jdownloader = false;
    }
    
    res.json({
      gameId,
      supported: services,
      available: Object.values(services).some(v => v)
    });
  } catch (err) {
    console.error('Error checking supported downloaders:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get download services status
router.get("/services/status", async (req, res) => {
  try {
    const services = {};
    
    // Test Aria2
    try {
      await aria2.listDownloads();
      services.aria2 = { status: 'online', url: process.env.ARIA2_URL };
    } catch (err) {
      services.aria2 = { status: 'offline', error: err.message };
    }
    
    // Test qBittorrent
    try {
      const version = await qbittorrent.getVersion();
      services.qbittorrent = { status: 'online', version };
    } catch (err) {
      services.qbittorrent = { status: 'offline', error: err.message };
    }
    
    // Test JDownloader
    try {
      await jdService.connect();
      services.jdownloader = { status: 'online', email: process.env.JD_EMAIL };
    } catch (err) {
      services.jdownloader = { status: 'offline', error: err.message };
    }
    
    res.json(services);
  } catch (err) {
    console.error('Error getting services status:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;