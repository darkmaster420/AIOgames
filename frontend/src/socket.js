import { io } from "socket.io-client";

// Grab token from localStorage (set at login)
const token = localStorage.getItem("token");

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:2000';
export const socket = io(BASE_URL, {
  auth: { token }
});

socket.on("connect", () => {
  console.log("Connected to backend via WebSocket");
});

socket.on("connect_error", (err) => {
  console.error("Socket error:", err.message);
});