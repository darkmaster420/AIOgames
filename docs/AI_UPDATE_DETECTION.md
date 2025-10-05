# 🤖 AI-Powered Update Detection

The AIOgames application now supports AI-enhanced update detection to improve accuracy when detecting game updates from search results. This system works alongside the existing regex-based detection and provides better handling of edge cases.

## 🔧 How It Works

### 1. **Hybrid Detection System**
- **Primary**: Regex-based pattern matching (existing system)
- **Enhancement**: AI analysis when regex detection is uncertain
- **Fallback**: Regex detection if AI is unavailable

### 2. **Detection Flow**
```
Search Results → Filter by Version Patterns → Regex Analysis
                                          ↓
                    High Similarity + Uncertain? → AI Analysis
                                          ↓
                              Enhanced Update Detection
```

### 3. **AI Integration Points**
- **Uncertain Cases**: When regex finds high similarity but no clear version change
- **Complex Titles**: Game titles with non-standard versioning
- **Confidence Boosting**: AI provides confidence scores and reasoning

## 🚀 Setup & Configuration

### **Environment Variable**
Add to your `.env.local`:
```bash
# AI Update Detection Worker (Optional)
AI_DETECTION_WORKER_URL=https://your-ai-worker.your-domain.workers.dev
```

### **Worker Deployment Options**

#### **Option 1: Cloudflare Worker (Recommended)**
1. Copy the worker code from `/docs/AI_WORKER_SETUP.md`
2. Deploy to Cloudflare Workers
3. Set the worker URL in your environment

#### **Option 2: Vercel Function**
1. Create `/api/ai-worker/route.ts` in your project
2. Implement the AI logic using OpenAI/Claude API
3. Use internal URL: `http://localhost:3000/api/ai-worker`

#### **Option 3: External Service**
1. Deploy to any cloud provider (AWS Lambda, Google Cloud, etc.)
2. Ensure proper CORS configuration
3. Set the external URL in environment

## 📊 Monitoring & Status

### **Status Dashboard**
The AI detection status is shown on the Updates page alongside the scheduler status:

- **🤖✅ Available**: AI worker is online and responding
- **🤖⚠️ Unavailable**: Worker configured but not responding
- **🤖❌ Unreachable**: Worker URL set but unreachable
- **🤖⚪ Not Configured**: No worker URL configured

### **Detection Logs**
When AI detection is active, you'll see enhanced logging:
```
🤖 Trying AI detection for uncertain case: "Game Title v1.5.2 Update"
🤖✨ AI detected update with confidence 0.85: Version change detected
```

## 🎯 Benefits

### **Improved Accuracy**
- **Better Version Detection**: AI understands context better than regex
- **Natural Language**: Handles update descriptions like "bugfix release"
- **Edge Cases**: Complex versioning schemes and unusual patterns

### **Enhanced Confidence**
- **Confidence Scores**: Each detection includes confidence rating
- **Reasoning**: AI explains why it considers something an update
- **Selective Application**: Only used when regex is uncertain

### **Graceful Fallback**
- **No Dependencies**: System works without AI worker
- **Error Handling**: Automatic fallback to regex on AI failures
- **Performance**: AI only called for uncertain cases

## 🔍 API Usage

### **Batch Analysis**
```typescript
POST /api/updates/ai-detect
{
  "gameTitle": "My Game",
  "candidateTitles": [
    {
      "title": "My Game v1.5.2 Update",
      "similarity": 0.85,
      "sourceUrl": "https://...",
      "dateFound": "2025-10-04"
    }
  ],
  "context": {
    "lastKnownVersion": "v1.5.1",
    "releaseGroup": "CODEX"
  }
}
```

### **Response**
```json
{
  "success": true,
  "analysis": [
    {
      "title": "My Game v1.5.2 Update",
      "isUpdate": true,
      "confidence": 0.85,
      "reason": "Version change detected: v1.5.1 → v1.5.2",
      "similarity": 0.85
    }
  ],
  "totalProcessed": 1,
  "updatesFound": 1
}
```

## 🛠️ Utility Functions

### **Direct Integration**
```typescript
import { detectUpdatesWithAI } from '../utils/aiUpdateDetection';

const results = await detectUpdatesWithAI(
  gameTitle,
  candidates,
  context,
  { minConfidence: 0.7, debugLogging: true }
);
```

### **Status Check**
```typescript
import { isAIDetectionAvailable } from '../utils/aiUpdateDetection';

const available = await isAIDetectionAvailable();
```

## 🔧 Worker Implementation

The AI worker should implement:

1. **Health Check Endpoint**: `GET /health`
2. **Analysis Endpoint**: `POST /` (root)
3. **CORS Support**: For browser requests
4. **Error Handling**: Graceful failure responses

### **Required Response Format**
```json
{
  "success": true,
  "analysis": [
    {
      "title": "string",
      "isUpdate": boolean,
      "confidence": number, // 0.0 to 1.0
      "reason": "string"
    }
  ]
}
```

## 🎮 Game Integration

### **Automatic Integration**
The AI detection is automatically used in:
- **Individual Game Checks**: `/api/updates/check-single`
- **Scheduled Updates**: Via the automatic scheduler
- **Manual Updates**: When triggered by users

### **Enhanced Update Data**
Updates detected with AI assistance include additional metadata:
```typescript
{
  version: "Game Title v1.5.2",
  // ... other fields
  aiDetectionConfidence: 0.85,
  aiDetectionReason: "Version change detected",
  detectionMethod: "ai_enhanced"
}
```

## 🔍 Troubleshooting

### **AI Worker Not Responding**
1. Check worker URL in environment variables
2. Verify worker deployment and health endpoint
3. Check CORS configuration for browser requests
4. Review worker logs for errors

### **Low Detection Accuracy**
1. Adjust confidence thresholds in worker logic
2. Improve AI prompts for better context understanding
3. Add more specific game title patterns
4. Review and enhance training data

### **Performance Issues**
1. Limit candidates sent to AI (use `maxCandidates` option)
2. Implement request caching in worker
3. Set appropriate timeouts for AI requests
4. Monitor worker response times

---

The AI detection system enhances your existing update detection without breaking compatibility. It provides intelligent analysis while maintaining the reliability of regex-based fallbacks.