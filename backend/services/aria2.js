const Aria2 = require('aria2');
const { promisify } = require('util');

class Aria2Service {
    constructor(config = {}) {
        this.client = new Aria2({
            host: config.host || 'localhost',
            port: config.port || 6800,
            secure: config.secure || false,
            secret: config.secret || '',
            path: config.path || '/jsonrpc'
        });

        // Promisify methods
        this.addUri = promisify(this.client.addUri.bind(this.client));
        this.tellStatus = promisify(this.client.tellStatus.bind(this.client));
    }

    async connect() {
        try {
            await this.client.open();
            console.log('Connected to aria2 service');
        } catch (error) {
            console.error('Failed to connect to aria2:', error);
            throw error;
        }
    }

    async disconnect() {
        try {
            await this.client.close();
            console.log('Disconnected from aria2 service');
        } catch (error) {
            console.error('Error disconnecting from aria2:', error);
        }
    }

    async addDownload(url, options = {}) {
        try {
            // Add URL to aria2
            const gid = await this.addUri([url], {
                dir: options.directory || '/downloads',
                out: options.filename,
                ...options
            });

            return {
                id: gid,
                status: 'added'
            };
        } catch (error) {
            console.error('Error adding download to aria2:', error);
            throw error;
        }
    }

    async getStatus(gid) {
        try {
            const status = await this.tellStatus(gid);
            return {
                id: gid,
                status: status.status,
                totalLength: status.totalLength,
                completedLength: status.completedLength,
                downloadSpeed: status.downloadSpeed,
                files: status.files
            };
        } catch (error) {
            console.error('Error getting download status from aria2:', error);
            throw error;
        }
    }

    supportsUrl(url) {
        // Check if URL is supported by aria2
        const supportedProtocols = ['http:', 'https:', 'ftp:', 'magnet:'];
        try {
            const protocol = new URL(url).protocol;
            return supportedProtocols.includes(protocol);
        } catch (error) {
            return false;
        }
    }
}

module.exports = Aria2Service;