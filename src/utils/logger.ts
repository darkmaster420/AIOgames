import { NextRequest } from 'next/server';

type Level = 'error' | 'warn' | 'info' | 'debug';

const envLevel = (typeof process !== 'undefined' && (process.env.LOG_LEVEL as Level)) || 'info';
const isDev = process.env.NODE_ENV === 'development';
const levels: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function enabled(level: Level) {
  const current = levels[envLevel] ?? 2;
  return levels[level] <= current;
}

export const logger = {
  error: (...args: unknown[]) => { if (enabled('error')) console.error('[ERROR]', ...args); },
  warn: (...args: unknown[])  => { if (enabled('warn')) console.warn('[WARN]', ...args); },
  info: (...args: unknown[])  => { if (enabled('info')) console.info('[INFO]', ...args); },
  debug: (...args: unknown[]) => { if (enabled('debug') && isDev) console.debug('[DEBUG]', ...args); },
  
  // API request logging helper
  apiRequest: (req: NextRequest, message: string) => {
    if (enabled('info')) {
      const method = req.method;
      const url = new URL(req.url).pathname;
      const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
      console.log(`[API] ${method} ${url} - ${message} (IP: ${ip})`);
    }
  },

  // Performance timing helpers
  time: (label: string) => { if (enabled('debug') && isDev) console.time(`[PERF] ${label}`); },
  timeEnd: (label: string) => { if (enabled('debug') && isDev) console.timeEnd(`[PERF] ${label}`); }
};

export default logger;
