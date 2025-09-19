import express from "express";
import bodyParser from "body-parser";
import downloadsRouter from "./api/downloads.js";
import authRouter from "./api/auth.js";
import gamesRouter from "./api/games.js";
import configRouter from "./api/config.js";
import storageRouter from "./api/storage.js";
import imageProxyRouter from "./api/imageProxy.js";
import UpdateDetectionService from "./services/updateDetection.js";
import { startSync } from "./sync.js";
import { getAllDownloads } from "./services/downloadManager.js";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { config } from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from root directory
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: path.join(rootDir, ".env") });

// Check required env vars
const requiredEnvVars = ["JWT_SECRET", "MONGODB_URI"];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
}

// Initialize update detection service
const updateDetectionService = new UpdateDetectionService();

// Connect to MongoDB
try {
  await mongoose.connect(process.env.MONGODB_URI, {});
  console.log("Connected to MongoDB successfully");

  // Check for admin user
  const { User } = await import('./models/user.js');
  const bcrypt = (await import('bcryptjs')).default;
  
  const adminUser = await User.findOne({ username: 'admin' });
  if (!adminUser) {
    const hashedPassword = await bcrypt.hash('admin', 10);
    await User.create({
      username: 'admin',
      password: hashedPassword
    });
    console.log('Created default admin user: admin/admin');
  }
  
  // Start background services
  startSync();
  console.log('Download sync service started');
  
  updateDetectionService.start();
  console.log('Update detection service started');
  
} catch (error) {
  console.error("Failed to connect to MongoDB:", error.message);
  process.exit(1);
}

const app = express();
app.use(bodyParser.json());

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicPath = path.join(__dirname, '..', 'public');
  
  app.use(express.static(publicPath));
  
  // Serve index.html for all non-API routes (SPA routing)
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// API routes
app.use("/api/auth", authRouter);
app.use("/api/games", gamesRouter);
app.use("/api/downloads", downloadsRouter);
app.use("/api/config", configRouter);
app.use("/api/storage", storageRouter);
app.use("/api/proxy-image", imageProxyRouter);

// Healthcheck endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

const PORT = process.env.PORT || 3000;

// Create HTTP server + attach socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// 🔐 Socket.IO JWT auth
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || null;
  if (!token) return next(new Error("No token provided"));

  jwt.verify(token, process.env.JWT_SECRET || "supersecret", (err, decoded) => {
    if (err) return next(new Error("Invalid token"));
    socket.user = decoded;
    next();
  });
});

// Socket events
io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.user.username);

  // Join user to their personal room for targeted updates
  socket.join(`user_${socket.user.id}`);

  // Handle download progress updates
  socket.on("requestDownloadUpdate", async (downloadId) => {
    // Fetch latest download info and emit back
    try {
      const downloads = await getAllDownloads();
      const download = downloads.find(d => d.id === downloadId);
      socket.emit("downloadUpdate", download);
    } catch (error) {
      socket.emit("downloadError", { error: error.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.user.username);
  });
});

// Update detection service event handlers
updateDetectionService.on('gameUpdate', (updateData) => {
  console.log(`🎮 Game update detected: ${updateData.game.title} - ${updateData.version}`);
  
  // Emit to the specific user who has this game tracked
  io.to(`user_${updateData.game.userId}`).emit('gameUpdate', {
    gameId: updateData.game.gameId,
    title: updateData.game.title,
    version: updateData.version,
    updateInfo: updateData.updateInfo,
    timestamp: new Date()
  });
  
  // Also emit to all connected users (for global notifications)
  io.emit('gameUpdateNotification', {
    title: updateData.game.title,
    version: updateData.version,
    timestamp: new Date()
  });
});

// Export io for use in other modules
export { io };

// Start server
server.listen(PORT, () => {
  console.log(`🚀 AIOgames Backend API running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  updateDetectionService.stop();
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  updateDetectionService.stop();
  server.close(() => {
    console.log('Server closed');
    mongoose.connection.close();
    process.exit(0);
  });
});