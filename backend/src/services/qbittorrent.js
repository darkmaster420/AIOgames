import fetch from "node-fetch";

const QBIT_URL = process.env.QBIT_URL || "http://localhost:8080";
const QBIT_USER = process.env.QBIT_USER || "admin";
const QBIT_PASS = process.env.QBIT_PASS || "adminadmin";

let cookie = null;

async function login() {
  const res = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${QBIT_USER}&password=${QBIT_PASS}`
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("qBittorrent login failed");
  cookie = setCookie;
}

async function callQbit(path, options = {}) {
  if (!cookie) await login();
  const res = await fetch(`${QBIT_URL}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie }
  });
  return res.json();
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