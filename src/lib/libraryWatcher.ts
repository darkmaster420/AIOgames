import fs, { type FSWatcher } from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getLocalProfile } from './localProfile';
import { getLibraryRoots } from './libraryConfig';
import { runLibraryScan } from './libraryScanner';
import logger from '../utils/logger';

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function envMilliseconds(name: string, fallback: number, minimum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

async function directorySignature(root: string): Promise<string> {
  const entries = await fsPromises.readdir(root, { withFileTypes: true });
  const rows = await Promise.all(entries.map(async entry => {
    try {
      const stat = await fsPromises.stat(path.join(root, entry.name));
      return `${entry.name}:${entry.isDirectory() ? 'd' : 'f'}:${Math.trunc(stat.mtimeMs)}:${stat.size}`;
    } catch {
      return `${entry.name}:missing`;
    }
  }));
  return rows.sort().join('|');
}

class LibraryWatcher {
  private watchers = new Map<string, FSWatcher>();
  private signatures = new Map<string, string>();
  private pollTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private roots: string[] = [];
  private scanRunning = false;
  private scanRequested = false;
  private started = false;

  public async start(): Promise<void> {
    if (this.started || !envFlag('LIBRARY_WATCH_ENABLED', true)) return;
    this.roots = getLibraryRoots();
    if (!this.roots.length) return;

    this.started = true;
    const pollMs = envMilliseconds('LIBRARY_WATCH_POLL_INTERVAL_MS', 60_000, 10_000);
    await Promise.all(this.roots.map(root => this.initializeRoot(root)));
    this.pollTimer = setInterval(() => void this.poll(), pollMs);
    if (envFlag('LIBRARY_WATCH_SCAN_ON_START', true)) this.scheduleScan('startup');
    logger.info(`Library watcher enabled for ${this.roots.join(', ')} (poll fallback every ${pollMs}ms)`);
  }

  public stop(): void {
    this.started = false;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.pollTimer = null;
    this.scanTimer = null;
  }

  private async initializeRoot(root: string): Promise<void> {
    try {
      this.signatures.set(root, await directorySignature(root));
      this.openWatcher(root);
    } catch (error) {
      logger.warn(`Library watcher is waiting for ${root} to become readable:`, error);
    }
  }

  private openWatcher(root: string): void {
    if (this.watchers.has(root)) return;
    try {
      const watcher = fs.watch(root, () => this.scheduleScan(`filesystem change in ${root}`));
      watcher.on('error', error => {
        logger.warn(`Library filesystem watcher error for ${root}; polling remains active:`, error);
        watcher.close();
        this.watchers.delete(root);
      });
      this.watchers.set(root, watcher);
    } catch {
      // The polling pass retries unavailable NAS mounts.
    }
  }

  private scheduleScan(reason: string): void {
    if (!this.started) return;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    const settleMs = envMilliseconds('LIBRARY_WATCH_SETTLE_MS', 30_000, 5_000);
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      void this.scan(reason);
    }, settleMs);
  }

  private async poll(): Promise<void> {
    if (!this.started) return;
    await Promise.all(this.roots.map(async root => {
      try {
        const signature = await directorySignature(root);
        this.openWatcher(root);
        const previous = this.signatures.get(root);
        if (previous !== undefined && signature !== previous) this.scheduleScan(`poll detected change in ${root}`);
        this.signatures.set(root, signature);
      } catch (error) {
        logger.warn(`Could not poll watched library ${root}:`, error);
      }
    }));
  }

  private async scan(reason: string): Promise<void> {
    if (this.scanRunning) {
      this.scanRequested = true;
      return;
    }

    this.scanRunning = true;
    try {
      const profile = await getLocalProfile();
      logger.info(`Library watcher starting shared scan after ${reason}`);
      await runLibraryScan(profile.id);
      await Promise.all(this.roots.map(async root => {
        const signature = await directorySignature(root).catch(() => null);
        if (signature !== null) this.signatures.set(root, signature);
      }));
    } catch (error) {
      logger.error('Automatic library scan failed:', error);
    } finally {
      this.scanRunning = false;
      if (this.scanRequested) {
        this.scanRequested = false;
        this.scheduleScan('change during previous scan');
      }
    }
  }
}

export const libraryWatcher = new LibraryWatcher();
