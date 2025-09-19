import React, { useState, useEffect } from 'react';
import { useSocket } from '../socket';
import { ProxiedImage } from '../utils/imageProxy.jsx';
import { useTheme } from '../contexts/ThemeContext';

const Updates = () => {
    const [updates, setUpdates] = useState([]);
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastCheck, setLastCheck] = useState(null);
    const socket = useSocket();
    const { isDarkMode } = useTheme();

    useEffect(() => {
        loadUpdates();
        loadNotifications();

        // Listen for real-time updates
        if (socket) {
            socket.on('gameUpdate', handleGameUpdate);
            socket.on('gameUpdateNotification', handleUpdateNotification);
            return () => {
                socket.off('gameUpdate', handleGameUpdate);
                socket.off('gameUpdateNotification', handleUpdateNotification);
            };
        }
    }, [socket]);

    const loadUpdates = async () => {
        try {
            console.log('Fetching updates...');
            const response = await fetch('/api/games/updates', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            console.log('Response status:', response.status);
            const data = await response.json();
            console.log('Response data:', data);
            
            if (data.updates) {
                setUpdates(data.updates);
                setLastCheck(data.lastCheck);
            } else {
                setUpdates([]);
            }
        } catch (err) {
            console.error('Error fetching updates:', err);
            setError('Failed to fetch updates: ' + err.message);
            setUpdates([]);
        } finally {
            setLoading(false);
        }
    };

    const loadNotifications = async () => {
        // Load recent update notifications from localStorage or API
        const saved = localStorage.getItem('gameNotifications');
        if (saved) {
            setNotifications(JSON.parse(saved));
        }
    };

    const handleGameUpdate = (updateData) => {
        console.log('Received game update:', updateData);
        // Add new notification
        const newNotification = {
            id: Date.now(),
            gameId: updateData.gameId,
            title: updateData.title,
            version: updateData.version,
            timestamp: updateData.timestamp,
            message: `New version ${updateData.version} available for ${updateData.title}`
        };
        
        setNotifications(prev => {
            const updated = [newNotification, ...prev.slice(0, 9)]; // Keep only 10 most recent
            localStorage.setItem('gameNotifications', JSON.stringify(updated));
            return updated;
        });
        
        // Refresh updates list
        loadUpdates();
    };

    const handleUpdateNotification = (notificationData) => {
        console.log('Received update notification:', notificationData);
        const newNotification = {
            id: Date.now(),
            title: notificationData.title,
            version: notificationData.version,
            timestamp: notificationData.timestamp,
            message: `${notificationData.title} has been updated to version ${notificationData.version}`
        };
        
        setNotifications(prev => {
            const updated = [newNotification, ...prev.slice(0, 9)];
            localStorage.setItem('gameNotifications', JSON.stringify(updated));
            return updated;
        });
    };

    const handleCheckForUpdates = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/games/check-updates', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            console.log('Update check results:', data);
            
            if (data.results) {
                const updatesFound = data.updatesFound;
                if (updatesFound > 0) {
                    setNotifications(prev => [{
                        id: Date.now(),
                        message: `Found ${updatesFound} updates for tracked games`,
                        timestamp: new Date(),
                        type: 'check-result'
                    }, ...prev.slice(0, 9)]);
                }
                // Refresh the updates list
                loadUpdates();
            }
        } catch (err) {
            setError('Failed to check for updates: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const clearNotifications = () => {
        setNotifications([]);
        localStorage.removeItem('gameNotifications');
    };

    const formatTimeAgo = (date) => {
        if (!date) return '';
        const now = new Date();
        const diff = now - new Date(date);
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'Just now';
    };

    if (loading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading updates...</div>;
    if (error) return <div className="p-4 text-red-500 dark:text-red-400">{error}</div>;

    return (
        <div className="container mx-auto p-4">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Game Updates</h1>
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleCheckForUpdates}
                        disabled={loading}
                        className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-4 py-2 rounded-md transition-colors"
                    >
                        {loading ? 'Checking...' : 'Check for Updates'}
                    </button>
                    {lastCheck && (
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                            Last check: {formatTimeAgo(lastCheck)}
                        </div>
                    )}
                </div>
            </div>
            
            {/* Notifications Section */}
            <div className="mb-8">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Recent Notifications</h2>
                    {notifications.length > 0 && (
                        <button
                            onClick={clearNotifications}
                            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                            Clear All
                        </button>
                    )}
                </div>
                <div className="space-y-3">
                    {notifications.map((notification) => (
                        <div key={notification.id} className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-4 rounded-r-md">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="font-medium text-gray-900 dark:text-gray-100">
                                        {notification.title || 'Update Notification'}
                                    </h3>
                                    <p className="text-gray-600 dark:text-gray-300 mt-1">{notification.message}</p>
                                </div>
                                <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap ml-4">
                                    {formatTimeAgo(notification.timestamp)}
                                </span>
                            </div>
                        </div>
                    ))}
                    {notifications.length === 0 && (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <p>No recent notifications</p>
                            <p className="text-sm mt-1">Updates will appear here when available</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Updates Section */}
            <div>
                <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
                    Available Updates ({updates.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {updates.map(update => (
                        <div key={update.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between mb-3">
                                <h3 className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">
                                    {update.title}
                                </h3>
                                <span className="ml-2 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-xs px-2 py-1 rounded-full whitespace-nowrap">
                                    Update Available
                                </span>
                            </div>
                            
                            <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                                <div className="flex justify-between">
                                    <span>Current Version:</span>
                                    <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">
                                        {update.lastKnownVersion || 'Unknown'}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>New Version:</span>
                                    <span className="font-mono bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-2 py-1 rounded text-xs">
                                        {update.currentVersion}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Status:</span>
                                    <span className={`px-2 py-1 rounded text-xs ${
                                        update.status === 'update-available' 
                                            ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                                    }`}>
                                        {update.status.replace('-', ' ').toUpperCase()}
                                    </span>
                                </div>
                                {update.lastChecked && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                        Last checked: {formatTimeAgo(update.lastChecked)}
                                    </div>
                                )}
                            </div>

                            {update.updateHistory && update.updateHistory.length > 0 && (
                                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-600">
                                    <div className="text-sm text-gray-600 dark:text-gray-300">
                                        <div className="font-medium mb-1">Recent Changes:</div>
                                        <div className="text-xs bg-gray-50 dark:bg-gray-700/50 p-2 rounded">
                                            {update.updateHistory[0].changes || 'No changelog available'}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {update.metadata && (
                                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                                    <div className="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                                        <span>Source: {update.metadata.source || 'Unknown'}</span>
                                        {update.updateCount > 0 && (
                                            <span>{update.updateCount} updates tracked</span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {updates.length === 0 && (
                        <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                            <div className="text-6xl mb-4">🎮</div>
                            <p className="text-lg font-medium">No updates available</p>
                            <p className="text-sm mt-1">All your tracked games are up to date!</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Updates;
