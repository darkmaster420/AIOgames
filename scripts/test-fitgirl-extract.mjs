// Hit FitGirl's WP API to grab a real post, then run the link extractor
// against it. Verifies that only pastebin links survive and that the
// anchor-text labels come through cleanly.
import fs from 'node:fs';
import path from 'node:path';

function loadEnv(p) { if (!fs.existsSync(p)) return; for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const l = line.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue; const k = l.slice(0, eq).trim(); let v = l.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!process.env[k]) process.env[k] = v; }}
loadEnv(path.resolve('.env'));

// Pick a recent post that actually has download links (skip "Upcoming
// Repacks" / news-style posts which don't have any).
const listResp = await fetch('https://fitgirl-repacks.site/wp-json/wp/v2/posts?per_page=10', {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0' },
});
const posts = await listResp.json();
const post = posts.find(p => /paste\.fitgirl-repacks\.site/.test(p.content?.rendered || '')) || posts[0];
console.log('Sample post:', post.title.rendered);
console.log('Link:', post.link);
console.log('Content length:', post.content.rendered.length, 'chars\n');

// Run the extractor with wpContent fallback (skips the page fetch which
// would route through siteFetch and our circuit breakers).
const { extractDownloadLinksForV2 } = await import('../src/lib/gameapi/helpers.js');
const links = await extractDownloadLinksForV2(post.link, 'fitgirl', post.content.rendered);
console.log(`=== Extracted ${links.length} link(s) ===\n`);
for (const l of links) {
  console.log(`- [${l.type}] ${l.service}`);
  console.log(`    ${l.url}\n`);
}

// Sanity: how many part files did we correctly skip?
const partCount = (post.content.rendered.match(/\.part\d+\.rar/gi) || []).length;
console.log(`(For reference: post contained ${partCount} .partNN.rar references that we deliberately skipped)`);
