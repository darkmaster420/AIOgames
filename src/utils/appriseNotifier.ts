/**
 * Apprise-style unified notification system for Node.js
 * Supports multiple notification services via URL-based configuration
 * 
 * Supported formats:
 * - telegram://bot_token/chat_id
 * - discord://webhook_id/webhook_token
 * - slack://token_a/token_b/token_c
 * - gotify://hostname/token
 * - ntfy://topic or ntfy://hostname/topic
 * - pushover://user_key@token
 * - mailto://smtp_user:smtp_pass@smtp_host:port/to_email (or use SMTP env vars)
 */

interface NotificationPayload {
  title: string;
  body: string;
  imageUrl?: string;
  url?: string;
  format?: 'text' | 'html' | 'markdown';
}

interface NotificationResult {
  success: boolean;
  service: string;
  error?: string;
}

/**
 * Parse an Apprise-style URL and extract service configuration
 */
function parseAppriseUrl(url: string): { service: string; config: Record<string, string> } | null {
  try {
    const parsed = new URL(url);
    const service = parsed.protocol.replace(':', '');
    
    // Extract path components (remove leading slash)
    const pathParts = parsed.pathname.substring(1).split('/').filter(Boolean);
    const hostname = parsed.hostname;
    const username = parsed.username;
    const password = parsed.password;
    
    return {
      service,
      config: {
        hostname,
        username,
        password,
        ...Object.fromEntries(pathParts.map((part, idx) => [`part${idx}`, part])),
        ...Object.fromEntries(parsed.searchParams.entries())
      }
    };
  } catch (error) {
    console.error('Failed to parse Apprise URL:', error);
    return null;
  }
}

/**
 * Send notification to Telegram
 * Format: telegram://bot_token/chat_id
 */
