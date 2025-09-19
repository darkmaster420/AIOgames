import { io } from "socket.io-client";
import { useEffect, useState } from "react";

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Create socket instance
export const socket = io(BASE_URL, {
  auth: { token: localStorage.getItem("token") }
});

// Custom hook for socket.io
export const useSocket = () => {
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true);
      console.log("Connected to backend via WebSocket");
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onConnectError = (err) => {
      console.error("Socket error:", err.message);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  return socket;
};