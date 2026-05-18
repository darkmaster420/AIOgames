// Standalone smoke test for the cs.rin.ru integration.
// Run from repo root: node scripts/test-csrin.mjs "death stranding 2"
// Loads CSRIN_USERNAME / CSRIN_PASSWORD from .env if present.

import fs from 'node:fs';
import path from 'node:path';

// Tiny .env loader so we don't need dotenv as a dep just for this.
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(path.resolve('.env.local'));
loadDotEnv(path.resolve('.env'));

if (!process.env.CSRIN_USERNAME || !process.env.CSRIN_PASSWORD) {
  console.error('Missing CSRIN_USERNAME or CSRIN_PASSWORD in env. Aborting.');
  process.exit(1);
}

const query = process.argv[2] || 'death stranding 2';
console.log(`Searching cs.rin.ru for: "${query}"\n`);

const { fetchCsrinSearch } = await import('../src/lib/gameapi/helpers.js');

const t0 = Date.now();
const results = await fetchCsrinSearch(query);
const elapsedMs = Date.now() - t0;

console.log(`\n=== Results: ${results.length} thread(s) in ${elapsedMs}ms ===\n`);
for (const [i, r] of results.slice(0, 15).entries()) {
  console.log(`${i + 1}. ${r.title}`);
  console.log(`   ${r.link}\n`);
}
if (results.length > 15) {
  console.log(`... and ${results.length - 15} more`);
}
