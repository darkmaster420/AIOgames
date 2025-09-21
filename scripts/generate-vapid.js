#!/usr/bin/env node
/*
 * Simple helper to generate VAPID keys for web-push
 * Usage:
 *   node scripts/generate-vapid.js        # prints keys
 *   node scripts/generate-vapid.js --write  # writes/updates .env.local
 */

import fs from 'fs';
import path from 'path';
import webpush from 'web-push';

function generate() {
  return webpush.generateVAPIDKeys();
}

function writeEnv(publicKey, privateKey) {
  const envPath = path.resolve(process.cwd(), '.env.local');
  let contents = '';
  if (fs.existsSync(envPath)) contents = fs.readFileSync(envPath, 'utf8');

  const setOrReplace = (key, value, input) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(input)) {
      return input.replace(re, `${key}=${value}`);
    }
    return input + (input && !input.endsWith('\n') ? '\n' : '') + `${key}=${value}\n`;
  };

  contents = setOrReplace('VAPID_PUBLIC_KEY', publicKey, contents);
  contents = setOrReplace('VAPID_PRIVATE_KEY', privateKey, contents);

  fs.writeFileSync(envPath, contents, 'utf8');
  console.log(`Wrote VAPID keys to ${envPath}`);
}

function main() {
  const keys = generate();
  console.log('VAPID keys generated:');
  console.log(JSON.stringify(keys, null, 2));
  console.log('\nAdd these to your environment as:');
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);

  if (process.argv.includes('--write')) {
    writeEnv(keys.publicKey, keys.privateKey);
  }
}

main();
