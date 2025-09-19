// Use relative paths since we have Vite proxy configured
const BASE_URL = '';

// Helper function to handle authentication
const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json'
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
};

// Game API functions
export const searchGames = async (query, site = 'all') => {
    try {
        const response = await fetch(`${BASE_URL}/api/games/search?search=${encodeURIComponent(query)}&site=${site}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to search games');
        }

        return await response.json();
    } catch (error) {
        console.error('Error searching games:', error);
        throw error;
    }
};

export const getRecentGames = async () => {
    try {
        const response = await fetch(`${BASE_URL}/api/games/recent`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to get recent games');
        }

        return await response.json();
    } catch (error) {
        console.error('Error getting recent games:', error);
        throw error;
    }
};

export const processGameDownload = async (gameId, downloadInfo) => {
    try {
        const response = await fetch(`${BASE_URL}/api/games/${gameId}/download`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(downloadInfo)
        });

        if (!response.ok) {
            throw new Error('Failed to process game download');
        }

        return await response.json();
    } catch (error) {
        console.error('Error processing game download:', error);
        throw error;
    }
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

export const trackGame = async (gameId, title) => {
    try {
        const response = await fetch(`${BASE_URL}/api/games/track`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ gameId, title })
        });

        if (!response.ok) {
            throw new Error('Failed to track game');
        }

        return await response.json();
    } catch (error) {
        console.error('Error tracking game:', error);
        throw error;
    }
};

export const untrackGame = async (gameId) => {
    try {
        const response = await fetch(`${BASE_URL}/api/games/track/${gameId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to untrack game');
        }

        return await response.json();
    } catch (error) {
        console.error('Error untracking game:', error);
        throw error;
    }
};

export const getTrackedGames = async () => {
    try {
        const response = await fetch(`${BASE_URL}/api/games/tracked`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to get tracked games');
        }

        return await response.json();
    } catch (error) {
        console.error('Error getting tracked games:', error);
        throw error;
    }
};