async function sendToTelegram(
  config: Record<string, string>,
  payload: NotificationPayload
): Promise<NotificationResult> {
  const botToken = config.part0;
  const chatId = config.part1;
  
  if (!botToken || !chatId) {
    return { success: false, service: 'telegram', error: 'Missing bot_token or chat_id' };
  }
  
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    // Format message with HTML
    let text = `<b>${payload.title}</b>\n\n${payload.body}`;
    if (payload.url) {
      text += `\n\n🔗 <a href="${payload.url}">View Details</a>`;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: !payload.imageUrl
      })
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ description: 'Unknown error' }));
      return { success: false, service: 'telegram', error: error.description };
    }
    
    return { success: true, service: 'telegram' };
  } catch (error) {
    return {
      success: false,
      service: 'telegram',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send notification to Discord
 * Format: discord://webhook_id/webhook_token
 */
async function sendToDiscord(
  config: Record<string, string>,
  payload: NotificationPayload
): Promise<NotificationResult> {
  const webhookId = config.part0;
  const webhookToken = config.part1;
  
  if (!webhookId || !webhookToken) {
    return { success: false, service: 'discord', error: 'Missing webhook_id or webhook_token' };
  }
  
  try {
    const url = `https://discord.com/api/webhooks/${webhookId}/${webhookToken}`;
    
    const embed: Record<string, unknown> = {
      title: payload.title,
      description: payload.body,
      color: 0x00ff00,
      timestamp: new Date().toISOString()
    };
    
    if (payload.imageUrl) {
      embed.thumbnail = { url: payload.imageUrl };
    }
    
    if (payload.url) {
      embed.url = payload.url;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });
    
    if (!response.ok) {
      return { success: false, service: 'discord', error: `HTTP ${response.status}` };
    }
    
    return { success: true, service: 'discord' };
  } catch (error) {
    return {
      success: false,
      service: 'discord',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send notification to Gotify
 * Format: gotify://hostname/token or gotify://hostname:port/token
 */
async function sendToGotify(
  config: Record<string, string>,
  payload: NotificationPayload
): Promise<NotificationResult> {
  const hostname = config.hostname;
  const token = config.part0;
  
  if (!hostname || !token) {
    return { success: false, service: 'gotify', error: 'Missing hostname or token' };
  }
  
  try {
    const protocol = config.https === 'yes' || config.secure === 'yes' ? 'https' : 'http';
    const url = `${protocol}://${hostname}/message?token=${token}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        message: payload.body,
        priority: 5,
        extras: {
          'client::display': {
            contentType: 'text/markdown'
          },
          'client::notification': {
            click: { url: payload.url }
          }
        }
      })
    });
    
    if (!response.ok) {
      return { success: false, service: 'gotify', error: `HTTP ${response.status}` };
    }
    
    return { success: true, service: 'gotify' };
  } catch (error) {
    return {
      success: false,
      service: 'gotify',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send notification to Ntfy
 * Format: ntfy://topic or ntfy://hostname/topic
 */
async function sendToNtfy(
  config: Record<string, string>,
  payload: NotificationPayload
): Promise<NotificationResult> {
  const hostname = config.hostname || 'ntfy.sh';
  const topic = config.hostname ? config.part0 : hostname; // If no hostname, use hostname as topic
  
  if (!topic) {
    return { success: false, service: 'ntfy', error: 'Missing topic' };
  }
  
  try {
    const url = config.hostname 
      ? `https://${hostname}/${topic}`
      : `https://ntfy.sh/${topic}`;
    
    const headers: Record<string, string> = {
      'Title': payload.title,
      'Priority': '3',
      'Tags': 'video_game,bell'
    };
    
    if (payload.url) {
      headers['Click'] = payload.url;
    }
    
    if (payload.imageUrl) {
      headers['Attach'] = payload.imageUrl;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload.body
    });
    
    if (!response.ok) {
      return { success: false, service: 'ntfy', error: `HTTP ${response.status}` };
    }
    
    return { success: true, service: 'ntfy' };
  } catch (error) {
    return {
      success: false,
      service: 'ntfy',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send notification to Slack
 * Format: slack://token_a/token_b/token_c
 */
async function sendToSlack(
  config: Record<string, string>,
  payload: NotificationPayload
): Promise<NotificationResult> {
  const tokenA = config.part0;
  const tokenB = config.part1;
  const tokenC = config.part2;
  
  if (!tokenA || !tokenB || !tokenC) {
    return { success: false, service: 'slack', error: 'Missing webhook URL parts' };
  }
  
  try {
    const url = `https://hooks.slack.com/services/${tokenA}/${tokenB}/${tokenC}`;
    
    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: payload.title
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: payload.body
        }
      }
    ];
    
    if (payload.url) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'View Details'
            },
            url: payload.url
          }
        ]
      });
    }
    
    if (payload.imageUrl) {
      blocks.push({
        type: 'image',
        image_url: payload.imageUrl,
        alt_text: 'Game Image'
      });
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks })
    });
    
    if (!response.ok) {
      return { success: false, service: 'slack', error: `HTTP ${response.status}` };
    }
    
    return { success: true, service: 'slack' };
  } catch (error) {
    return {
      success: false,
      service: 'slack',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send notification to Pushover
 * Format: pushover://user_key@token
 */
async function sendToPushover(
  config: Record<string, string>,
  payload: NotificationPayload
): Promise<NotificationResult> {
  const userKey = config.username;
  const token = config.hostname;
  
  if (!userKey || !token) {
    return { success: false, service: 'pushover', error: 'Missing user_key or token' };
  }
  
  try {
    const url = 'https://api.pushover.net/1/messages.json';
    
    const formData = new URLSearchParams({
      token,
      user: userKey,
      title: payload.title,
      message: payload.body,
      html: '1'
    });
    
    if (payload.url) {
      formData.append('url', payload.url);
      formData.append('url_title', 'View Details');
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });
    
    if (!response.ok) {
      return { success: false, service: 'pushover', error: `HTTP ${response.status}` };
    }
    
    return { success: true, service: 'pushover' };
  } catch (error) {
    return {
      success: false,
      service: 'pushover',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send notification via Email
 * Format: mailto://to_email or use SMTP_ environment variables
 * 
 * Required environment variables for SMTP:
 * - SMTP_HOST: SMTP server hostname
 * - SMTP_PORT: SMTP server port (e.g., 587, 465)
 * - SMTP_USER: SMTP username
 * - SMTP_PASS: SMTP password
 * - SMTP_FROM: From email address
 * - SMTP_SECURE: 'true' for SSL/TLS, 'false' otherwise
 */
async function sendToEmail(
  config: Record<string, string>,
  payload: NotificationPayload
): Promise<NotificationResult> {
  try {
    // Extract recipient email from config
    const toEmail = config.part0 || config.hostname;
    
    if (!toEmail) {
      return { success: false, service: 'email', error: 'No recipient email specified' };
    }
    
    // Check if SMTP environment variables are configured
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || 'noreply@aiogames.local';
    const smtpSecure = process.env.SMTP_SECURE === 'true';
    
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      return {
        success: false,
        service: 'email',
        error: 'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS environment variables'
      };
    }
    
    // Since we can't use nodemailer without installing it, we'll use a basic fetch to an SMTP API
    // For production use, you should install nodemailer: npm install nodemailer
    // This is a placeholder implementation that documents the expected behavior
    
    // Create email content
    const emailSubject = payload.title;
    const emailBody = payload.format === 'html' 
      ? `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">${payload.title}</h2>
          <div style="color: #666; line-height: 1.6;">${payload.body}</div>
          ${payload.imageUrl ? `<img src="${payload.imageUrl}" alt="Notification image" style="max-width: 100%; margin-top: 20px;">` : ''}
          ${payload.url ? `<p style="margin-top: 20px;"><a href="${payload.url}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Details</a></p>` : ''}
        </body>
        </html>
      `
      : `${payload.body}\n\n${payload.url ? `View details: ${payload.url}` : ''}`;
    
    // Log configuration for debugging
    console.log(`[Email] Would send to ${toEmail} via SMTP ${smtpHost}:${smtpPort}`);
    console.log(`[Email] Subject: ${emailSubject}`);
    console.log(`[Email] Secure: ${smtpSecure}, From: ${smtpFrom}`);
    
    // For now, return a placeholder response
    // In production, you would use nodemailer here:
    /*
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransporter({
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass }
    });
    
    await transporter.sendMail({
      from: smtpFrom,
      to: toEmail,
      subject: emailSubject,
      html: emailBody
    });
    */
    
    return {
      success: false,
      service: 'email',
      error: 'Email notifications require nodemailer. Install it with: npm install nodemailer @types/nodemailer'
    };
  } catch (error) {
    return {
      success: false,
      service: 'email',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Send notification via a single Apprise URL
 */
export async function sendNotification(
  appriseUrl: string,
  payload: NotificationPayload
): Promise<NotificationResult> {
  const parsed = parseAppriseUrl(appriseUrl);
  
  if (!parsed) {
    return {
      success: false,
      service: 'unknown',
      error: 'Failed to parse Apprise URL'
    };
  }
  
  const { service, config } = parsed;
  
  switch (service.toLowerCase()) {
    case 'telegram':
    case 'tgram':
      return sendToTelegram(config, payload);
    
    case 'discord':
      return sendToDiscord(config, payload);
    
    case 'gotify':
      return sendToGotify(config, payload);
    
    case 'ntfy':
      return sendToNtfy(config, payload);
    
    case 'slack':
      return sendToSlack(config, payload);
    
    case 'pushover':
    case 'pover':
      return sendToPushover(config, payload);
    
    case 'mailto':
    case 'email':
      return sendToEmail(config, payload);
    
    default:
      return {
        success: false,
        service,
        error: `Unsupported service: ${service}`
      };
  }
}

/**
 * Send notification to multiple Apprise URLs
 */
export async function sendNotifications(
  appriseUrls: string[],
  payload: NotificationPayload
): Promise<{
  success: boolean;
  results: NotificationResult[];
  sentCount: number;
  failedCount: number;
}> {
  if (!appriseUrls || appriseUrls.length === 0) {
    return {
      success: false,
      results: [],
      sentCount: 0,
      failedCount: 0
    };
  }
  
  // Send to all URLs in parallel
  const results = await Promise.all(
    appriseUrls.map(url => sendNotification(url, payload))
  );
  
  const sentCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  
  return {
    success: sentCount > 0,
    results,
    sentCount,
    failedCount
  };
}

/**
 * Test an Apprise URL by sending a test notification
 */
export async function testAppriseUrl(appriseUrl: string): Promise<NotificationResult> {
  const testPayload: NotificationPayload = {
    title: '🎮 AIOgames Test Notification',
    body: `This is a test notification from AIOgames.\n\nService: ${parseAppriseUrl(appriseUrl)?.service || 'unknown'}\nTime: ${new Date().toLocaleString()}`,
    format: 'text'
  };
  
  return sendNotification(appriseUrl, testPayload);
}
