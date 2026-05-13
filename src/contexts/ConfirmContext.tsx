'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'info' | 'warning';
  resolve?: (value: boolean) => void;
}

export type ConfirmOptions = {
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'info' | 'warning';
};

/** Single-argument form (e.g. `confirm({ title, message, type: 'danger' })`) */
export type ConfirmPayload = { title: string; message: string } & ConfirmOptions;

interface ConfirmContextType {
  confirm: {
    (title: string, message: string, options?: ConfirmOptions): Promise<boolean>;
    (payload: ConfirmPayload): Promise<boolean>;
  };
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
};

interface ConfirmProviderProps {
  children: ReactNode;
}

export const ConfirmProvider: React.FC<ConfirmProviderProps> = ({ children }) => {
  const [dialog, setDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: ''
  });

  const confirm = (
    titleOrPayload: string | ConfirmPayload,
    message?: string,
    options?: ConfirmOptions
  ): Promise<boolean> => {
    let title: string;
    let body: string;
    let merged: ConfirmOptions | undefined;

    if (
      typeof titleOrPayload === 'object' &&
      titleOrPayload !== null &&
      'title' in titleOrPayload &&
      'message' in titleOrPayload
    ) {
      const p = titleOrPayload;
      title = p.title;
      body = p.message;
      merged = {
        confirmText: p.confirmText,
        cancelText: p.cancelText,
        type: p.type
      };
    } else if (typeof titleOrPayload === 'string' && typeof message === 'string') {
      title = titleOrPayload;
      body = message;
      merged = options;
    } else {
      title = 'Confirm';
      body = 'Something went wrong showing this dialog.';
      merged = { type: 'warning' };
    }

    return new Promise((resolve) => {
      setDialog({
        isOpen: true,
        title,
        message: body,
        confirmText: merged?.confirmText,
        cancelText: merged?.cancelText,
        type: merged?.type,
        resolve
      });
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

  const getTypeStyles = () => {
    switch (dialog.type) {
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

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      
      {/* Global Confirm Dialog */}
      {dialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full p-6 shadow-xl">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <span className="text-2xl">{styles.icon}</span>
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                  {dialog.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
                  {dialog.message}
                </p>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
                  >
                    {dialog.cancelText || 'Close'}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${styles.confirmButton}`}
                  >
                    {dialog.confirmText || 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};