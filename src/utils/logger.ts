type Level = 'error' | 'warn' | 'info' | 'debug';

const envLevel = (typeof process !== 'undefined' && (process.env.LOG_LEVEL as Level)) || 'info';
const levels: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function enabled(level: Level) {
  const current = levels[envLevel] ?? 2;
  return levels[level] <= current;
}

export const logger = {
  error: (...args: unknown[]) => { if (enabled('error')) console.error(...args); },
  warn: (...args: unknown[])  => { if (enabled('warn')) console.warn(...args); },
  info: (...args: unknown[])  => { if (enabled('info')) console.info(...args); },
  debug: (...args: unknown[]) => { if (enabled('debug')) console.debug(...args); },
};

export default logger;
