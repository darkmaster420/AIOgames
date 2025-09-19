import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("data.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  downloader TEXT NOT NULL,
  external_id TEXT NOT NULL,
  name TEXT,
  url TEXT,
  status TEXT,
  progress REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

export default db;