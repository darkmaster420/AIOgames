# AI Update Detection Worker

This is a template for an AI worker that analyzes game titles to determine if they represent updates. You can deploy this as a separate service (Cloudflare Worker, Vercel Function, etc.) or integrate it into your existing infrastructure.

## Worker Implementation Examples

### Option 1: Cloudflare Worker

```javascript
// worker.js for Cloudflare Workers
export default {
  async fetch(request) {
    // Handle CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Health check endpoint
    if (request.url.endsWith('/health')) {
      return Response.json({
        status: 'healthy',
        service: 'ai-update-detection',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const data = await request.json();
      const { originalGame, candidates } = data;

      if (!originalGame || !Array.isArray(candidates)) {
        return Response.json({
          success: false,
          error: 'Invalid request format'
        }, { status: 400 });
      }

      // AI Analysis Logic
      const analysis = await analyzeGameTitles(originalGame, candidates);

      return Response.json({
        success: true,
        analysis,
        processedAt: new Date().toISOString()
      }, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      });

    } catch (error) {
      return Response.json({
        success: false,
        error: 'Internal server error'
      }, { status: 500 });
    }
  }
};

async function analyzeGameTitles(originalGame, candidates) {
  const analysis = [];

  for (const candidate of candidates) {
    const result = await detectUpdate(originalGame, candidate);
    analysis.push(result);
  }

  return analysis;
}

async function detectUpdate(originalGame, candidate) {
  // Basic AI-like logic (replace with actual AI service calls)
  const originalTitle = originalGame.title.toLowerCase();
  const candidateTitle = candidate.title.toLowerCase();
  
  let isUpdate = false;
  let confidence = 0.5;
  let reason = 'Basic pattern analysis';

  // Version number detection
  const versionPatterns = [
    /v?\d+\.\d+(\.\d+)?/i,
    /build\s*\d+/i,
    /patch\s*\d+/i,
    /update\s*\d+/i
  ];

  const originalVersions = extractVersions(originalTitle, versionPatterns);
  const candidateVersions = extractVersions(candidateTitle, versionPatterns);

  // Check for version changes
  if (candidateVersions.length > 0 && originalVersions.length > 0) {
    const versionChanged = !originalVersions.some(ov => 
      candidateVersions.some(cv => cv === ov)
    );
    
    if (versionChanged) {
      isUpdate = true;
      confidence = 0.85;
      reason = `Version change detected: ${originalVersions.join(', ')} → ${candidateVersions.join(', ')}`;
    }
  }

  // Check for update keywords
  const updateKeywords = [
    'update', 'patch', 'hotfix', 'fixed', 'bugfix', 
    'new version', 'latest', 'revised', 'improved'
  ];

  const hasUpdateKeywords = updateKeywords.some(keyword => 
    candidateTitle.includes(keyword) && !originalTitle.includes(keyword)
  );

  if (hasUpdateKeywords && candidate.similarity > 0.8) {
    isUpdate = true;
    confidence = Math.max(confidence, 0.75);
    reason = 'Update keywords detected with high similarity';
  }

  // Check for build numbers
  const buildRegex = /build\s*(\d+)/i;
  const originalBuild = originalTitle.match(buildRegex);
  const candidateBuild = candidateTitle.match(buildRegex);

  if (originalBuild && candidateBuild) {
    const origNum = parseInt(originalBuild[1]);
    const candNum = parseInt(candidateBuild[1]);
    
    if (candNum > origNum) {
      isUpdate = true;
      confidence = 0.9;
      reason = `Build number increased: ${origNum} → ${candNum}`;
    }
  }

  // Date-based version detection
  const datePattern = /(\d{4})[-.]?(\d{2})[-.]?(\d{2})/;
  const originalDate = originalTitle.match(datePattern);
  const candidateDate = candidateTitle.match(datePattern);

  if (originalDate && candidateDate) {
    const origDateStr = `${originalDate[1]}${originalDate[2]}${originalDate[3]}`;
    const candDateStr = `${candidateDate[1]}${candidateDate[2]}${candidateDate[3]}`;
    
    if (candDateStr > origDateStr) {
      isUpdate = true;
      confidence = 0.8;
      reason = `Date version updated: ${origDateStr} → ${candDateStr}`;
    }
  }

  return {
    title: candidate.title,
    similarity: candidate.similarity,
    sourceUrl: candidate.sourceUrl,
    dateFound: candidate.dateFound,
    isUpdate,
    confidence,
    reason
  };
}

function extractVersions(text, patterns) {
  const versions = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      versions.push(matches[0]);
    }
  }
  return versions;
}
```

### Option 2: Next.js API Route (if you want to self-host)

```typescript
// pages/api/ai-worker.ts or app/api/ai-worker/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const { originalGame, candidates } = data;

    if (!originalGame || !Array.isArray(candidates)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request format'
      }, { status: 400 });
    }

    // Use OpenAI API, Claude API, or other AI service
    const analysis = await analyzeWithAI(originalGame, candidates);

    return NextResponse.json({
      success: true,
      analysis,
      processedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('AI worker error:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}

async function analyzeWithAI(originalGame, candidates) {
  // Example using OpenAI (replace with your preferred AI service)
  const prompt = `
Analyze these game titles to determine if they are updates to the original game.

Original Game: "${originalGame.title}"
Last Known Version: "${originalGame.lastKnownVersion || 'Unknown'}"

Candidates to analyze:
${candidates.map((c, i) => `${i + 1}. "${c.title}" (similarity: ${c.similarity})`).join('\n')}

For each candidate, determine:
1. Is it an update to the original game?
2. Confidence level (0.0 to 1.0)
3. Reason for the decision

Focus on version numbers, build numbers, release dates, and update keywords.
Respond in JSON format with an array of analysis objects.
`;

  // Call your AI service here
  // This is a placeholder - implement your actual AI API call
  
  // Fallback to rule-based analysis if AI is unavailable
  return candidates.map(candidate => {
    // Simple rule-based logic as fallback
    const isUpdate = detectUpdateRuleBased(originalGame, candidate);
    return {
      title: candidate.title,
      similarity: candidate.similarity,
      sourceUrl: candidate.sourceUrl,
      dateFound: candidate.dateFound,
      isUpdate: isUpdate.isUpdate,
      confidence: isUpdate.confidence,
      reason: isUpdate.reason
    };
  });
}
```

## Environment Variables

Add to your `.env.local`:

```bash
# AI Worker URL - point this to your deployed worker
AI_DETECTION_WORKER_URL=https://your-worker.your-domain.workers.dev

# If using OpenAI or other AI services in the worker
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

## Deployment Options

1. **Cloudflare Workers**: Fast, serverless, global distribution
2. **Vercel Functions**: Easy integration with existing Next.js app
3. **AWS Lambda**: Scalable serverless option
4. **Self-hosted**: Run as part of your existing infrastructure

## Integration

The AI worker should:
1. Accept POST requests with game title analysis data
2. Return structured analysis results
3. Handle errors gracefully
4. Provide health check endpoint
5. Support CORS for browser requests

The main application will automatically fall back to regex-based detection if the AI worker is unavailable.