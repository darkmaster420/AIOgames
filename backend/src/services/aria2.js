import fetch from "node-fetch";

const ARIA2_URL = process.env.ARIA2_URL || "http://localhost:6800/jsonrpc";

async function callAria2(method, params = []) {
  const body = {
    jsonrpc: "2.0",
    id: Date.now().toString(),
    method,
    params,
  };
  try {
    const res = await fetch(ARIA2_URL, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  } catch (err) {
    console.error(`Aria2 RPC error (${method}):`, err.message);
    throw new Error(`Aria2 RPC connection failed: ${err.message}`);
  }
}

export async function addDownload(url) {
  return await callAria2("aria2.addUri", [[url]]);
}

export async function listDownloads() {
  return await callAria2("aria2.tellActive");
}