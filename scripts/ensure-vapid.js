#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import child from 'child_process';

function envHas(key) {
  // Check both process.env and .env.local
  if (process.env[key]) return true;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return false;
  const contents = fs.readFileSync(envPath, 'utf8');
  const re = new RegExp(`^${key}=`, 'm');
  return re.test(contents);
}

function runGenerate() {
  console.log('VAPID keys missing. Generating new VAPID keys and writing to .env.local...');
  const script = path.resolve(process.cwd(), 'scripts', 'generate-vapid.js');
  child.execSync(`node "${script}" --write`, { stdio: 'inherit' });
}

// Only generate VAPID keys for development environments
// In production Docker containers, keys will be generated at runtime if not provided
if (process.env.NODE_ENV !== 'production') {
  if (!envHas('VAPID_PUBLIC_KEY') || !envHas('VAPID_PRIVATE_KEY')) {
    runGenerate();
  } else {
    console.log('VAPID keys already present. Skipping generation.');
  }
} else {
  console.log('Production build detected. VAPID keys will be handled at runtime.');
}
