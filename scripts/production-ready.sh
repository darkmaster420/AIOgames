#!/bin/bash

# Production Cleanup and Optimization Script
echo "🚀 Preparing AIOgames for Production Deployment"
echo "================================================"

# 1. Remove development artifacts
echo "🧹 Cleaning up development artifacts..."

# Remove any remaining test files
find . -name "test-*.js" -type f -delete 2>/dev/null || true
find . -name "test-*.mjs" -type f -delete 2>/dev/null || true
find . -name "test-*.ts" -type f -delete 2>/dev/null || true
find . -name "*.test.js" -type f -delete 2>/dev/null || true
find . -name "*.test.ts" -type f -delete 2>/dev/null || true

# Remove temporary files
find . -name "*.tmp" -type f -delete 2>/dev/null || true
find . -name "*.log" -type f -delete 2>/dev/null || true
find . -name ".DS_Store" -type f -delete 2>/dev/null || true

echo "✅ Removed development artifacts"

# 2. Environment Configuration Check
echo "🔧 Checking environment configuration..."

if [ ! -f .env ]; then
    echo "⚠️  WARNING: .env file not found!"
    echo "   Please copy .env.example to .env and configure your production values"
else
    echo "✅ .env file exists"
fi

# Check critical environment variables
echo "📋 Environment variable checklist:"

check_env_var() {
    if grep -q "^$1=" .env 2>/dev/null && ! grep -q "^$1=.*example\|^$1=.*change-this\|^$1=.*your-" .env 2>/dev/null; then
        echo "✅ $1 configured"
    else
        echo "❌ $1 needs configuration"
        return 1
    fi
}

ENV_ISSUES=0
check_env_var "NEXTAUTH_URL" || ENV_ISSUES=$((ENV_ISSUES + 1))
check_env_var "NEXTAUTH_SECRET" || ENV_ISSUES=$((ENV_ISSUES + 1))
check_env_var "MONGODB_URI" || ENV_ISSUES=$((ENV_ISSUES + 1))
check_env_var "ADMIN_EMAIL" || ENV_ISSUES=$((ENV_ISSUES + 1))

if [ $ENV_ISSUES -gt 0 ]; then
    echo "⚠️  $ENV_ISSUES environment variables need configuration"
else
    echo "✅ All critical environment variables configured"
fi

# 3. Production Dependencies Check
echo "📦 Checking production dependencies..."
npm audit --audit-level high --production 2>/dev/null || echo "⚠️  Security audit found issues"

# 4. Build and type check
echo "🔨 Running production build test..."
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "✅ Production build successful"
else
    echo "❌ Production build failed - check build errors"
fi

# 5. AI Configuration Check
echo "🤖 Checking AI configuration..."
if grep -q "AI_DETECTION_WORKER_URL" .env 2>/dev/null; then
    echo "✅ AI worker URL configured"
else
    echo "⚠️  AI_DETECTION_WORKER_URL not configured (AI features will be disabled)"
fi

# 6. Security Checks
echo "🔒 Security configuration..."

# Check if AI detection public mode is disabled
if grep -q "AI_DETECTION_PUBLIC=true" .env 2>/dev/null; then
    echo "⚠️  WARNING: AI_DETECTION_PUBLIC=true (should be false in production)"
else
    echo "✅ AI detection properly secured"
fi

# Check debug flags
if grep -q "AI_DETECTION_DEBUG=true" .env 2>/dev/null; then
    echo "⚠️  WARNING: AI_DETECTION_DEBUG=true (should be false in production)"
else
    echo "✅ AI debug logging disabled"
fi

# 7. Performance Optimization Check
echo "⚡ Performance optimization status..."

if [ -f "next.config.ts" ]; then
    if grep -q "experimental.*turbopack" next.config.ts; then
        echo "✅ Turbopack enabled for faster builds"
    fi
    
    if grep -q "compress.*true\|gzip.*true" next.config.ts; then
        echo "✅ Compression enabled"
    fi
fi

# 8. Database Setup Reminder
echo "💾 Database setup checklist:"
echo "   □ MongoDB Atlas cluster created"
echo "   □ Database user configured with appropriate permissions"
echo "   □ IP whitelist configured for your deployment"
echo "   □ Connection string tested"

# 9. Deployment Checklist
echo "🚀 Pre-deployment checklist:"
echo "   □ Environment variables configured"
echo "   □ Domain/subdomain set up"
echo "   □ SSL certificate configured"
echo "   □ AI worker endpoint accessible"
echo "   □ VAPID keys generated for push notifications"
echo "   □ Admin user credentials secure"
echo "   □ Logging level set appropriately (error/warn for production)"

echo ""
echo "🎯 Production Readiness Summary:"
echo "================================"

READY=true

if [ $ENV_ISSUES -gt 0 ]; then
    echo "❌ Environment configuration incomplete"
    READY=false
else
    echo "✅ Environment configuration complete"
fi

if npm run build > /dev/null 2>&1; then
    echo "✅ Build passes"
else
    echo "❌ Build fails"
    READY=false
fi

if [ "$READY" = true ]; then
    echo ""
    echo "🎉 Project is ready for production deployment!"
    echo ""
    echo "🐳 Docker deployment options:"
    echo "   Production: docker compose -f docker-compose.production.yml up -d"
    echo "   Development: docker compose -f docker-compose.development.yml up -d"
    echo ""
    echo "🌐 Manual deployment:"
    echo "   npm run build && npm start"
else
    echo ""
    echo "⚠️  Please address the issues above before deploying to production"
fi