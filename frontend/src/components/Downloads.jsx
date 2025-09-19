import React, { useState, useEffect } from 'react';
import { getDownloadStatus } from '../api';

const Downloads = () => {
    const [downloads, setDownloads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        loadDownloads();
        const interval = setInterval(updateDownloadStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    const loadDownloads = async () => {
        try {
            // You'll need to implement this endpoint in your API
            const response = await fetch('/api/downloads', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            if (!response.ok) {
                throw new Error('Failed to load downloads');
            }
            const data = await response.json();
            setDownloads(Array.isArray(data) ? data : []);
        } catch (err) {
            setError('Failed to load downloads');
        } finally {
            setLoading(false);
        }
    };

    const updateDownloadStatus = async () => {
        try {
            const updatedDownloads = await Promise.all(
                downloads.map(async (download) => {
                    const status = await getDownloadStatus(download.id);
                    return { ...download, ...status };
                })
            );
            setDownloads(updatedDownloads);
        } catch (err) {
            console.error('Error updating download status:', err);
        }
    };

    if (loading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading...</div>;
    if (error) return <div className="p-4 text-red-500">{error}</div>;

    return (
        <div className="container mx-auto p-2 sm:p-4">
            <h1 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4 text-gray-900 dark:text-gray-100">Downloads</h1>
            <div className="space-y-3 sm:space-y-4">
                {downloads.map((download) => (
                    <div key={download.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 shadow-sm bg-white dark:bg-gray-800">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 sm:gap-4 mb-2">
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{download.title}</h3>
                                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                                    Downloading with {download.downloader}
                                </p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs sm:text-sm whitespace-nowrap ${
                                download.status === 'completed' ? 'bg-green-100 text-green-800' :
                                download.status === 'error' ? 'bg-red-100 text-red-800' :
                                'bg-blue-100 text-blue-800'
                            }`}>
                                {download.status}
                            </span>
                        </div>
                        
                        {download.progress !== undefined && (
                            <div className="mt-2">
                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                    <div 
                                        className="bg-blue-600 h-2.5 rounded-full"
                                        style={{ width: `${download.progress}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300 mt-1">
                                    <span>{download.progress.toFixed(1)}%</span>
                                    {download.downloadSpeed && (
                                        <span>{formatSpeed(download.downloadSpeed)}</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {downloads.length === 0 && (
                    <div className="text-center text-gray-500 py-8">
                        No active downloads
                    </div>
                )}
            </div>
        </div>
    );
};

const formatSpeed = (bytesPerSecond) => {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let speed = bytesPerSecond;
    let unitIndex = 0;
    
    while (speed >= 1024 && unitIndex < units.length - 1) {
        speed /= 1024;
        unitIndex++;
    }
    
    return `${speed.toFixed(1)} ${units[unitIndex]}`;
};

export default Downloads;