import React, { useState, useEffect } from 'react';
import { useSocket } from '../socket';

const Updates = () => {
    const [games, setGames] = useState([]);
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [steamEnabled, setSteamEnabled] = useState(false);
    const socket = useSocket();

    useEffect(() => {
        loadGames();
        loadNotifications();
        checkSteamStatus();

        // Listen for real-time updates
        if (socket) {
            socket.on('gameUpdate', handleGameUpdate);
            return () => socket.off('gameUpdate', handleGameUpdate);
        }
    }, [socket]);

    const checkSteamStatus = async () => {
        try {
            const response = await fetch('/api/config/steam', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await response.json();
            setSteamEnabled(!!data.enabled);
        } catch (err) {
            console.error('Failed to check Steam status:', err);
            setSteamEnabled(false);
        }
    };

    const loadGames = async () => {
        try {
            const response = await fetch('/api/games/updates', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await response.json();
            if (Array.isArray(data.updates)) {
                setGames(data.updates);
            } else {
                setGames([]);
            }
        } catch (err) {
            setError('Failed to load game updates');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const loadNotifications = async () => {
        // For now, notifications are the same as updates
        try {
            const response = await fetch('/api/games/updates', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await response.json();
            if (Array.isArray(data.updates)) {
                setNotifications(data.updates);
            } else {
                setNotifications([]);
            }
        } catch (err) {
            console.error('Failed to load notifications:', err);
        }
    };

    const handleGameUpdate = (updateData) => {
        // Add new notification
        setNotifications(prev => [updateData, ...prev]);
        
        // Update game in list
        setGames(prev => prev.map(game => {
            if (game.appId === updateData.appId) {
                return {
                    ...game,
                    monitoring: {
                        ...game.monitoring,
                        updateAvailable: true
                    }
                };
            }
            return game;
        }));
    };

    const handleSearchUpdate = async (game) => {
        try {
            await fetch(`/api/games/${game.appId}/search-update`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                }
            });
            // Refresh game data
            loadGames();
        } catch (err) {
            setError('Failed to search for updates');
        }
    };

    if (loading) return <div className="p-4">Loading...</div>;
    if (error) return <div className="p-4 text-red-500">{error}</div>;

    return (
        <div className="container mx-auto p-4">
            <div className="flex justify-between items-center mb-4">
                <h1 className="text-2xl font-bold">Game Updates</h1>
                <div className="text-sm text-gray-500">
                    Steam Integration: {steamEnabled ? (
                        <span className="text-green-500">Enabled</span>
                    ) : (
                        <span className="text-gray-500">Disabled</span>
                    )}
                </div>
            </div>

            {!steamEnabled && (
                <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-8">
                    <h3 className="font-medium">Steam Integration Disabled</h3>
                    <p className="text-gray-600">
                        Steam features are currently disabled. To enable Steam integration:
                        <ol className="list-decimal ml-5 mt-2">
                            <li>Get a Steam Web API key from the Steam Developer portal</li>
                            <li>Add the API key to your environment configuration</li>
                            <li>Restart the application</li>
                        </ol>
                    </p>
                </div>
            )}
            
            {/* Notifications Section */}
            <div className="mb-8">
                <h2 className="text-xl font-semibold mb-4">Recent Updates</h2>
                <div className="space-y-4">
                    {notifications.map((notification, index) => (
                        <div key={index} className="bg-blue-50 border-l-4 border-blue-500 p-4">
                            <div className="flex justify-between">
                                <h3 className="font-medium">{notification.name}</h3>
                                <span className="text-sm text-gray-500">
                                    {new Date(notification.timestamp).toLocaleString()}
                                </span>
                            </div>
                            <p className="text-gray-600">{notification.message}</p>
                        </div>
                    ))}
                    {notifications.length === 0 && (
                        <p className="text-gray-500">No recent updates</p>
                    )}
                </div>
            </div>

            {/* Monitored Games Section */}
            <div>
                <h2 className="text-xl font-semibold mb-4">Monitored Games</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {games.map(game => (
                        <div key={game.appId} className={`border rounded-lg p-4 ${
                            game.monitoring.updateAvailable ? 'bg-green-50 border-green-500' : ''
                        }`}>
                            {game.metadata.headerImage && (
                                <img
                                    src={game.metadata.headerImage}
                                    alt={game.name}
                                    className="w-full h-32 object-cover rounded-lg mb-4"
                                />
                            )}
                            <h3 className="font-semibold mb-2">{game.name}</h3>
                            <div className="text-sm text-gray-600 mb-4">
                                <p>Current Build: {game.steamData.currentBuildId}</p>
                                <p>Last Update: {new Date(game.steamData.lastUpdate).toLocaleDateString()}</p>
                            </div>
                            {game.monitoring.updateAvailable && (
                                <button
                                    onClick={() => handleSearchUpdate(game)}
                                    className="w-full bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
                                >
                                    Search for Update
                                </button>
                            )}
                        </div>
                    ))}
                    {games.length === 0 && (
                        <p className="text-gray-500">No games being monitored</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Updates;
