// App initialization - Start background services
// Skip all initialization during build phase to prevent crashes
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

if (!isBuildPhase) {
  // Dynamic imports to avoid loading heavy modules (mongoose, bcrypt) during build
  import('../lib/scheduler').then(() => {
    console.log('📅 Scheduler module loaded');
  }).catch((error) => {
    console.error('Failed to load scheduler:', error);
  });

  // The shared local profile is initialized by src/instrumentation.ts.

  // Telegram bot: polling-based (no webhook required). Works on localhost
  // or any host without needing a public URL. The poller itself calls
  // deleteWebhook on start so any previously-registered webhook URL gets
  // cleared - Telegram will not deliver updates via getUpdates while a
  // webhook is set.
  if (process.env.TELEGRAM_BOT_TOKEN) {
    import('../lib/telegramPoller')
      .then(({ telegramPoller }) => {
        telegramPoller.start();
      })
      .catch(error => {
        console.error('❌ Failed to start Telegram poller:', error);
      });

    // Register the bot's command list with Telegram so users see autocomplete
    // for /start, /help, etc. in the chat input. Idempotent - safe to run
    // on every boot.
    const commandsApiUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setMyCommands`;
    const commands = [
      { command: 'start', description: 'Start the bot and see welcome message' },
      { command: 'help', description: 'Show available commands' },
      { command: 'id', description: 'Get your Telegram Chat ID' },
      { command: 'update', description: 'Check for game updates' },
      { command: 'track', description: 'Track a new game' },
      { command: 'untrack', description: 'Untrack a game' },
      { command: 'search', description: 'Search for games' },
      { command: 'list', description: 'Show your tracked games' },
      { command: 'settings', description: 'Open settings link' },
    ];

    fetch(commandsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          console.log('🤖 Telegram bot commands registered successfully');
        } else {
          console.error('❌ Failed to register bot commands:', data.description);
        }
      })
      .catch(error => {
        console.error('❌ Error registering bot commands:', error);
      });
  }

  console.log('🚀 AIOgames application initialized with automatic update scheduling');
} else {
  console.log('⏭️ Skipping app initialization during build phase');
}

// Note: GOGDB index will be initialized on first use
// This avoids startup issues with SQL.js WASM loading

// Export an empty object to satisfy Next.js module requirements
export {};
