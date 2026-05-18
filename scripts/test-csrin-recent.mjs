// One-shot: log in, fetch latest threads from Game Releases subforum.
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const k = l.slice(0, eq).trim();
    let v = l.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadDotEnv(path.resolve('.env.local'));
loadDotEnv(path.resolve('.env'));

const { fetchCsrinRecent } = await import('../src/lib/gameapi/helpers.js');
const t0 = Date.now();
const results = await fetchCsrinRecent();
console.log(`\n=== ${results.length} recent threads in ${Date.now() - t0}ms ===\n`);
for (const [i, r] of results.slice(0, 12).entries()) {
  console.log(`${i + 1}. ${r.title}`);
  console.log(`   ${r.link}\n`);
}
if (results.length > 12) console.log(`... and ${results.length - 12} more`);
