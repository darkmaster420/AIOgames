import express from "express";
import bodyParser from "body-parser";
import downloadsRouter from "./api/downloads.js";
import authRouter from "./api/auth.js";
import gamesRouter from "./api/games.js";
import { startSync } from "./sync.js";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";

startSync();

const app = express();
app.use(bodyParser.json());

// API routes
app.use("/api/auth", authRouter);
app.use("/api/games", gamesRouter);
app.use("/api/downloads", downloadsRouter);

// Resolve __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend build
app.use(express.static(path.join(__dirname, "../public")));

// Catch-all → send index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

const PORT = process.env.PORT || 2000;

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