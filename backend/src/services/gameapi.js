import axios from 'axios';

const GAME_API_URL = 'https://gameapi.a7a8524.workers.dev';

export const getGames = async () => {
  try {
    const response = await axios.get(`${GAME_API_URL}/games`);
    return response.data;
  } catch (error) {
    console.error('Error fetching games:', error);
    throw error;
  }
};

export const searchGames = async (query, site = 'all') => {
  try {
    const response = await axios.get(`${GAME_API_URL}/games/search`, {
      params: { query, site }
    });
    return response.data;
  } catch (error) {
    console.error('Error searching games:', error);
    throw error;
  }
};

export const getGameDownloads = async (gameId) => {
  try {
    const response = await axios.get(`${GAME_API_URL}/games/${gameId}/downloads`);
    return response.data;
  } catch (error) {
    console.error('Error fetching game downloads:', error);
    throw error;
  }
};

export const getGameUpdates = async () => {
  try {
    const response = await axios.get(`${GAME_API_URL}/games/updates`);
    return response.data;
  } catch (error) {
    console.error('Error fetching game updates:', error);
    throw error;
  }
};