'use client';
import React, { useEffect } from 'react';
import { useNotification, type Notification, type NotificationType } from '../contexts/NotificationContext';

const NotificationItem: React.FC<{
  notification: Notification;
  onRemove: (id: string) => void;
}> = ({ notification, onRemove }) => {
  const { id, type, title, message } = notification;

  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(id);
    }, notification.duration || 5000);

    return () => clearTimeout(timer);
  }, [id, notification.duration, onRemove]);

  const getTypeStyles = (type: NotificationType) => {
    switch (type) {
      case 'success':
        return {
          background: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
          icon: '✅',
          titleColor: 'text-green-800 dark:text-green-200',
          messageColor: 'text-green-600 dark:text-green-300'
        };
      case 'error':
        return {
          background: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
          icon: '❌',
          titleColor: 'text-red-800 dark:text-red-200',
          messageColor: 'text-red-600 dark:text-red-300'
        };
      case 'warning':
        return {
          background: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
          icon: '⚠️',
          titleColor: 'text-yellow-800 dark:text-yellow-200',
          messageColor: 'text-yellow-600 dark:text-yellow-300'
        };
      case 'info':
      default:
        return {
          background: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
          icon: 'ℹ️',
          titleColor: 'text-blue-800 dark:text-blue-200',
          messageColor: 'text-blue-600 dark:text-blue-300'
        };
    }
  };

  const styles = getTypeStyles(type);

  return (
    <div className={`${styles.background} border-l-4 p-4 rounded-lg shadow-lg mb-3 animate-in slide-in-from-right duration-300 max-w-sm`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <span className="text-lg">{styles.icon}</span>
        </div>
        <div className="ml-3 flex-1">
          <p className={`text-sm font-medium ${styles.titleColor}`}>
            {title}
          </p>
          {message && (
            <p className={`text-sm mt-1 ${styles.messageColor}`}>
              {message}
            </p>
          )}
        </div>
        <div className="ml-4 flex-shrink-0">
          <button
            type="button"
            className={`inline-flex ${styles.titleColor} hover:opacity-75 transition-opacity`}
            onClick={() => onRemove(id)}
          >
            <span className="sr-only">Close</span>
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export const NotificationContainer: React.FC = () => {
  const { notifications, removeNotification } = useNotification();

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onRemove={removeNotification}
        />
      ))}
    </div>
  );
};