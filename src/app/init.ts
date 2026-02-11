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

  // Set up Telegram webhook in production
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
  }

  console.log('🚀 AIOgames application initialized with automatic update scheduling');
} else {
  console.log('⏭️ Skipping app initialization during build phase');
}

// Note: GOGDB index will be initialized on first use
// This avoids startup issues with SQL.js WASM loading

// Export an empty object to satisfy Next.js module requirements
export {};