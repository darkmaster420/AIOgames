// App initialization - Start background services
import '../lib/scheduler'; // This will automatically start the scheduler

console.log('🚀 AIOgames application initialized with automatic update scheduling');

// Note: GOGDB index will be initialized on first use
// This avoids startup issues with SQL.js WASM loading

// Export an empty object to satisfy Next.js module requirements
export {};