'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useNotification } from '../contexts/NotificationContext';

interface TelegramSendButtonProps {
  game: {
    id: string;
    title: string;
    description?: string;
    link: string;
    image?: string;
    source?: string;
    siteType?: string;
  };
  className?: string;
}

export function TelegramSendButton({ game, className = '' }: TelegramSendButtonProps) {
  const [isSending, setIsSending] = useState(false);
  const { data: session } = useSession();
  const { showSuccess, showError } = useNotification();

  const handleSendToTelegram = async () => {
    if (!session) {
      showError('Authentication Required', 'Please sign in to send games to Telegram.');
      return;
    }

    setIsSending(true);
    
    try {
      const response = await fetch('/api/telegram/send-game', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ game }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Show specific error message based on the error type
        if (data.error?.includes('not configured')) {
          showError(
            'Telegram Not Configured', 
            'Please set up your Telegram bot in user settings before using this feature.'
          );
        } else if (data.error?.includes('disabled')) {
          showError(
            'Telegram Disabled', 
            'Please enable Telegram notifications in user settings.'
          );
        } else {
          showError(
            'Failed to Send', 
            data.error || 'Failed to send to Telegram'
          );
        }
        return;
      }

      showSuccess('Sent to Telegram!', `"${game.title}" has been sent to your Telegram.`);
    } catch (error) {
      console.error('Telegram send error:', error);
      showError(
        'Network Error', 
        'Could not connect to Telegram service. Please try again.'
      );
    } finally {
      setIsSending(false);
    }
  };

  if (!session) {
    return null; // Don't show button if user is not logged in
  }

  return (
    <button
      onClick={handleSendToTelegram}
      disabled={isSending}
      className={`inline-flex items-center justify-center p-2 rounded-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      title="Send to Telegram"
      aria-label="Send game to Telegram"
    >
      {isSending ? (
        <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
      ) : (
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
      )}
    </button>
  );
}