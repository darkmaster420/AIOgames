import { NextRequest, NextResponse } from 'next/server';
import { TelegramBotClient, TelegramUpdate, parseCommand, handleTelegramCommand, findUserByTelegramChat } from '../../../../lib/telegramBot';
import connectDB from '../../../../lib/db';
import { TrackedGame, User } from '../../../../lib/models';
import logger from '../../../../utils/logger';
import { getPendingApprovals } from '../approve-pending/route';

interface TelegramCallback {
  id: string;
  from: {
    id: number;
    first_name: string;
    username?: string;
  };
  message?: {
    message_id: number;
    chat: {
      id: number;
    };
    text?: string;
  };
  data?: string;
}

async function handleApprovalCallback(
  callback: TelegramCallback,
  action: 'approve' | 'deny',
  approvalKey: string,
  botToken: string
): Promise<void> {
  await connectDB();
  
  const pendingApprovals = getPendingApprovals();
  const approval = pendingApprovals.get(approvalKey);
  
  if (!approval) {
    // Approval expired or doesn't exist
    await answerCallback(callback.id, '❌ This approval has expired or been completed', botToken);
    return;
  }

  // Find the user by Telegram ID
  const user = await User.findOne({ 'preferences.notifications.telegramUserId': callback.from.id.toString() });
  if (!user || user.role !== 'admin') {
    await answerCallback(callback.id, '❌ Only admins can approve/deny updates', botToken);
    return;
  }

  const userId = user._id.toString();
  
  // Check if user already voted
  if (approval.approvals.includes(userId) || approval.denials.includes(userId)) {
    await answerCallback(callback.id, 'ℹ️ You have already voted on this update', botToken);
    return;
  }

  // Record the vote
  if (action === 'approve') {
    approval.approvals.push(userId);
  } else {
    approval.denials.push(userId);
  }

  // Get all admins count
  const adminCount = await User.countDocuments({ role: 'admin' });
  const requiredApprovals = Math.ceil(adminCount / 2);

  // Check if we have enough approvals
  if (approval.approvals.length >= requiredApprovals) {
    // Approve the update
    await approveUpdate(approval.gameId, approval.updateIndex);
    
    // Notify all admins
    await notifyAdmins(
      `✅ Update approved for game!\n\n${approval.approvals.length}/${adminCount} admins approved.`,
      approval.messageIds,
      botToken
    );
    
    // Clean up
    pendingApprovals.delete(approvalKey);
    await answerCallback(callback.id, '✅ Update approved and applied!', botToken);
    
  } else if (approval.denials.length > adminCount - requiredApprovals) {
    // Too many denials - cannot reach required approvals
    await notifyAdmins(
      `❌ Update denied.\n\n${approval.denials.length}/${adminCount} admins denied.`,
      approval.messageIds,
      botToken
    );
    
    pendingApprovals.delete(approvalKey);
    await answerCallback(callback.id, '❌ Update denied', botToken);
    
  } else {
    // Still pending - update status
    const status = `Current votes: ${approval.approvals.length} approved, ${approval.denials.length} denied (${requiredApprovals} needed)`;
    await answerCallback(callback.id, status, botToken);
    
    // Update all admin messages with current status
    await updateAdminMessages(approval.messageIds, status, botToken);
  }
}

async function answerCallback(callbackId: string, text: string, botToken: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text,
        show_alert: true
      })
    });
  } catch (error) {
    logger.error('Failed to answer callback:', error);
  }
}

async function notifyAdmins(message: string, messageIds: { [key: string]: number }, botToken: string): Promise<void> {
  const promises = Object.entries(messageIds).map(async ([chatId, messageId]) => {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: parseInt(chatId),
          message_id: messageId,
          text: message,
          reply_markup: { inline_keyboard: [] } // Remove buttons
        })
      });
    } catch (error) {
      logger.error(`Failed to notify admin in chat ${chatId}:`, error);
    }
  });
  
  await Promise.all(promises);
}

async function updateAdminMessages(messageIds: { [key: string]: number }, status: string, botToken: string): Promise<void> {
  const promises = Object.entries(messageIds).map(async ([chatId, messageId]) => {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: parseInt(chatId),
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[
              { text: `✅ Approve - ${status}`, callback_data: 'status' },
              { text: '❌ Deny', callback_data: 'status' }
            ]]
          }
        })
      });
    } catch (error) {
      logger.error(`Failed to update message in chat ${chatId}:`, error);
    }
  });
  
  await Promise.all(promises);
}

