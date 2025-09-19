import fetch from "node-fetch";

const JD_URL = process.env.JD_URL || "http://localhost:3128"; // JD2 local API bridge

async function callJD(path, method = "GET", body = null) {
  const res = await fetch(`${JD_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null
  });
  return res.json();
}

export async function addLink(url) {
  return await callJD("/linkgrabberv2/addLinks", "POST", { links: [url] });
}

export async function listDownloads() {
  return await callJD("/downloadsV2/queryLinks", "POST", { 
    params: { bytesLoaded: true, bytesTotal: true, status: true } 
  });
}