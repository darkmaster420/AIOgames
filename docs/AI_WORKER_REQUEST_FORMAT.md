# 🔧 AI Worker Request Format & Examples

## 📨 Request Structure

Your AI worker will receive POST requests with this exact format:

### **Request Format**
```json
{
  "originalGame": {
    "title": "Game Name",
    "lastKnownVersion": "v1.5.1",
    "releaseGroup": "CODEX",
    "currentLink": "https://current-game-link.com"
  },
  "candidates": [
    {
      "title": "Game Name v1.5.2 Update CODEX",
      "similarity": 0.85,
      "sourceUrl": "https://example.com/game-post",
      "dateFound": "2025-10-04T12:00:00Z"
    },
    {
      "title": "Game Name v1.6.0 REPACK",
      "similarity": 0.78,
      "sourceUrl": "https://example.com/game-post-2",
      "dateFound": "2025-10-03T15:30:00Z"
    }
  ]
}
```

### **Expected Response Format**
```json
{
  "success": true,
  "analysis": [
    {
      "title": "Game Name v1.5.2 Update CODEX",
      "similarity": 0.85,
      "sourceUrl": "https://example.com/game-post",
      "dateFound": "2025-10-04T12:00:00Z",
      "isUpdate": true,
      "confidence": 0.9,
      "reason": "Version number increased from v1.5.1 to v1.5.2"
    },
    {
      "title": "Game Name v1.6.0 REPACK",
      "similarity": 0.78,
      "sourceUrl": "https://example.com/game-post-2", 
      "dateFound": "2025-10-03T15:30:00Z",
      "isUpdate": true,
      "confidence": 0.95,
      "reason": "Major version update from v1.5.1 to v1.6.0"
    }
  ],
  "processedAt": "2025-10-04T12:05:00Z"
}
```

## 🎯 Real Example Requests

### **Example 1: Version Update Detection**
```json
{
  "originalGame": {
    "title": "Cyberpunk 2077",
    "lastKnownVersion": "v2.0.1",
    "releaseGroup": "GOG",
    "currentLink": "https://site.com/cyberpunk-2077-v201-gog"
  },
  "candidates": [
    {
      "title": "Cyberpunk 2077 v2.1.0 Hotfix GOG",
      "similarity": 0.92,
      "sourceUrl": "https://site.com/cyberpunk-2077-v210-hotfix",
      "dateFound": "2025-10-04T10:30:00Z"
    }
  ]
}
```

**Expected AI Analysis:**
- ✅ `isUpdate: true` 
- ✅ `confidence: 0.95`
- ✅ `reason: "Version updated from v2.0.1 to v2.1.0 with hotfix"`

### **Example 2: Build Number Update**
```json
{
  "originalGame": {
    "title": "Some Game",
    "lastKnownVersion": "Some Game v1.0 Build 12345 CODEX",
    "releaseGroup": "CODEX",
    "currentLink": "https://site.com/some-game-build-12345"
  },
  "candidates": [
    {
      "title": "Some Game v1.0 Build 12567 CODEX",
      "similarity": 0.88,
      "sourceUrl": "https://site.com/some-game-build-12567",
      "dateFound": "2025-10-04T11:00:00Z"
    }
  ]
}
```

**Expected AI Analysis:**
- ✅ `isUpdate: true`
- ✅ `confidence: 0.9` 
- ✅ `reason: "Build number increased from 12345 to 12567"`

### **Example 3: Non-Update (Similar but Same)**
```json
{
  "originalGame": {
    "title": "Game Title",
    "lastKnownVersion": "v1.5.0",
    "releaseGroup": "FITGIRL",
    "currentLink": "https://site.com/game-v150-fitgirl"
  },
  "candidates": [
    {
      "title": "Game Title v1.5.0 Different Language Pack FITGIRL", 
      "similarity": 0.85,
      "sourceUrl": "https://site.com/game-v150-lang-pack",
      "dateFound": "2025-10-04T09:00:00Z"
    }
  ]
}
```

**Expected AI Analysis:**
- ❌ `isUpdate: false`
- ✅ `confidence: 0.8`
- ✅ `reason: "Same version v1.5.0, likely language pack variant"`

## 🤖 Simple AI Worker Implementation

### **Basic Worker Logic**
```javascript
export default {
  async fetch(request) {
    if (request.method === 'POST') {
      const data = await request.json();
      const { originalGame, candidates } = data;
      
      const analysis = candidates.map(candidate => {
        return analyzeCandidate(originalGame, candidate);
      });
      
      return Response.json({
        success: true,
        analysis,
        processedAt: new Date().toISOString()
      });
    }
  }
};

function analyzeCandidate(originalGame, candidate) {
  const originalVersion = extractVersion(originalGame.lastKnownVersion || originalGame.title);
  const candidateVersion = extractVersion(candidate.title);
  
  let isUpdate = false;
  let confidence = 0.5;
  let reason = 'Pattern analysis';
  
  // Version comparison logic
  if (originalVersion && candidateVersion) {
    if (compareVersions(candidateVersion, originalVersion) > 0) {
      isUpdate = true;
      confidence = 0.9;
      reason = `Version updated from ${originalVersion} to ${candidateVersion}`;
    } else if (candidateVersion === originalVersion) {
      // Check for build numbers, update types, etc.
      const updateKeywords = ['update', 'hotfix', 'patch', 'fixed'];
      const hasUpdateKeywords = updateKeywords.some(keyword => 
        candidate.title.toLowerCase().includes(keyword)
      );
      
      if (hasUpdateKeywords) {
        isUpdate = true;
        confidence = 0.7;
        reason = `Same version but contains update keywords`;
      }
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
```

## 🔍 Testing Your Worker

### **Test Request (curl)**
```bash
curl -X POST https://your-worker-url.workers.dev \
  -H "Content-Type: application/json" \
  -d '{
    "originalGame": {
      "title": "Test Game",
      "lastKnownVersion": "v1.0.0"
    },
    "candidates": [
      {
        "title": "Test Game v1.1.0 Update",
        "similarity": 0.9,
        "sourceUrl": "https://test.com",
        "dateFound": "2025-10-04T12:00:00Z"
      }
    ]
  }'
```

### **Expected Response**
```json
{
  "success": true,
  "analysis": [
    {
      "title": "Test Game v1.1.0 Update",
      "similarity": 0.9,
      "sourceUrl": "https://test.com",
      "dateFound": "2025-10-04T12:00:00Z",
      "isUpdate": true,
      "confidence": 0.9,
      "reason": "Version updated from v1.0.0 to v1.1.0"
    }
  ],
  "processedAt": "2025-10-04T12:05:00Z"
}
```

## 🎯 Key Points for Your AI Logic

### **What to Detect**
1. **Version Changes**: `v1.0.0` → `v1.1.0`
2. **Build Updates**: `Build 12345` → `Build 12567` 
3. **Update Keywords**: "hotfix", "patch", "update", "fixed"
4. **Date Versions**: `20250101` → `20250104`

### **What to Ignore**
1. **Same Version**: Exact same version/build numbers
2. **Language Packs**: Different language, same version
3. **Repacks**: Different release group, same version
4. **Platform Variants**: Steam vs GOG versions

### **Confidence Scoring**
- **0.9+**: Clear version/build number increase
- **0.7-0.9**: Update keywords with high similarity  
- **0.5-0.7**: Uncertain cases that need user review
- **0.3-0.5**: Likely not an update

This gives you the exact structure to build your AI worker around!