import express from "express";
import bodyParser from "body-parser";
import downloadsRouter from "./api/downloads.js";
import authRouter from "./api/auth.js";
import gamesRouter from "./api/games.js";
import configRouter from "./api/config.js";
import { startSync } from "./sync.js";
import { getAllDownloads } from "./services/downloadManager.js";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import mongoose from "mongoose";

// Load .env from root directory
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: path.join(rootDir, ".env") });

// Check required env vars
const requiredEnvVars = ["JWT_SECRET", "MONGODB_URI"];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
}

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
} catch (error) {
  console.error("Failed to connect to MongoDB:", error.message);
  process.exit(1);
}

startSync();

const app = express();
app.use(bodyParser.json());

// API routes
app.use("/api/auth", authRouter);
app.use("/api/games", gamesRouter);
app.use("/api/downloads", downloadsRouter);
app.use("/api/config", configRouter);

// Healthcheck endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend build
const frontendPath = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendPath));

// Catch-all → send index.html
app.get("*", (req, res) => {
  const indexPath = path.join(frontendPath, "index.html");
  console.log("Serving index.html from:", indexPath);
  res.sendFile(indexPath);
});

const PORT = 4000;

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

// Export io for use in other modules
export { io };

// Start server
server.listen(PORT, () => {
  console.log(`🚀 AIOgames Backend + WebSocket running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard available at http://localhost:${PORT}`);
});