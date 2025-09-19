import express from "express";
import bodyParser from "body-parser";
import downloadsRouter from "./api/downloads.js";
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

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error("Invalid token"));
    socket.user = decoded;
    next();
  });
});

// Socket events
io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.user);

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.user);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Backend + WebSocket running on http://localhost:${PORT}`);
});