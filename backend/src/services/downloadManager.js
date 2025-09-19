import * as aria2 from "./aria2.js";
import * as qbit from "./qbittorrent.js";
import jdService from "./jdownloader.js";
import { addJob, updateJob } from "../models/jobs.js";

export async function addDownload(url, source = "aria2") {
  if (source === "aria2") {
    const gid = await aria2.addDownload(url);
    addJob({ downloader: "aria2", external_id: gid, name: url, url, status: "active", progress: 0 });
    return gid;
  }
  if (source === "qbittorrent") {
    await qbit.addTorrent(url);
    // No hash returned immediately, poll later
    addJob({ downloader: "qbittorrent", external_id: url, name: url, url, status: "pending", progress: 0 });
    return url;
  }
  if (source === "jdownloader") {
    await jdService.connect();
    const res = await jdService.addDownload(url);
    addJob({ downloader: "jdownloader", external_id: res.id, name: url, url, status: "pending", progress: 0 });
    return res.id;
  }
}

export async function getAllDownloads() {
  const results = await Promise.allSettled([
    aria2.listDownloads().catch(err => {
      console.error('Error listing Aria2 downloads:', err.message);
      return [];
    }),
    qbit.listTorrents().catch(err => {
      console.error('Error listing qBittorrent torrents:', err.message);
      return [];
    })
  ]);
  
  const ariaJobs = results[0].status === 'fulfilled' ? results[0].value : [];
  const qbitJobs = results[1].status === 'fulfilled' ? results[1].value : [];
  
  // Get JDownloader jobs with proper error handling
  let jdJobs = [];
  try {
    await jdService.connect();
    jdJobs = await jdService.getDownloads();
  } catch (err) {
    console.error('Error getting downloads from JDownloader:', err.message);
  }

  // Update job statuses in the database
  [...ariaJobs, ...qbitJobs, ...jdJobs].forEach((job) => {
    updateJob(job.external_id || job.hash || job.id, {
      status: job.status,
      progress: job.progress || 0,
      name: job.name
    });
  });

  return [...ariaJobs, ...qbitJobs, ...jdJobs];
}

export async function pauseDownload(id, source) {
  if (source === "aria2") return aria2.pauseDownload(id);
  if (source === "qbittorrent") return qbit.pauseTorrent(id);
  if (source === "jdownloader") {
    await jdService.connect();
    return jdService.pauseDownload(id);
  }
}

export async function resumeDownload(id, source) {
  if (source === "aria2") return aria2.resumeDownload(id);
  if (source === "qbittorrent") return qbit.resumeTorrent(id);
  if (source === "jdownloader") {
    await jdService.connect();
    return jdService.resumeDownload(id);
  }
}

export async function removeDownload(id, source) {
  if (source === "aria2") return aria2.removeDownload(id);
  if (source === "qbittorrent") return qbit.removeTorrent(id);
  if (source === "jdownloader") {
    await jdService.connect();
    return jdService.removeDownload(id);
  }
}