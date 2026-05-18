/**
 * Telegram getUpdates long-poll loop.
 *
 * Replaces the previous webhook setup so the app no longer needs to be
 * reachable from the public internet to receive bot updates. Cheaper too -
 * one held-open HTTP connection vs. a public webhook + server-side cron
 * gymnastics.
 *
 * Lifecycle:
 *   - start() is idempotent and safe to call multiple times.
 *   - On first call, deletes any previously-registered webhook (Telegram
 *     refuses getUpdates while a webhook URL is set) then enters the loop.
 *   - The loop runs forever; the only way out is process exit or stop()
 *     (used by tests). Errors back off exponentially up to 60s.
 *
 * Conflict handling: if a second instance of the app tries to poll the
 * same bot token, Telegram returns 409 Conflict to whichever request loses
 * the race. The loser backs off and keeps retrying; whichever request is
 * inside an active long-poll wins. In practice, run one instance per token.
 */
import { processTelegramUpdate, type TelegramUpdate } from './telegramBot';

const TELEGRAM_API = 'https://api.telegram.org';
const LONG_POLL_TIMEOUT_SECS = 30;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

interface CallbackQueryLite { id: string; data?: string }
type RawUpdate = TelegramUpdate & { callback_query?: CallbackQueryLite };

class TelegramPoller {
  private started = false;
  private stopped = false;
  private offset = 0;
  private currentAbort: AbortController | null = null;
  private botToken = '';

  start(): void {
    if (this.started) return;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.log('[telegram] TELEGRAM_BOT_TOKEN not set, skipping poller');
      return;
    }
    this.started = true;
    this.stopped = false;
    this.botToken = token;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.currentAbort?.abort();
  }

  private async run(): Promise<void> {
    // Ensure no webhook is active - Telegram rejects getUpdates while a
    // webhook URL is registered. drop_pending_updates=false so any messages
    // queued during a deploy are still delivered to us via the next poll.
    await this.deleteWebhook();

    let backoff = INITIAL_BACKOFF_MS;
    console.log('[telegram] polling started');

    while (!this.stopped) {
      try {
        const updates = await this.fetchUpdates();
        backoff = INITIAL_BACKOFF_MS; // any successful poll resets backoff
        for (const update of updates) {
          // Process sequentially per poll so we can advance the offset
          // monotonically. Errors in one update must not block subsequent
          // updates from being acknowledged.
          try {
            await processTelegramUpdate(update, this.botToken);
          } catch (err) {
            console.error('[telegram] handler failed for update', update.update_id, err);
          }
          if (update.update_id >= this.offset) {
            this.offset = update.update_id + 1;
          }
        }
      } catch (err) {
        if (this.stopped) return;
        const msg = err instanceof Error ? err.message : String(err);
        // AbortError is expected on shutdown; everything else is a real
        // problem worth surfacing once per occurrence.
        if (msg.includes('aborted')) continue;
        console.warn(`[telegram] poll error (backing off ${backoff}ms): ${msg}`);
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private async fetchUpdates(): Promise<RawUpdate[]> {
    this.currentAbort = new AbortController();
    // Bail out of the long poll a bit after Telegram's stated timeout so we
    // detect dead connections rather than hang forever.
    const timer = setTimeout(
      () => this.currentAbort?.abort(),
      (LONG_POLL_TIMEOUT_SECS + 10) * 1000,
    );
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates`;
      const body = JSON.stringify({
        offset: this.offset,
        timeout: LONG_POLL_TIMEOUT_SECS,
        // Subset of update types we actually handle. Cuts down on bandwidth
        // and stops bot updates we don't care about (chat_member etc) from
        // sitting in the queue.
        allowed_updates: ['message', 'callback_query'],
      });
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: this.currentAbort.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`getUpdates HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      }
      const json = (await resp.json()) as { ok: boolean; description?: string; result?: RawUpdate[] };
      if (!json.ok) {
        throw new Error(`getUpdates not ok: ${json.description || 'unknown'}`);
      }
      return json.result || [];
    } finally {
      clearTimeout(timer);
      this.currentAbort = null;
    }
  }

  private async deleteWebhook(): Promise<void> {
    try {
      const resp = await fetch(
        `${TELEGRAM_API}/bot${this.botToken}/deleteWebhook?drop_pending_updates=false`,
      );
      const json = (await resp.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (json.ok) {
        console.log('[telegram] webhook cleared (now polling)');
      } else if (json.description) {
        console.warn('[telegram] deleteWebhook responded:', json.description);
      }
    } catch (err) {
      console.warn('[telegram] deleteWebhook failed (continuing anyway):', err);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const telegramPoller = new TelegramPoller();
