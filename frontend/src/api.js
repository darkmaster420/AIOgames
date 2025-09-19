const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Helper function to handle authentication
const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
};

// Fetch games from the API
export const fetchGames = async () => {
    try {
        const response = await fetch(`${BASE_URL}/api/games`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to fetch games');
        }

        return await response.json();
    } catch (error) {
        console.error('Error fetching games:', error);
        throw error;
    }
};

// Add download to a specific service
export const addDownload = async (gameId, downloadInfo) => {
    try {
        const response = await fetch(`${BASE_URL}/api/downloads/add`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                gameId,
                ...downloadInfo
            })
        });

        if (!response.ok) {
            throw new Error('Failed to add download');
        }

        return await response.json();
    } catch (error) {
        console.error('Error adding download:', error);
        throw error;
    }
};

// Get download status
export const getDownloadStatus = async (downloadId) => {
    try {
        const response = await fetch(`${BASE_URL}/api/downloads/${downloadId}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to get download status');
        }

        return await response.json();
    } catch (error) {
        console.error('Error getting download status:', error);
        throw error;
    }
};

// Check supported downloaders for a specific game
export const checkSupportedDownloaders = async (gameId) => {
    try {
        const response = await fetch(`${BASE_URL}/api/downloads/supported/${gameId}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to check supported downloaders');
        }

        return await response.json();
    } catch (error) {
        console.error('Error checking supported downloaders:', error);
        throw error;
    }
};
