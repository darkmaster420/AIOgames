const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const GITHUB_REPO = 'darkmaster420/AIOgames';

class AppUpdater {
  constructor() {
    this.currentVersion = app.getVersion();
    this.updateAvailable = false;
    this.latestVersion = null;
    this.downloadUrl = null;
    this.downloadPath = null;
    this.onUpdateAvailable = null;
  }

  /**
   * Compare two semantic versions
   * Returns true if newVersion > currentVersion
   */
  isNewerVersion(currentVersion, newVersion) {
    const current = currentVersion.replace('v', '').split('.').map(Number);
    const latest = newVersion.replace('v', '').split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (latest[i] > current[i]) return true;
      if (latest[i] < current[i]) return false;
    }
    return false;
  }

  /**
   * Fetch latest release from GitHub API
   */
  async checkForUpdates() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': 'AIOgames-Electron-App',
        },
      };

      https.get(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              console.error('[Updater] GitHub API error:', res.statusCode, data);
              return resolve(null);
            }

            const release = JSON.parse(data);
            const latestVersion = release.tag_name;
            
            console.log('[Updater] Current version:', this.currentVersion);
            console.log('[Updater] Latest version:', latestVersion);

            if (this.isNewerVersion(this.currentVersion, latestVersion)) {
              // Find the Windows installer asset
              const asset = release.assets.find(a => 
                a.name.endsWith('.exe') && a.name.includes('Setup')
              );

              if (asset) {
                this.updateAvailable = true;
                this.latestVersion = latestVersion;
                this.downloadUrl = asset.browser_download_url;
                
                console.log('[Updater] Update available:', latestVersion);
                console.log('[Updater] Download URL:', this.downloadUrl);
                
                resolve({
                  version: latestVersion,
                  url: this.downloadUrl,
                  notes: release.body || '',
                });
              } else {
                console.log('[Updater] No Windows installer found in release');
                resolve(null);
              }
            } else {
              console.log('[Updater] App is up to date');
              resolve(null);
            }
          } catch (error) {
            console.error('[Updater] Error parsing release data:', error);
            resolve(null);
          }
        });
      }).on('error', (error) => {
        console.error('[Updater] Error checking for updates:', error);
        resolve(null);
      });
    });
  }

  /**
   * Download the installer to user's downloads folder
   */
  async downloadUpdate() {
    if (!this.downloadUrl) {
      throw new Error('No download URL available');
    }

    return new Promise((resolve, reject) => {
      const downloadsPath = app.getPath('downloads');
      const fileName = `AIOgames-Setup-${this.latestVersion}.exe`;
      this.downloadPath = path.join(downloadsPath, fileName);

      console.log('[Updater] Downloading update to:', this.downloadPath);

      const file = fs.createWriteStream(this.downloadPath);
      
      https.get(this.downloadUrl, (response) => {
        // Follow redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          https.get(response.headers.location, (redirectResponse) => {
            const totalSize = parseInt(redirectResponse.headers['content-length'], 10);
            let downloaded = 0;

            redirectResponse.on('data', (chunk) => {
              downloaded += chunk.length;
              const progress = ((downloaded / totalSize) * 100).toFixed(1);
              console.log(`[Updater] Download progress: ${progress}%`);
            });

            redirectResponse.pipe(file);

            file.on('finish', () => {
              file.close();
              console.log('[Updater] Download complete:', this.downloadPath);
              resolve(this.downloadPath);
            });
          }).on('error', (error) => {
            fs.unlink(this.downloadPath, () => {});
            reject(error);
          });
        } else {
          const totalSize = parseInt(response.headers['content-length'], 10);
          let downloaded = 0;

          response.on('data', (chunk) => {
            downloaded += chunk.length;
            const progress = ((downloaded / totalSize) * 100).toFixed(1);
            if (downloaded % (1024 * 1024 * 10) < chunk.length) { // Log every ~10MB
              console.log(`[Updater] Download progress: ${progress}%`);
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            console.log('[Updater] Download complete:', this.downloadPath);
            resolve(this.downloadPath);
          });
        }
      }).on('error', (error) => {
        fs.unlink(this.downloadPath, () => {});
        console.error('[Updater] Download error:', error);
        reject(error);
      });
    });
  }

  /**
   * Check for updates once on startup
   */
  checkOnStartup(callback) {
    this.onUpdateAvailable = callback;

    // Check 30 seconds after startup to avoid slowing down app launch
    setTimeout(async () => {
      try {
        const update = await this.checkForUpdates();
        if (update && this.onUpdateAvailable) {
          this.onUpdateAvailable(update);
        }
      } catch (error) {
        console.error('[Updater] Update check failed:', error);
      }
    }, 30000);
  }
}

module.exports = AppUpdater;
