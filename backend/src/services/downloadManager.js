import * as aria2 from "./aria2.js";
import * as qbit from "./qbittorrent.js";
import * as jd from "./jdownloader.js";
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
    const res = await jd.addLink(url);
    addJob({ downloader: "jdownloader", external_id: url, name: url, url, status: "pending", progress: 0 });
    return res;
  }
}

export async function getAllDownloads() {
  const [ariaJobs, qbitJobs, jdJobs] = await Promise.all([
    aria2.listDownloads(),
    qbit.listTorrents(),
    jd.listDownloads()
  ]);

  // normalize
  return [
    ...ariaJobs.map(j => ({
      id: j.gid,
      name: j.files?.[0]?.path || "Unknown",
      progress: (j.completedLength / j.totalLength) * 100,
      status: j.status,
      source: "aria2"
    })),
    ...qbitJobs.map(t => ({
      id: t.hash,
      name: t.name,
      progress: t.progress * 100,
      status: t.state,
      source: "qbittorrent"
    })),
    ...jdJobs.map(l => ({
      id: l.uuid,
      name: l.name,
      progress: (l.bytesLoaded / l.bytesTotal) * 100,
      status: l.status,
      source: "jdownloader"
    }))
  ];
}