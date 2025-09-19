import axios from 'axios';
import FormData from 'form-data';

class QBittorrentService {
    constructor(config = {}) {
        this.config = {
            url: config.url || 'http://localhost:8080',
            username: config.username || 'admin',
            password: config.password || 'adminadmin'
        };
        
        this.axios = axios.create({
            baseURL: this.config.url,
            timeout: 10000
        });
    }

    async connect() {
        try {
            const formData = new FormData();
            formData.append('username', this.config.username);
            formData.append('password', this.config.password);

            const response = await this.axios.post('/api/v2/auth/login', formData, {
                headers: formData.getHeaders()
            });

            if (response.data === 'Ok.') {
                console.log('Connected to qBittorrent service');
                return true;
            }
            throw new Error('Failed to connect to qBittorrent');
        } catch (error) {
            console.error('Error connecting to qBittorrent:', error);
            throw error;
        }
    }

    async addDownload(url, options = {}) {
        try {
            const formData = new FormData();
            formData.append('urls', url);
            
            if (options.savepath) {
                formData.append('savepath', options.savepath);
            }
            
            if (options.category) {
                formData.append('category', options.category);
            }

            const response = await this.axios.post('/api/v2/torrents/add', formData, {
                headers: formData.getHeaders()
            });

            if (response.data === 'Ok.') {
                // Get the torrent hash
                const torrents = await this.getTorrents();
                const torrent = torrents.find(t => t.name === options.name);
                
                return {
                    id: torrent ? torrent.hash : null,
                    status: 'added'
                };
            }
            throw new Error('Failed to add torrent');
        } catch (error) {
            console.error('Error adding download to qBittorrent:', error);
            throw error;
        }
    }

    async getStatus(hash) {
        try {
            const response = await this.axios.get('/api/v2/torrents/info', {
                params: { hashes: hash }
            });

            if (response.data && response.data.length > 0) {
                const torrent = response.data[0];
                return {
                    id: hash,
                    status: torrent.state,
                    progress: torrent.progress * 100,
                    downloaded: torrent.downloaded,
                    total: torrent.size,
                    downloadSpeed: torrent.dlspeed,
                    eta: torrent.eta
                };
            }
            throw new Error('Torrent not found');
        } catch (error) {
            console.error('Error getting torrent status from qBittorrent:', error);
            throw error;
        }
    }

    async getTorrents() {
        try {
            const response = await this.axios.get('/api/v2/torrents/info');
            return response.data;
        } catch (error) {
            console.error('Error getting torrents from qBittorrent:', error);
            throw error;
        }
    }

    supportsUrl(url) {
        // Check if URL is a magnet link or a torrent file
        return url.startsWith('magnet:') || url.endsWith('.torrent');
    }
}

module.exports = QBittorrentService;