import fetch from "node-fetch";
import dotenv from 'dotenv';

dotenv.config();

// Support both container networking and local development
const getAria2Url = () => {
  if (process.env.NODE_ENV === 'production' || process.env.DOCKER_ENV) {
    return process.env.ARIA2_URL || "http://aria2:6800/jsonrpc";
  }
  return process.env.ARIA2_URL || "http://localhost:6800/jsonrpc";
};

const ARIA2_URL = getAria2Url();
const ARIA2_SECRET = process.env.ARIA2_SECRET || "changeme";
let isConnected = false;
let connectionAttempts = 0;
let lastConnectionAttempt = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
const CONNECTION_COOLDOWN = 5 * 60 * 1000; // 5 minutes

console.log(`🔗 Aria2 service configured for URL: ${ARIA2_URL}`);

async function callAria2(method, params = []) {
  const now = Date.now();
  
  // Check if we've exceeded connection attempts and are in cooldown
  if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
    if (now - lastConnectionAttempt < CONNECTION_COOLDOWN) {
      throw new Error(`Aria2 connection cooldown active. Too many failed attempts. Next retry in ${Math.round((CONNECTION_COOLDOWN - (now - lastConnectionAttempt)) / 1000)}s`);
    } else {
      // Reset attempts after cooldown
      connectionAttempts = 0;
      console.log(`🔄 Aria2 cooldown expired, resetting connection attempts`);
    }
  }

  // Add the secret token as the first parameter
  const paramsWithSecret = [`token:${ARIA2_SECRET}`, ...params];
  
  const body = {
    jsonrpc: "2.0",
    id: Date.now().toString(),
    method,
    params: paramsWithSecret,
  };
  
  try {
    lastConnectionAttempt = now;
    
    const res = await fetch(ARIA2_URL, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      timeout: 10000 // 10 second timeout for container networking
    });
    
    if (!res.ok) {
      connectionAttempts++;
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    
    const data = await res.json();
    if (data.error) {
      connectionAttempts++;
      throw new Error(data.error.message);
    }
    
    // Success - reset attempts
    connectionAttempts = 0;
    isConnected = true;
    return data.result;
  } catch (err) {
    connectionAttempts++;
    isConnected = false;
    console.error(`Aria2 RPC error (${method}):`, err.message);
    throw new Error(`Aria2 RPC connection failed: ${err.message}`);
  }
}

export async function addDownload(url) {
  return await callAria2("aria2.addUri", [[url]]);
}

export async function listDownloads() {
  try {
    console.log('Testing Aria2 connection...');
    const result = await callAria2("aria2.tellActive");
    console.log('Aria2 connection successful');
    return result;
  } catch (error) {
    console.error('Aria2 connection failed:', error.message);
    throw error;
  }
}