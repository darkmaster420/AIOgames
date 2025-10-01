'use client';
import React, { useState } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'info' | 'warning';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Close',
  type = 'info'
}) => {
  if (!isOpen) return null;

  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          confirmButton: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
          icon: '⚠️'
        };
      case 'warning':
        return {
          confirmButton: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
          icon: '⚠️'
        };
      case 'info':
      default:
        return {
          confirmButton: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
          icon: 'ℹ️'
        };
    }
  };

  const styles = getTypeStyles();

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6 shadow-xl">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <span className="text-2xl">{styles.icon}</span>
          </div>
          <div className="ml-4 flex-1">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              {title}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
              {message}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${styles.confirmButton}`}
              >
                {confirmText}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const useConfirm = () => {
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'info' | 'warning';
    resolve?: (value: boolean) => void;
  }>({
    isOpen: false,
    title: '',
    message: ''
  });

  const confirm = (
    title: string,
    message: string,
    options?: {
      confirmText?: string;
      cancelText?: string;
      type?: 'danger' | 'info' | 'warning';
    }
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      console.log('Setting dialog state:', { title, message, options });
      
      // Use functional state update to ensure we're working with the latest state
      setDialog(prevDialog => {
        const newDialog = {
          isOpen: true,
          title,
          message,
          confirmText: options?.confirmText,
          cancelText: options?.cancelText,
          type: options?.type,
          resolve
        };
        console.log('New dialog object:', newDialog);
        console.log('Previous dialog state:', prevDialog);
        return newDialog;
      });
      
      console.log('Dialog state update dispatched');
    });
  };

  const handleClose = () => {
    setDialog(prev => ({ ...prev, isOpen: false }));
    if (dialog.resolve) {
      dialog.resolve(false);
    }
  };

  const handleConfirm = () => {
    setDialog(prev => ({ ...prev, isOpen: false }));
    if (dialog.resolve) {
      dialog.resolve(true);
    }
  };

  const ConfirmDialogComponent = () => {
    return (
      <ConfirmDialog
        isOpen={dialog.isOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={dialog.title}
        message={dialog.message}
        confirmText={dialog.confirmText}
        cancelText={dialog.cancelText}
        type={dialog.type}
      />
    );
  };  return { confirm, ConfirmDialog: ConfirmDialogComponent };
};