import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// Image proxy endpoint to bypass CORS
router.get("/", async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: "URL parameter is required" });
    }

    // Validate URL to prevent abuse
    let imageUrl;
    try {
      imageUrl = new URL(decodeURIComponent(url));
    } catch {
      return res.status(400).json({ error: "Invalid URL" });
    }

    // Only allow certain domains for security
    const allowedDomains = [
      'steamrip.com',
      'www.skidrowreloaded.com',
      'freegogpcgames.com',
      'gamedrive.org',
      'i0.wp.com',
      'shared.akamai.steamstatic.com',
      'steamcdn-a.akamaihd.net',
      'store.steampowered.com',
      'cdn.akamai.steamstatic.com'
    ];

    if (!allowedDomains.some(domain => imageUrl.hostname === domain || imageUrl.hostname.endsWith('.' + domain))) {
      return res.status(403).json({ error: "Domain not allowed" });
    }

    console.log('Proxying image:', imageUrl.href);

    const response = await fetch(imageUrl.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': imageUrl.origin,
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
      },
      timeout: 10000
    });

    if (!response.ok) {
      console.error('Failed to fetch image:', response.status, response.statusText);
      return res.status(response.status).json({ error: `Failed to fetch image: ${response.statusText}` });
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return res.status(400).json({ error: "Not an image" });
    }

    // Set appropriate headers
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      'Access-Control-Allow-Origin': '*'
    });

    // Pipe the image data
    response.body.pipe(res);

  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ error: "Failed to proxy image" });
  }
});

export default router;