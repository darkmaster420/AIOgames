import { Router } from 'express';
import authMiddleware from '../middleware/authMiddleware.js';

const router = Router();

router.get('/steam', authMiddleware, (req, res) => {
    // Check if STEAM_API_KEY is set and not empty
    const steamEnabled = !!process.env.STEAM_API_KEY && process.env.STEAM_API_KEY !== 'changeme';
    res.json({ enabled: steamEnabled });
});

export default router;