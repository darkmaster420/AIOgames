'use client';

import { APP_VERSION } from '../utils/version';

export function Footer() {
  return (
    <footer className="mt-auto py-4 px-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center text-sm text-slate-600 dark:text-slate-400">
        <div className="flex items-center gap-4">
          <span>AIO Game Update Tracker</span>
          <span className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded">
            v{APP_VERSION}
          </span>
        </div>
        <div className="flex items-center gap-4 mt-2 sm:mt-0">
          <span className="text-xs">
            Last build: {new Date().toISOString().split('T')[0]}
          </span>
        </div>
      </div>
    </footer>
  );
}