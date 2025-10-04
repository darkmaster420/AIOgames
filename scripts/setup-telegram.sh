#!/bin/bash

# Telegram Bot Setup Script for AIOgames
echo "🤖 AIOgames Telegram Bot Setup"
echo "================================"
echo ""

# Check if environment variables are set
if [ -z "$NEXTAUTH_URL" ]; then
    echo "❌ NEXTAUTH_URL environment variable is not set."
    echo "Please set NEXTAUTH_URL to your app's URL (e.g., https://yourdomain.com)"
    exit 1
fi

# Optional webhook verification token
if [ -z "$TELEGRAM_WEBHOOK_TOKEN" ]; then
    echo "⚠️  TELEGRAM_WEBHOOK_TOKEN not set. Generating a random token..."
    WEBHOOK_TOKEN=$(openssl rand -hex 32)
    echo "Generated token: $WEBHOOK_TOKEN"
    echo "Add this to your .env file: TELEGRAM_WEBHOOK_TOKEN=$WEBHOOK_TOKEN"
    echo ""
fi

echo "✅ Telegram webhook endpoint: $NEXTAUTH_URL/api/telegram/webhook"
echo ""
echo "📋 Setup Instructions:"
echo "1. Message @BotFather on Telegram"
echo "2. Create a new bot with /newbot"
echo "3. Save the bot token"
echo "4. Set up the webhook with this URL: $NEXTAUTH_URL/api/telegram/webhook"
echo "5. Get your chat ID from @userinfobot"
echo "6. Add both to your user settings in the app"
echo ""
echo "🔧 Advanced: To set webhook manually, use:"
echo "curl -X POST \"https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook\" \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"url\": \"$NEXTAUTH_URL/api/telegram/webhook\"}'"
echo ""
echo "📱 Available Bot Commands:"
echo "/start - Welcome message"
echo "/help - Show available commands"
echo "/update - Check for game updates"
echo "/track <game title> - Track a new game"
echo "/untrack <game title> - Untrack a game"
echo "/search <query> - Search for games"
echo "/list - Show tracked games"
echo "/settings - Open settings link"
echo ""
echo "🎉 Setup complete! Users can now configure their Telegram bots in the app."