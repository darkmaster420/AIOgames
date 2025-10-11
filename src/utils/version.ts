import packageJson from '../../package.json';

export const APP_VERSION = packageJson.version;
export const APP_NAME = packageJson.name;

export function getVersionInfo() {
  return {
    version: APP_VERSION,
    name: APP_NAME,
    buildDate: process.env.BUILD_DATE || new Date().toISOString().split('T')[0]
  };
}