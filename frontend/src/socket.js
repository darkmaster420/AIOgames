import { io } from "socket.io-client";

// Grab token from localStorage (set at login)
const token = localStorage.getItem("token");

export const socket = io("http://localhost:2000", {
  auth: { token }
});

socket.on("connect", () => {
  console.log("Connected to backend via WebSocket");
});

socket.on("connect_error", (err) => {
  console.error("Socket error:", err.message);
});