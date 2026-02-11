// Telegram Bot Polling Script for Local Development
// This script polls Telegram for updates and forwards them to the local webhook handler

import https from 'https';
import http from 'http';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_URL = 'http://localhost:3000/api/telegram/webhook';

if (!BOT_TOKEN) {
  console.log('⚠️  TELEGRAM_BOT_TOKEN not found - skipping Telegram polling');
  console.log('💡 Set TELEGRAM_BOT_TOKEN in .env to enable Telegram bot polling');
  process.exit(0); // Exit gracefully
}

let offset = 0;

console.log('🤖 Starting Telegram bot polling...');
console.log('📡 Bot token:', BOT_TOKEN.substring(0, 10) + '...');
console.log('🎯 Forwarding to:', WEBHOOK_URL);
console.log('');

function makeRequest(url, data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: data ? 'POST' : 'GET',
      headers: data ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      } : {}
    };

    const protocol = urlObj.protocol === 'https:' ? https : http;
    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getUpdates() {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`;
    const response = await makeRequest(url);

    if (response.ok && response.result.length > 0) {
      for (const update of response.result) {
        console.log(`📨 Received update #${update.update_id}`);
        if (update.message) {
          console.log(`   Chat ID: ${update.message.chat.id}`);
          console.log(`   Username: @${update.message.from.username || 'none'}`);
          console.log(`   Text: ${update.message.text || '(no text)'}`);
        }
        
        // Forward to local webhook handler
        try {
          await makeRequest(WEBHOOK_URL, JSON.stringify(update));
          console.log(`✅ Processed update #${update.update_id}`);
        } catch (err) {
          console.error(`❌ Error processing update #${update.update_id}:`);
          console.error(err);
        }

        // Update offset to acknowledge this update
        offset = update.update_id + 1;
      }
    }
  } catch (error) {
    console.error('❌ Polling error:', error.message);
    // Wait a bit before retrying
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

async function startPolling() {
  console.log('✅ Polling started. Send messages to your bot!\n');
  
  while (true) {
    await getUpdates();
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping polling...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Stopping polling...');
  process.exit(0);
});

startPolling();
