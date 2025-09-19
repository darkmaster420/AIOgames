import fetch from "node-fetch";
import dotenv from 'dotenv';

dotenv.config();

// Support both container networking and local development
const getQBittorrentUrl = () => {
  if (process.env.NODE_ENV === 'production' || process.env.DOCKER_ENV) {
    return process.env.QBITTORRENT_URL || "http://qbittorrent:8080";
  }
  return process.env.QBITTORRENT_URL || "http://localhost:8080";
};

const QBIT_URL = getQBittorrentUrl();
const QBIT_USER = process.env.QB_USERNAME || "admin";
const QBIT_PASS = process.env.QB_PASSWORD || "adminadmin";

let cookie = null;
let loginAttempts = 0;
let lastLoginAttempt = 0;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_COOLDOWN = 5 * 60 * 1000; // 5 minutes

console.log(`🔗 qBittorrent service configured for URL: ${QBIT_URL}`);

async function login() {
  const now = Date.now();
  
  // Check if we've exceeded login attempts and are in cooldown
  if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
    if (now - lastLoginAttempt < LOGIN_COOLDOWN) {
      throw new Error(`qBittorrent login cooldown active. Too many failed attempts. Next retry in ${Math.round((LOGIN_COOLDOWN - (now - lastLoginAttempt)) / 1000)}s`);
    } else {
      // Reset attempts after cooldown
      loginAttempts = 0;
      console.log(`🔄 qBittorrent cooldown expired, resetting login attempts`);
    }
  }

  try {
    console.log('Attempting qBittorrent login...');
    lastLoginAttempt = now;
    
    const res = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${QBIT_USER}&password=${QBIT_PASS}`,
      timeout: 5000 // 5 second timeout
    });
    
    if (!res.ok) {
      loginAttempts++;
      console.error(`qBittorrent login failed with status ${res.status}`);
      const text = await res.text();
      console.error('Response:', text);
      
      if (res.status === 403) {
        console.error('IP may be banned from qBittorrent. Entering cooldown period.');
      }
      
      throw new Error(`qBittorrent login failed: ${res.statusText}`);
    }
    
    // Success - reset attempts
    loginAttempts = 0;
    
    // Raw headers include an array of header strings
    const rawHeaders = res.headers.raw();
    console.log('Response headers:', rawHeaders);
    
    // Look for SID cookie in raw headers
    const setCookieHeaders = rawHeaders['set-cookie'] || [];
    const sidCookie = setCookieHeaders.find(c => c.startsWith('SID='));
    
    if (!sidCookie) {
      // Try getting just the SID value from the response
      const text = await res.text();
      console.log('Response body:', text);
      if (text === 'Ok.' || text === 'Fails.') {
        // qBittorrent responded, create a simple session cookie
        cookie = 'SID=new_session';
        console.log('Created basic session cookie');
        return;
      }
      console.error('No valid cookie received from qBittorrent');
      throw new Error("qBittorrent login failed: No valid cookie received");
    }
    
    cookie = sidCookie;
    console.log('qBittorrent login successful with cookie');
  } catch (error) {
    console.error('qBittorrent login error:', error);
    throw error;
  }
}

async function callQbit(path, options = {}) {
  try {
    if (!cookie) {
      await login();
    }
    
    const res = await fetch(`${QBIT_URL}${path}`, {
      ...options,
      headers: { 
        ...(options.headers || {}), 
        Cookie: cookie,
        Accept: 'application/json, text/plain, */*'
      }
    });
    
    if (!res.ok) {
      console.error(`qBittorrent API call failed: ${path} with status ${res.status}`);
      const text = await res.text();
      console.error('Response:', text);
      
      if (res.status === 403) {
        console.log('Session expired, trying to login again...');
        cookie = null;
        await login();
        return callQbit(path, options);
      }
      
      throw new Error(`qBittorrent API call failed: ${res.statusText}`);
    }
    
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return res.json();
    }
    
    // For non-JSON responses (like lists), parse text response
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      if (text === '') return [];
      console.log('Non-JSON response:', text);
      return text;
    }
  } catch (error) {
    console.error(`qBittorrent API error for ${path}:`, error);
    throw error;
  }
}

export async function addTorrent(magnetLink) {
  if (!cookie) await login();
  const res = await fetch(`${QBIT_URL}/api/v2/torrents/add`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: `urls=${encodeURIComponent(magnetLink)}`
  });
  if (res.status !== 200) throw new Error("Failed to add torrent");
  return true;
}

export async function listTorrents() {
  return await callQbit("/api/v2/torrents/info");
}

export async function getVersion() {
  try {
    console.log('Testing qBittorrent connection...');
    const version = await callQbit("/api/v2/app/version");
    console.log('qBittorrent connection successful, version:', version);
    return version;
  } catch (error) {
    console.error('qBittorrent connection failed:', error.message);
    throw error;
  }
}