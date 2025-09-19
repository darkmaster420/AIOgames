import db from "../db.js";

export function addJob({ downloader, external_id, name, url, status, progress }) {
  const stmt = db.prepare(`
    INSERT INTO jobs (downloader, external_id, name, url, status, progress)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(downloader, external_id, name, url, status, progress || 0);
}

export function updateJob({ external_id, downloader, status, progress, name }) {
  const stmt = db.prepare(`
    UPDATE jobs
    SET status = ?, progress = ?, name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE external_id = ? AND downloader = ?
  `);
  return stmt.run(status, progress, name, external_id, downloader);
}

export function getAllJobs() {
  const stmt = db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`);
  return stmt.all();
}

export function getJobByExternal(downloader, external_id) {
  const stmt = db.prepare(`SELECT * FROM jobs WHERE downloader = ? AND external_id = ?`);
  return stmt.get(downloader, external_id);
}