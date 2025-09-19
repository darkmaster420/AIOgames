import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class JDownloaderService {
    constructor(config = {}) {
        // Support both container networking and local development
        const getJDownloaderUrl = () => {
            if (process.env.NODE_ENV === 'production' || process.env.DOCKER_ENV) {
                return process.env.JD_API_URL || 'http://jdownloader:3128/jd';
            }
            return process.env.JD_API_URL || 'http://localhost:3128/jd';
        };

        this.config = {
            apiUrl: getJDownloaderUrl(),
            email: process.env.JD_EMAIL,
            password: process.env.JD_PASSWORD,
            deviceId: process.env.JD_DEVICE_ID
        };
        
        this.axios = axios.create({
            baseURL: this.config.apiUrl,
            timeout: 15000 // Extended timeout for container networking
        });

        console.log(`🔗 JDownloader service configured for URL: ${this.config.apiUrl}`);
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
                await this.connect();
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

    async getDownloads() {
        try {
            if (!this.sessionToken) {
                await this.connect();
            }

            const response = await this.axios.get('/downloads', {
                headers: {
                    'Authorization': `Bearer ${this.sessionToken}`
                }
            });

            return response.data.downloads.map(download => ({
                uuid: download.id,
                name: download.packageName || download.url,
                status: download.status,
                progress: download.progress || 0,
                speed: download.speed || 0,
                bytesLoaded: download.bytesLoaded || 0,
                bytesTotal: download.bytesTotal || 0
            }));
        } catch (error) {
            console.error('Error getting downloads from JDownloader:', error);
            return [];
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

const jdService = new JDownloaderService();
export default jdService;
