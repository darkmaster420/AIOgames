// Internal Update Scheduler - Automatic Background Update Checking
// This runs inside the Next.js application and handles automatic update checks
// without requiring external cron job setup

import connectDB from '../lib/db';
import { TrackedGame, User } from '../lib/models';
import logger from '../utils/logger';

interface ScheduledCheck {
  userId: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  lastCheck: Date;
  nextCheck: Date;
}

class UpdateScheduler {
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private cacheWarmInterval: NodeJS.Timeout | null = null;
  private scheduledChecks = new Map<string, ScheduledCheck>();

  constructor() {
    // Only start the scheduler in runtime, not during build
    if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PHASE === 'phase-production-build') {
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

    // Check for due updates every 5 minutes
    this.checkInterval = setInterval(async () => {
      try {
        await this.checkForDueUpdates();
      } catch (error) {
        logger.error('❌ Error in scheduled update check:', error);
      }
    }, 5 * 60 * 1000); // 5 minutes

    // Warm cache every 30 minutes to keep data fresh
    this.cacheWarmInterval = setInterval(async () => {
      try {
        await this.warmCache();
      } catch (error) {
        logger.error('❌ Error in cache warming:', error);
      }
    }, 30 * 60 * 1000); // 30 minutes

    // Initial load of scheduled checks
    this.loadScheduledChecks();
    
    // Initial cache warming (delayed by 30 seconds to let app start)
    setTimeout(() => this.warmCache(), 30000);
    
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
    logger.info('⏹️ Update scheduler stopped');
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

      // Get all users with tracked games that have automatic checking enabled
      const usersWithGames = await User.aggregate([
        {
          $lookup: {
            from: 'trackedgames',
            localField: '_id',
            foreignField: 'userId',
            as: 'trackedGames'
          }
        },
        {
          $match: {
            'trackedGames': { $exists: true, $ne: [] }
          }
        },
        {
          $project: {
            _id: 1,
            preferences: 1,
            trackedGames: {
              $filter: {
                input: '$trackedGames',
                cond: { 
                  $and: [
                    { $eq: ['$$this.isActive', true] },
                    { $ne: ['$$this.checkFrequency', 'manual'] }
                  ]
                }
              }
            }
          }
        },
        {
          $match: {
            'trackedGames': { $exists: true, $ne: [] }
          }
        }
      ]);

      logger.info(`📊 Found ${usersWithGames.length} users with automatic update checking enabled`);

      for (const user of usersWithGames) {
        // Group games by frequency to determine the most frequent schedule needed
        const frequencies: { [key: string]: number } = {};
        
        for (const game of user.trackedGames) {
          const freq = game.checkFrequency || 'hourly';
          frequencies[freq] = (frequencies[freq] || 0) + 1;
        }

        // Use the most frequent schedule (prioritize: hourly > daily > weekly > monthly)
        let userFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'monthly';
        if (frequencies.hourly > 0) {
          userFrequency = 'hourly';
        } else if (frequencies.daily > 0) {
          userFrequency = 'daily';
        } else if (frequencies.weekly > 0) {
          userFrequency = 'weekly';
        } else if (frequencies.monthly > 0) {
          userFrequency = 'monthly';
        }

        // Calculate next check time
        const lastCheck = new Date();
        const nextCheck = this.calculateNextCheck(lastCheck, userFrequency);

        this.scheduledChecks.set(user._id.toString(), {
          userId: user._id.toString(),
          frequency: userFrequency,
          lastCheck,
          nextCheck
        });
      }

      logger.info(`✅ Loaded ${this.scheduledChecks.size} scheduled checks`);
    } catch (error) {
      logger.error('❌ Error loading scheduled checks:', error);
    }
  }

  /**
   * Check for users whose update checks are due
   */
  private async checkForDueUpdates(): Promise<void> {
    const now = new Date();
    const dueChecks: string[] = [];

    // Find checks that are due
    for (const [userId, schedule] of this.scheduledChecks.entries()) {
      if (now >= schedule.nextCheck) {
        dueChecks.push(userId);
      }
    }

    if (dueChecks.length === 0) {
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
          const newNextCheck = this.calculateNextCheck(newLastCheck, schedule.frequency);
          
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
  }

  /**
   * Perform an update check for a specific user
   */
  private async performUpdateCheckForUser(userId: string): Promise<void> {
    try {
      logger.info(`🔍 Performing scheduled update check for user ${userId}...`);

      // Call the internal update check API (use environment variable or detect port)
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        : `http://localhost:${process.env.PORT || 3000}`;
      
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
   * Warm the game API cache proactively
   */
  private async warmCache(): Promise<void> {
    try {
      logger.info('🔥 Warming cache...');
      
      const baseUrl = process.env.NODE_ENV === 'production' 
        ? process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        : `http://localhost:${process.env.PORT || 3000}`;
      
      const response = await fetch(`${baseUrl}/api/cache/warm`, {
        method: 'GET'
      });

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
   * Calculate the next check time based on frequency
   */
  private calculateNextCheck(lastCheck: Date, frequency: 'hourly' | 'daily' | 'weekly' | 'monthly'): Date {
    const next = new Date(lastCheck);

    switch (frequency) {
      case 'hourly':
        next.setHours(next.getHours() + 1);
        break;
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next;
  }

  /**
   * Add or update a user's scheduled check
   */
  public async updateUserSchedule(userId: string): Promise<void> {
    try {
      await connectDB();

      // Get user's tracked games to determine frequency
      const trackedGames = await TrackedGame.find({ 
        userId, 
        isActive: true,
        checkFrequency: { $ne: 'manual' }
      });

      if (trackedGames.length === 0) {
        // Remove from schedule if no automatic games
        this.scheduledChecks.delete(userId);
        logger.info(`📅 Removed user ${userId} from automatic schedule (no auto games)`);
        return;
      }

      // Determine the most frequent schedule needed
      const frequencies = trackedGames.map(game => game.checkFrequency || 'hourly');
      let userFrequency: 'hourly' | 'daily' | 'weekly' | 'monthly' = 'monthly';
      
      if (frequencies.includes('hourly')) {
        userFrequency = 'hourly';
      } else if (frequencies.includes('daily')) {
        userFrequency = 'daily';
      } else if (frequencies.includes('weekly')) {
        userFrequency = 'weekly';
      } else if (frequencies.includes('monthly')) {
        userFrequency = 'monthly';
      }

      const now = new Date();
      const nextCheck = this.calculateNextCheck(now, userFrequency);

      this.scheduledChecks.set(userId, {
        userId,
        frequency: userFrequency,
        lastCheck: now,
        nextCheck
      });

      logger.info(`📅 Updated schedule for user ${userId}: ${userFrequency} checks, next at ${nextCheck.toISOString()}`);
    } catch (error) {
      logger.error(`❌ Error updating user schedule for ${userId}:`, error);
    }
  }

  /**
   * Get current scheduler status
   */
  public getStatus(): {
    isRunning: boolean;
    scheduledUsers: number;
    nextChecks: Array<{ userId: string; frequency: string; nextCheck: Date }>;
  } {
    const nextChecks = Array.from(this.scheduledChecks.values())
      .map(schedule => ({
        userId: schedule.userId,
        frequency: schedule.frequency,
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