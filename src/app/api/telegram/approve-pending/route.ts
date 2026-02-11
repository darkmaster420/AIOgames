import { NextRequest, NextResponse } from 'next/server';
import connectDB from '../../../../lib/db';
import { User } from '../../../../lib/models';
import logger from '../../../../utils/logger';

interface PendingApprovalVote {
  gameId: string;
  updateIndex: number;
  approvals: string[]; // Array of user IDs who approved
  denials: string[]; // Array of user IDs who denied
  messageIds: { [key: string]: number }; // chatId -> messageId mapping
}

// In-memory storage for pending approvals (in production, use Redis or DB)
const pendingApprovalsVotes = new Map<string, PendingApprovalVote>();

/**
 * Send pending update approval requests to all admins via Telegram
 */
export async function POST(req: NextRequest) {
  try {
    const { gameId, updateIndex, gameTitle, newTitle, detectedVersion, reason } = await req.json();

    if (!gameId || updateIndex === undefined) {
      return NextResponse.json(
        { error: 'gameId and updateIndex are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Get all admin users with Telegram enabled (notifyImmediately: true and chatId configured)
    const adminUsers = await User.find({
      role: 'admin',
      'preferences.notifications.notifyImmediately': true,
      'preferences.notifications.telegramChatId': { $exists: true, $ne: null }
    });

    if (adminUsers.length === 0) {
      logger.info('No admin users with Telegram enabled found');
      return NextResponse.json({
        success: true,
        message: 'No admins to notify'
      });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logger.error('TELEGRAM_BOT_TOKEN not configured');
      return NextResponse.json(
        { error: 'Telegram bot not configured' },
        { status: 500 }
      );
    }

    // Create approval key
    const approvalKey = `${gameId}-${updateIndex}`;
    
    // Initialize pending approval if not exists
    if (!pendingApprovalsVotes.has(approvalKey)) {
      pendingApprovalsVotes.set(approvalKey, {
        gameId,
        updateIndex,
        approvals: [],
        denials: [],
        messageIds: {}
      });
    }

    const requiredApprovals = Math.ceil(adminUsers.length / 2);

    // Send approval request to each admin
    const messagePromises = adminUsers.map(async (admin) => {
      const chatId = parseInt(admin.preferences.notifications.telegramChatId);
      
      const message = `🔔 <b>Pending Update Approval</b>\n\n` +
        `📦 <b>Game:</b> ${gameTitle}\n` +
        `🆕 <b>New Title:</b> ${newTitle}\n` +
        `📌 <b>Version:</b> ${detectedVersion || 'N/A'}\n` +
        `📝 <b>Reason:</b> ${reason}\n\n` +
        `⚖️ Requires ${requiredApprovals} of ${adminUsers.length} admin approvals\n\n` +
        `Reply with <code>/approve ${approvalKey}</code> or <code>/deny ${approvalKey}</code>`;

      try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '✅ Approve',
                  callback_data: `approve:${approvalKey}`
                },
                {
                  text: '❌ Deny',
                  callback_data: `deny:${approvalKey}`
                }
              ]]
            }
          })
        });

        const result = await response.json();
        if (result.ok) {
          const approval = pendingApprovalsVotes.get(approvalKey);
          if (approval) {
            approval.messageIds[chatId.toString()] = result.result.message_id;
          }
        }

        return result.ok;
      } catch (error) {
        logger.error(`Failed to send approval request to admin ${admin.email}:`, error);
        return false;
      }
    });

    const results = await Promise.all(messagePromises);
    const successCount = results.filter(r => r).length;

    logger.info(`Sent pending update approval to ${successCount}/${adminUsers.length} admins for ${gameTitle}`);

    return NextResponse.json({
      success: true,
      message: `Approval request sent to ${successCount} admins`,
      adminsNotified: successCount
    });

  } catch (error) {
    logger.error('Error sending approval requests:', error);
    return NextResponse.json(
      { error: 'Failed to send approval requests' },
      { status: 500 }
    );
  }
}

/**
 * Get the pending approvals map (for webhook handler)
 * Note: This is an internal function, not exported from the route
 */
function getPendingApprovals() {
  return pendingApprovalsVotes;
}