async function approveUpdate(gameId: string, updateIndex: number): Promise<void> {
  const game = await TrackedGame.findById(gameId);
  if (!game || !game.pendingUpdates[updateIndex]) {
    logger.error(`Game or pending update not found: ${gameId}, index ${updateIndex}`);
    return;
  }

  const pendingUpdate = game.pendingUpdates[updateIndex];

  // Move to update history
  game.updateHistory.push({
    version: pendingUpdate.detectedVersion || pendingUpdate.version,
    build: pendingUpdate.build,
    releaseType: pendingUpdate.releaseType,
    updateType: pendingUpdate.updateType,
    changeType: pendingUpdate.changeType,
    significance: pendingUpdate.significance,
    dateFound: pendingUpdate.dateFound,
    gameLink: pendingUpdate.newLink,
    previousVersion: pendingUpdate.previousVersion,
    downloadLinks: pendingUpdate.downloadLinks || [],
    steamEnhanced: pendingUpdate.steamEnhanced,
    steamAppId: game.steamAppId
  });

  // Update latestApprovedUpdate
  game.latestApprovedUpdate = {
    version: pendingUpdate.detectedVersion || pendingUpdate.version,
    dateFound: new Date(),
    gameLink: pendingUpdate.newLink,
    downloadLinks: pendingUpdate.downloadLinks || []
  };

  // Update game metadata
  game.lastKnownVersion = pendingUpdate.detectedVersion || pendingUpdate.version;
  game.gameLink = pendingUpdate.newLink;
  game.image = pendingUpdate.newImage || game.image;
  game.lastVersionDate = new Date();

  // Remove from pending
  game.pendingUpdates.splice(updateIndex, 1);

  await game.save();
  logger.info(`Update approved and applied for game ${game.title}`);
}

export async function POST(request: NextRequest) {
  try {
    const update: TelegramUpdate & { callback_query?: TelegramCallback } = await request.json();
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ ok: true });
    }

    // Handle callback query (button clicks)
    if (update.callback_query) {
      const callback = update.callback_query;
      const data = callback.data;
      
      if (data && (data.startsWith('approve:') || data.startsWith('deny:'))) {
        const [action, approvalKey] = data.split(':');
        await handleApprovalCallback(callback, action as 'approve' | 'deny', approvalKey, botToken);
      }
      
      return NextResponse.json({ ok: true });
    }
    
    // Handle text messages
    if (!update.message?.text || !update.message.chat) {
      return NextResponse.json({ ok: true }); // Ignore non-text messages
    }

    const { message } = update;
    const chatId = message.chat.id;
    const text = message.text;

    // Find user by Telegram chat ID
    const user = await findUserByTelegramChat(chatId);
    
    if (!user) {
      // User not found - they need to set up their Telegram integration
      console.log(`Unlinked Telegram user attempted to use bot: Chat ID ${chatId}`);
      return NextResponse.json({ ok: true });
    }

    const botClient = new TelegramBotClient(botToken);

    // Handle approval/denial commands
    if (text && (text.startsWith('/approve ') || text.startsWith('/deny '))) {
      const [command, approvalKey] = text.split(' ');
      const action = command.slice(1) as 'approve' | 'deny'; // Remove '/'
      
      if (user.role !== 'admin') {
        await botClient.sendMessage(chatId, '❌ Only admins can approve/deny updates');
        return NextResponse.json({ ok: true });
      }
      
      // Create a fake callback to reuse the approval logic
      const fakeCallback: TelegramCallback = {
        id: `msg-${message.message_id}`,
        from: {
          id: message.from.id,
          first_name: message.from.first_name,
          username: message.from.username
        },
        message: {
          message_id: message.message_id,
          chat: { id: chatId },
          text: text
        },
        data: `${action}:${approvalKey}`
      };
      
      await handleApprovalCallback(fakeCallback, action, approvalKey, botToken);
      return NextResponse.json({ ok: true });
    }

    // Parse command if it's a command message
    if (text && text.startsWith('/')) {
      const botManagementEnabled = user.preferences?.notifications?.telegramBotManagementEnabled;
      
      if (!botManagementEnabled) {
        // Bot management is disabled - send helpful message
        await botClient.sendMessage(
          chatId,
          `🤖 Bot management is currently disabled.\n\nTo enable bot commands, go to your AIOgames user settings and enable "Telegram Bot Management".\n\nYou can still receive notifications!`
        );
        return NextResponse.json({ ok: true });
      }
      
      const command = parseCommand(text);
      if (command) {
        command.chatId = chatId;
        command.userId = message.from.id;
        command.messageId = message.message_id;
        
        await handleTelegramCommand(command, user, botClient);
      }
    } else if (text) {
      // Handle non-command messages
      const botManagementEnabled = user.preferences?.notifications?.telegramBotManagementEnabled;
      const helpText = botManagementEnabled 
        ? `👋 Hi! I'm your AIOgames bot.\n\nUse /help to see available commands.`
        : `👋 Hi! I'm your AIOgames bot.\n\n🔔 I'll send you game update notifications!\n\n💡 To enable bot commands like /track and /search, go to your AIOgames user settings and enable "Telegram Bot Management".`;
        
      await botClient.sendMessage(chatId, helpText);
    }

    return NextResponse.json({ ok: true });

  } catch (error) {
    console.error('Telegram webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle webhook verification
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  
  // Simple verification - you might want to make this more secure
  if (token === process.env.TELEGRAM_WEBHOOK_TOKEN) {
    return NextResponse.json({ status: 'Webhook verified' });
  }
  
  return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
}