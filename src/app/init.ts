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

  console.log('🚀 AIOgames application initialized with automatic update scheduling');
} else {
  console.log('⏭️ Skipping app initialization during build phase');
}

// Note: GOGDB index will be initialized on first use
// This avoids startup issues with SQL.js WASM loading

// Export an empty object to satisfy Next.js module requirements
export {};