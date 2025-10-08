#!/usr/bin/env node
/**
 * Simple mock AI detection worker HTTP server.
 * Reads POST JSON and returns deterministic mock analysis.
 * Used for local development of /api/updates/ai-detect endpoint without real AI infra.
 */
import http from 'http';

const PORT = process.env.MOCK_AI_PORT || 4010;

function analyze(reqBody) {
  const { originalGame, candidates } = reqBody || {};
  if (!originalGame || !Array.isArray(candidates)) {
    return {
      success: false,
      analysis: [],
      error: 'Invalid payload'
    };
  }

  const baseVersion = originalGame.lastKnownVersion || '';
  // Simple version pattern
  const versionRegex = /v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i;
  function parseVersion(str) {
    const m = (str || '').match(versionRegex);
    if (!m) return null;
    return m.slice(1).filter(Boolean).map(n => Number(n));
  }
  const currentVersion = parseVersion(baseVersion);

  const analysis = candidates.map(c => {
    const candidateVersion = parseVersion(c.title);
    let isUpdate = false;
    let reason = 'No version change detected';
    let confidence = 0.5;

    if (candidateVersion && currentVersion) {
      // Compare lexicographically
      const longer = Math.max(candidateVersion.length, currentVersion.length);
      let cmp = 0;
      for (let i = 0; i < longer; i++) {
        const a = candidateVersion[i] || 0;
        const b = currentVersion[i] || 0;
        if (a > b) { cmp = 1; break; }
        if (a < b) { cmp = -1; break; }
      }
      if (cmp === 1) {
        isUpdate = true;
        reason = `Version increased from ${baseVersion} to v${candidateVersion.join('.')}`;
        confidence = 0.9;
      } else if (cmp === 0) {
        if (/hotfix|patch|update/i.test(c.title)) {
          isUpdate = true;
          reason = 'Same version but update keyword present';
          confidence = 0.75;
        } else {
          reason = 'Same version';
        }
      }
    } else if (/hotfix|patch|update/i.test(c.title)) {
      isUpdate = true;
      reason = 'Update keyword present (no version parsed)';
      confidence = 0.7;
    }

    if (/language pack|french|spanish|german|italian|russian|polish|voice pack/i.test(c.title)) {
      // Likely not a core update
      if (isUpdate && confidence < 0.85) {
        isUpdate = false;
        reason = 'Appears to be a language/content pack';
        confidence = 0.6;
      }
    }

    return {
      title: c.title,
      similarity: c.similarity ?? 0,
      sourceUrl: c.sourceUrl,
      dateFound: c.dateFound,
      isUpdate,
      confidence,
      reason
    };
  });

  return {
    success: true,
    analysis,
    processedAt: new Date().toISOString()
  };
}

const server = http.createServer(async (req, res) => {
  // Simple health endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', mock: true }));
  }

  if (req.method === 'POST' && req.url === '/') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        const result = analyze(json);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Mock AI worker listening on http://localhost:${PORT}`);
});
