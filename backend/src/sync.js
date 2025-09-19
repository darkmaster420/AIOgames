import { getAllDownloads } from "./services/downloadManager.js";
import { updateJob } from "./models/jobs.js";

export function startSync() {
  setInterval(async () => {
    try {
      const jobs = await getAllDownloads();
      jobs.forEach(j => {
        updateJob({
          external_id: j.id,
          downloader: j.source,
          status: j.status,
          progress: j.progress,
          name: j.name
        });
      });
    } catch (err) {
      console.error("Sync error:", err.message);
    }
  }, 10000); // every 10s
}