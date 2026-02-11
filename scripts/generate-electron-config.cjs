#!/usr/bin/env node

/**
 * Generate Electron configuration before building
 * This embeds the backend URL into the desktop app at build time
 */

const fs = require('fs');
const path = require('path');

// Get backend URL from environment variable
const backendUrl = process.env.BACKEND_URL || null;

// Generate config file content
const configContent = `// AUTO-GENERATED FILE - DO NOT EDIT
// Generated at build time: ${new Date().toISOString()}
// Backend URL: ${backendUrl || 'Local server mode (no backend URL set)'}

module.exports = {
  backendUrl: ${backendUrl ? `'${backendUrl}'` : 'null'}
};
`;

// Write config file
const configPath = path.join(__dirname, '..', 'electron', 'config.cjs');
fs.writeFileSync(configPath, configContent, 'utf8');

console.log('✓ Electron config generated');
if (backendUrl) {
  console.log(`  Backend URL: ${backendUrl}`);
} else {
  console.log('  Mode: Local server (standalone)');
}
