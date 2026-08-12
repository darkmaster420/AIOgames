// Internal Update Scheduler - Automatic Background Update Checking
// This runs inside the Next.js application and handles automatic update checks
// without requiring external cron job setup
// All games are checked uniformly (hourly) - individual notification preferences are handled per-game

import connectDB from '../lib/db';
import { TrackedGame } from '../lib/models';
import { libraryWatcher } from '../lib/libraryWatcher';
import { getLocalProfile } from '../lib/localProfile';
import logger from '../utils/logger';

interface ScheduledCheck {
  userId: string;
  lastCheck: Date;
  nextCheck: Date;
}

class UpdateScheduler {
  private isRunning = false;
  private isCheckRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private cacheWarmInterval: NodeJS.Timeout | null = null;
  private rssDownloadLinksCacheInterval: NodeJS.Timeout | null = null;
  private titleMigrationInterval: NodeJS.Timeout | null = null;
  private jd2MonitorInterval: NodeJS.Timeout | null = null;
  private isJd2MonitorRunning = false;
  private scheduledChecks = new Map<string, ScheduledCheck>();
  private readonly CHECK_FREQUENCY_HOURS = 1; // All games checked hourly

  constructor() {
    // Only start the scheduler in runtime, not during build
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      // Skip initialization during build
      return;
    }
    this.start();
  }

  /**
   * Start the automatic update scheduler
   */
  public start(): void {
    if (this.isRunning) {
      logger.info('📅 Update scheduler is already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 Starting automatic update scheduler...');

    // Check for due updates every hour
    this.checkInterval = setInterval(async () => {
      try {
        await this.checkForDueUpdates();
      } catch (error) {
        logger.error('❌ Error in scheduled update check:', error);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Warm cache every 25 minutes to keep data fresh (well within 2-hour cache TTL)
    this.cacheWarmInterval = setInterval(async () => {
      try {
        await this.warmCache();
      } catch (error) {
        logger.error('❌ Error in cache warming:', error);
      }
    }, 25 * 60 * 1000); // 25 minutes

    // Warm RSS download-link cache (gameapi) for games missing rssCachedDownloadLinks
    const rssWarmMs = parseInt(process.env.RSS_CACHE_WARM_INTERVAL_MS || '', 10);
    const rssIntervalMs = Number.isFinite(rssWarmMs) && rssWarmMs >= 60_000 ? rssWarmMs : 45 * 60 * 1000;
    this.rssDownloadLinksCacheInterval = setInterval(async () => {
      try {
        await this.warmRssDownloadLinksCacheRound();
      } catch (error) {
        logger.error('❌ Error in RSS download-link cache warming:', error);
      }
    }, rssIntervalMs);

    // Auto-migrate unclean titles every 6 hours
    this.titleMigrationInterval = setInterval(async () => {
      try {
        await this.autoMigrateTitles();
      } catch (error) {
        logger.error('❌ Error in auto title migration:', error);
      }
    }, 6 * 60 * 60 * 1000); // 6 hours

    const jd2MonitorMs = Math.max(30_000, parseInt(process.env.JD2_MONITOR_INTERVAL_MS || '', 10) || 60_000);
    this.jd2MonitorInterval = setInterval(() => void this.monitorJd2(), jd2MonitorMs);

    // Initial load of scheduled checks
    this.loadScheduledChecks();
    
    // Initial cache warming (delayed by 30 seconds to let app start)
    setTimeout(() => this.warmCache(), 30000);
    
    // Initial RSS download-link cache warm (delayed so DB / gameapi are ready)
    setTimeout(() => void this.warmRssDownloadLinksCacheRound(), 90_000);

    // Initial title migration (delayed by 2 minutes to let app start and avoid startup congestion)
    setTimeout(() => this.autoMigrateTitles(), 120000);

    // Let JD2 ingest startup API jobs before the first status query.
    setTimeout(() => void this.monitorJd2(), 45_000);
    void libraryWatcher.start();
    
    logger.info('✅ Update scheduler started successfully');
  }

  /**
   * Stop the automatic update scheduler
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.cacheWarmInterval) {
      clearInterval(this.cacheWarmInterval);
      this.cacheWarmInterval = null;
    }
    if (this.rssDownloadLinksCacheInterval) {
      clearInterval(this.rssDownloadLinksCacheInterval);
      this.rssDownloadLinksCacheInterval = null;
    }
    if (this.titleMigrationInterval) {
      clearInterval(this.titleMigrationInterval);
      this.titleMigrationInterval = null;
    }
    if (this.jd2MonitorInterval) {
      clearInterval(this.jd2MonitorInterval);
      this.jd2MonitorInterval = null;
    }
    libraryWatcher.stop();
    logger.info('⏹️ Update scheduler stopped');
  }

  private async monitorJd2(): Promise<void> {
    if (this.isJd2MonitorRunning) return;
    this.isJd2MonitorRunning = true;
    try {
      const { monitorJd2Downloads } = await import('./jd2Monitor');
      await monitorJd2Downloads();
    } catch (error) {
      logger.error('JD2 status monitor error:', error);
    } finally {
      this.isJd2MonitorRunning = false;
    }
  }

  /**
   * Load all users' scheduled checks from database
   */
  private async loadScheduledChecks(): Promise<void> {
    try {
      // Check if MongoDB URI is available
      if (!process.env.MONGODB_URI) {
        logger.info('⚠️ MONGODB_URI not configured, skipping scheduled checks loading');
        return;
      }

      await connectDB();

      const profile = await getLocalProfile();
      const hasSharedGames = await TrackedGame.exists({ userId: profile.id, isActive: true });
      if (hasSharedGames) {
        const lastCheck = new Date();
        this.scheduledChecks.set(profile.id, {
          userId: profile.id,
          lastCheck,
          nextCheck: this.calculateNextCheck(lastCheck),
        });
      }
      logger.info(`Loaded ${this.scheduledChecks.size} shared library schedule`);
    } catch (error) {
      logger.error('❌ Error loading scheduled checks:', error);
    }
  }

  /**
   * Check for users whose update checks are due
   */
  private async checkForDueUpdates(): Promise<void> {
    // Prevent overlapping check runs
    if (this.isCheckRunning) {
      logger.info('⏳ Update check already in progress, skipping this cycle');
      return;
    }
    this.isCheckRunning = true;

    const now = new Date();
    const dueChecks: string[] = [];

    // Find checks that are due
    for (const [userId, schedule] of this.scheduledChecks.entries()) {
      if (now >= schedule.nextCheck) {
        dueChecks.push(userId);
      }
    }

    if (dueChecks.length === 0) {
      this.isCheckRunning = false;
      return; // No checks due
    }

    logger.info(`⏰ ${dueChecks.length} users due for update checks`);

    // Process each due check
    for (const userId of dueChecks) {
      try {
        await this.performUpdateCheckForUser(userId);
        
        // Update the schedule for next check
        const schedule = this.scheduledChecks.get(userId);
        if (schedule) {
          const newLastCheck = new Date();
          const newNextCheck = this.calculateNextCheck(newLastCheck);
          
          this.scheduledChecks.set(userId, {
            ...schedule,
            lastCheck: newLastCheck,
            nextCheck: newNextCheck
          });
        }
      } catch (error) {
        logger.error(`❌ Error performing update check for user ${userId}:`, error);
      }
    }

    this.isCheckRunning = false;
  }

  /**
   * Perform an update check for a specific user
   */
  private async performUpdateCheckForUser(userId: string): Promise<void> {
    try {
      logger.info(`🔍 Performing scheduled update check for user ${userId}...`);

      // Call the internal update check API (use environment variable or detect port)
      // Use 127.0.0.1 instead of localhost to avoid IPv6 issues
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'
        : `http://127.0.0.1:${process.env.PORT || 3000}`;
      
      const response = await fetch(`${baseUrl}/api/updates/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Id': userId // Pass user ID for internal API call
        }
      });

      if (!response.ok) {
        throw new Error(`Update check API returned ${response.status}`);
      }

      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Update check returned non-JSON response (status: ${response.status}, content-type: ${contentType})`);
      }

      const result = await response.json();
      logger.info(`✅ Scheduled update check completed for user ${userId}: ${result.checked} games checked, ${result.updatesFound} updates found`);

    } catch (error) {
      logger.error(`❌ Failed to perform update check for user ${userId}:`, error);
    }
  }

  /**
   * Auto-migrate titles that need cleaning
   */
  private async autoMigrateTitles(): Promise<void> {
    try {
      await connectDB();
      
      const { cleanGameTitle } = await import('../utils/steamApi');
      
      // Find games that need migration
      const gamesToMigrate = await TrackedGame.find({
        isActive: true,
        $or: [
          { originalTitle: { $exists: false } },
          { originalTitle: null },
          { originalTitle: "" },
          { $expr: { $eq: ["$title", "$originalTitle"] } },
          // Look for titles that likely need cleaning
          { title: { $regex: /\b(v\d+\.\d+|release|repack|update|hotfix|dlc|goty|edition|build|\[|\]|\(.*\))/i } }
        ]
      }).limit(100); // Process up to 100 games per run to avoid overload

      if (gamesToMigrate.length === 0) {
        logger.info('🧹 No titles need auto-migration');
        return;
      }

      logger.info(`🧹 Auto-migrating ${gamesToMigrate.length} titles...`);

      let migratedCount = 0;

      for (const game of gamesToMigrate) {
        try {
          const originalTitle = game.title;
          const cleanedTitle = cleanGameTitle(game.title);
          
          // Only update if the cleaned title is actually different
          if (cleanedTitle !== originalTitle) {
            await TrackedGame.updateOne(
              { _id: game._id },
              {
                $set: {
                  title: cleanedTitle,
                  originalTitle: originalTitle,
                  cleanedTitle: cleanedTitle
                }
              }
            );

            migratedCount++;
            logger.info(`🧹 Auto-migrated title for game ${game.gameId}: "${originalTitle}" -> "${cleanedTitle}"`);
          } else {
            // Still ensure originalTitle is set even if no cleaning needed
            if (!game.originalTitle || game.originalTitle === game.title) {
              await TrackedGame.updateOne(
                { _id: game._id },
                {
                  $set: {
                    originalTitle: originalTitle,
                    cleanedTitle: cleanedTitle
                  }
                }
              );
            }
          }
        } catch (error) {
          logger.error(`❌ Failed to auto-migrate game ${game.gameId}:`, error);
        }
      }

      logger.info(`🧹✅ Auto-migration completed: ${migratedCount} titles cleaned`);

    } catch (error) {
      logger.error('❌ Auto title migration error:', error);
    }
  }

  /**
   * Warm the game API cache proactively
   */
  private async warmCache(): Promise<void> {
    try {
      logger.info('🔥 Warming cache...');
      
      // Use 127.0.0.1 instead of localhost to force IPv4 and avoid IPv6 connection issues
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000'
        : `http://127.0.0.1:${process.env.PORT || 3000}`;
      
      // 2-minute timeout — cache warming scrapes multiple sites and can be slow
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      
      const response = await fetch(`${baseUrl}/api/cache/warm`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const result = await response.json();
          logger.info(`🔥✅ Cache warmed: ${result.gameCount} games loaded in ${result.duration}`);
        } else {
          logger.warn(`⚠️ Cache warming returned non-JSON response (status: ${response.status})`);
        }
      } else {
        logger.warn(`⚠️ Cache warming failed: ${response.status}`);
      }

    } catch (error) {
      logger.error('❌ Cache warming error:', error);
    }
  }

  /**
   * Fill `rssCachedDownloadLinks` for a small batch of tracked games (all users).
   * Hard-capped at 10 games per run so the scheduler never fans out across the whole library.
   * Optional env `RSS_CACHE_WARM_MAX_PER_RUN` may only lower that cap (1–10). Stale age: `RSS_CACHE_WARM_MAX_AGE_DAYS`.
   */
  private async warmRssDownloadLinksCacheRound(): Promise<void> {
    try {
      await connectDB();
      const { warmRssDownloadLinksCacheBatch } = await import('./trackedGameDownloadLinks');
      const schedulerMax = 10;
      const fromEnv = parseInt(process.env.RSS_CACHE_WARM_MAX_PER_RUN || '', 10);
      const maxGames = Number.isFinite(fromEnv) && fromEnv > 0
        ? Math.min(Math.max(fromEnv, 1), schedulerMax)
        : schedulerMax;
      const days = process.env.RSS_CACHE_WARM_MAX_AGE_DAYS;
      const maxAgeMs =
        days && !Number.isNaN(parseInt(days, 10)) && parseInt(days, 10) > 0
          ? parseInt(days, 10) * 24 * 60 * 60 * 1000
          : undefined;
      const r = await warmRssDownloadLinksCacheBatch({
        maxGames,
        maxAgeMs,
        delayMs: 500,
      });
      if (r.attempted > 0) {
        logger.info(
          `📎 RSS download-link cache warm: ${r.attempted} tried, ${r.succeeded} filled, ${r.failed} no links`
        );
      }
    } catch (error) {
      logger.error('❌ RSS download-link cache warming error:', error);
    }
  }

  /**
   * Calculate the next check time (always 1 hour from now)
   */
  private calculateNextCheck(lastCheck: Date): Date {
    const next = new Date(lastCheck);
    next.setHours(next.getHours() + this.CHECK_FREQUENCY_HOURS);
    return next;
  }

  /**
   * Add or update a user's scheduled check
   */
  public async updateUserSchedule(_userId: string): Promise<void> {
    try {
      await connectDB();
      const { id: userId } = await getLocalProfile();

      // Get user's tracked games
      const trackedGames = await TrackedGame.find({ 
        userId, 
        isActive: true
      });

      if (trackedGames.length === 0) {
        // Remove from schedule if no games
        this.scheduledChecks.delete(userId);
        logger.info(`📅 Removed user ${userId} from schedule (no tracked games)`);
        return;
      }

      // All users get hourly checks
      const now = new Date();
      const nextCheck = this.calculateNextCheck(now);

      this.scheduledChecks.set(userId, {
        userId,
        lastCheck: now,
        nextCheck
      });

      logger.info(`Updated shared library schedule: hourly checks, next at ${nextCheck.toISOString()}`);
    } catch (error) {
      logger.error('Error updating shared library schedule:', error);
    }
  }

  /**
   * Get current scheduler status
   */
  public getStatus(): {
    isRunning: boolean;
    scheduledUsers: number;
    nextChecks: Array<{ userId: string; nextCheck: Date }>;
  } {
    const nextChecks = Array.from(this.scheduledChecks.values())
      .map(schedule => ({
        userId: schedule.userId,
        nextCheck: schedule.nextCheck
      }))
      .sort((a, b) => a.nextCheck.getTime() - b.nextCheck.getTime());

    return {
      isRunning: this.isRunning,
      scheduledUsers: this.scheduledChecks.size,
      nextChecks
    };
  }

  /**
   * Force an immediate check for all scheduled users (for testing)
   */
  public async forceCheckAll(): Promise<void> {
    logger.info('🚀 Forcing immediate update check for all scheduled users...');
    
    const userIds = Array.from(this.scheduledChecks.keys());
    for (const userId of userIds) {
      await this.performUpdateCheckForUser(userId);
    }
    
    logger.info(`✅ Forced update check completed for ${userIds.length} users`);
  }

  /**
   * Force immediate title migration (for testing or manual trigger)
   */
  public async forceTitleMigration(): Promise<void> {
    logger.info('🧹 Forcing immediate title migration...');
    await this.autoMigrateTitles();
    logger.info('🧹✅ Forced title migration completed');
  }
}

// Create singleton instance
export const updateScheduler = new UpdateScheduler();

// Handle graceful shutdown
if (typeof process !== 'undefined') {
  process.on('SIGINT', () => {
    logger.info('📴 Shutting down update scheduler...');
    updateScheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('📴 Shutting down update scheduler...');
    updateScheduler.stop();
    process.exit(0);
  });
}

export default updateScheduler;
