// Regression test for the shared release-version detection in
// src/lib/updateVersioning.ts, which /api/updates/check and
// /api/updates/check-single both rely on.
//
// The two routes used to carry their own drifted copies of this logic, so a
// change that looked harmless in one place silently altered the other. Now
// there is one implementation, and this pins its behaviour.
//
// Run with: node test-version-detection.js

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'aio-vd-'));

// Compile the module standalone, stubbing the app imports it doesn't need for
// pure version parsing (network/db helpers are only used by other exports).
const src = fs.readFileSync('src/lib/updateVersioning.ts', 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^\/\/ .*$/gm, '');

const stubs = `
const logger = { debug(){}, info(){}, warn(){}, error(){} };
const cleanGameTitle = (t) => String(t)
  .replace(/\\b(v\\d[\\w.]*|build\\s*#?\\d+|repack|proper|multi\\d+|codex|plaza|skidrow|empress|fitgirl|dodi|rune|tenoke|flt|p2p|goldberg|lws)\\b/gi, ' ')
  .replace(/[._-]+/g, ' ').replace(/\\s+/g, ' ').trim();
const getPostDetails = async () => ({ success: false });
const resolveComparableVersionData = async () => ({ version: '', build: '' });
`;

fs.writeFileSync(path.join(OUT, 'm.ts'), stubs + src);
try {
  execSync(`npx tsc "${path.join(OUT, 'm.ts')}" --outDir "${OUT}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`, { stdio: 'pipe' });
} catch {
  // tsc emits despite type errors from the stubbed imports.
}
const { extractVersionInfo, compareVersions } = await import(
  pathToFileURL(path.join(OUT, 'm.js')).href
);

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected: ${expected}\n        actual:   ${actual}`}`);
};

console.log('\n--- version / build extraction ---');
const EXTRACT = [
  ['Cyberpunk 2077 v2.1.2', '2.1.2', ''],
  ['Elden Ring v1.12.3 Build 19029387', '1.12.3', '19029387'],
  ['Schedule I v0.4.6f12', '0.4.6f12', ''],
  ['Baldurs Gate 3 v4.1.1.4667800-GOG', '4.1.1.4667800', ''],
  ['God of War Ragnarok Build 15736875-RUNE', '', '15736875'],
  ['Stardew Valley 1.6.15 FitGirl Repack', '1.6.15', ''],
  ['Factorio v2.0.76 hotfix2', '2.0.76', ''],
  ['Bloons TD 6 v54.3.10753', '54.3.10753', ''],
];
for (const [title, version, build] of EXTRACT) {
  const info = extractVersionInfo(title);
  check(`extract "${title}" version`, info.version, version);
  check(`extract "${title}" build`, info.build, build);
}

console.log('\n--- date-version detection ---');
for (const [title, isDate] of [
  ['Dead Cells v20260616-P2P', true],
  ['Beyond Two Souls v20200618', true],
  ['Winter Burrow v1.2.1', false],
]) {
  check(`isDateVersion "${title}"`, extractVersionInfo(title).isDateVersion, isDate);
}

console.log('\n--- ordering ---');
const cmp = (a, b) => compareVersions(extractVersionInfo(a), extractVersionInfo(b));
check('v1.2.1 -> v1.2.2 is newer', cmp('Game v1.2.1', 'Game v1.2.2').isNewer, true);
check('v1.2.2 -> v1.2.1 is not newer', cmp('Game v1.2.2', 'Game v1.2.1').isNewer, false);
check('same version is not newer', cmp('Game v1.2.2', 'Game v1.2.2').isNewer, false);
check('build 100 -> build 200 is newer', cmp('Game Build 100000', 'Game Build 200000').isNewer, true);
check('v0.4.6 -> v0.4.6f12 is newer (suffix patch)', cmp('Game v0.4.6', 'Game v0.4.6f12').isNewer, true);

console.log('\n--- release hierarchy (was missing from check-single) ---');
// A versioned release must not be replaced by an unversioned one.
check(
  'versioned -> unversioned is rejected',
  cmp('Game v1.2.3', 'Game REPACK').changeType,
  'rejected_hierarchy',
);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}`);
fs.rmSync(OUT, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
