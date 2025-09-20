#!/bin/bash

echo "🎮 AIOgames Setup Script"
echo "========================"
echo

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "📝 Creating .env.local from template..."
    cp .env.example .env.local
    echo "✅ Created .env.local"
else
    echo "ℹ️  .env.local already exists"
fi

echo
echo "🔧 Configuration Required:"
echo "========================="
echo
echo "1. MongoDB Atlas Setup:"
echo "   - Go to https://www.mongodb.com/cloud/atlas"
echo "   - Create a free cluster"
echo "   - Create a database user"
echo "   - Get your connection string"
echo
echo "2. Update your .env.local file:"
echo "   - Replace MONGODB_URI with your Atlas connection string"
echo "   - Change NEXTAUTH_SECRET to a secure random string"
echo
echo "3. Example MongoDB Atlas URI:"
echo "   mongodb+srv://username:password@cluster.mongodb.net/aiogames?retryWrites=true&w=majority"
echo
echo "4. Generate a secure NEXTAUTH_SECRET:"
echo "   You can use: openssl rand -base64 32"
echo

# Check if MongoDB URI is configured
if grep -q "mongodb+srv://.*@.*mongodb.net" .env.local 2>/dev/null; then
    echo "✅ MongoDB Atlas URI appears to be configured"
else
    echo "⚠️  MongoDB URI needs to be configured in .env.local"
fi

# Check if NEXTAUTH_SECRET is configured
if grep -q "NEXTAUTH_SECRET=your-nextauth-secret" .env.local 2>/dev/null; then
    echo "⚠️  NEXTAUTH_SECRET needs to be changed in .env.local"
else
    echo "✅ NEXTAUTH_SECRET appears to be configured"
fi

echo
echo "🚀 Next Steps:"
echo "=============="
echo "1. Configure your .env.local file (see above)"
echo "2. Install dependencies: npm install"
echo "3. Run development server: npm run dev"
echo "4. Visit http://localhost:3000 and create an account"
echo
echo "📚 For detailed setup instructions, see README.md"