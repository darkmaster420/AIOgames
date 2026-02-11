// App initialization - Start background services
// Skip all initialization during build phase to prevent crashes
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

if (!isBuildPhase) {
  // Dynamic imports to avoid loading heavy modules (mongoose, web-push, bcrypt) during build
  import('../lib/scheduler').then(() => {
    console.log('📅 Scheduler module loaded');
  }).catch((error) => {
    console.error('Failed to load scheduler:', error);
  });

  import('../lib/seedOwner').then(({ seedOwner }) => {
    seedOwner().catch((error) => {
      console.error('Failed to seed owner:', error);
    });
  }).catch((error) => {
    console.error('Failed to load seedOwner:', error);
  });

  // Set up Telegram webhook and commands in production
  if (process.env.NODE_ENV === 'production' && process.env.TELEGRAM_BOT_TOKEN && process.env.NEXTAUTH_URL) {
    const webhookUrl = `${process.env.NEXTAUTH_URL}/api/telegram/webhook`;
    const telegramApiUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`;
    
    fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl })
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          console.log('✉️ Telegram webhook configured:', webhookUrl);
        } else {
          console.error('❌ Failed to set Telegram webhook:', data.description);
        }
      })
      .catch(error => {
        console.error('❌ Error setting Telegram webhook:', error);
      });

    // Set up bot commands
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
      { command: 'settings', description: 'Open settings link' }
    ];

    fetch(commandsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
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

  // Set up Telegram bot commands in development (for local testing with polling)
  if (process.env.NODE_ENV === 'development' && process.env.TELEGRAM_BOT_TOKEN) {
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
      { command: 'settings', description: 'Open settings link' }
    ];

    fetch(commandsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    })
      .then(res => res.json())
      .then(data => {
        if (data.ok) {
          console.log('🤖 Telegram bot commands registered successfully (dev mode)');
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