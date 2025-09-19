import express from "express";
import * as aria2 from "../services/aria2.js";

const router = express.Router();

// Add new download
router.post("/", async (req, res) => {
  const { url } = req.body;
  try {
    const gid = await aria2.addDownload(url);
    res.json({ success: true, gid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List downloads
router.get("/", async (req, res) => {
  try {
    const list = await aria2.listDownloads();
    res.json(list);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;