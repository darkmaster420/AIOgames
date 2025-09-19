import axios from 'axios';

class JDownloaderService {
    constructor(config = {}) {
        this.config = {
            apiUrl: config.apiUrl || 'http://localhost:3128/jd',
            email: config.email,
            password: config.password,
            deviceId: config.deviceId
        };
        this.axios = axios.create({
            baseURL: this.config.apiUrl,
            timeout: 10000
        });
    }

    async connect() {
        try {
            // Authenticate with MyJDownloader
            const response = await this.axios.post('/connect', {
                email: this.config.email,
                password: this.config.password
            });
            
            if (response.data.sessionToken) {
                this.sessionToken = response.data.sessionToken;
                console.log('Connected to JDownloader service');
                return true;
            }
            throw new Error('Failed to connect to JDownloader');
        } catch (error) {
            console.error('Error connecting to JDownloader:', error);
            throw error;
        }
    }

    async addDownload(url, options = {}) {
        try {
            if (!this.sessionToken) {
                throw new Error('Not connected to JDownloader');
            }

            const downloadData = {
                urls: [url],
                packageName: options.packageName || 'AIOgames Download',
                directory: options.directory || '/downloads',
                autoStart: options.autoStart !== false,
                extractAfterDownload: options.extract !== false
            };

            const response = await this.axios.post('/downloads/add', downloadData, {
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`
                }
            });

            return {
                id: response.data.id,
                status: 'added'
            };
        } catch (error) {
            console.error('Error adding download to JDownloader:', error);
            throw error;
        }
    }

    async getStatus(downloadId) {
        try {
            if (!this.sessionToken) {
                throw new Error('Not connected to JDownloader');
            }

            const response = await this.axios.get(`/downloads/${downloadId}`, {
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`
                }
            });

            return {
                id: downloadId,
                status: response.data.status,
                progress: response.data.progress,
                bytesLoaded: response.data.bytesLoaded,
                bytesTotal: response.data.bytesTotal,
                speed: response.data.speed
            };
        } catch (error) {
            console.error('Error getting download status from JDownloader:', error);
            throw error;
        }
    }

    supportsUrl(url) {
        // List of hosting services supported by JDownloader
        const supportedHosts = [
            'mega.nz',
            'mediafire.com',
            '1fichier.com',
            'rapidgator.net',
            'uploaded.net',
            'zippyshare.com',
            'nitroflare.com',
            'turbobit.net',
            'uptobox.com',
            'uploaded.to',
            'filefactory.com'
        ];

        try {
            const hostname = new URL(url).hostname;
            return supportedHosts.some(host => hostname.includes(host));
        } catch (error) {
            return false;
        }
    }
}

module.exports = JDownloaderService;