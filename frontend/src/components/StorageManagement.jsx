import React, { useState, useEffect } from 'react';
import { Folder, HardDrive, Settings, Plus, Check, X, AlertCircle } from 'lucide-react';

const StorageManagement = () => {
    const [config, setConfig] = useState(null);
    const [status, setStatus] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [editMode, setEditMode] = useState(false);
    const [editedConfig, setEditedConfig] = useState(null);

    useEffect(() => {
        loadStorageConfig();
    }, []);

    const loadStorageConfig = async () => {
        try {
            const response = await fetch('/api/storage', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to load storage configuration');
            }
            
            const data = await response.json();
            setConfig(data.config);
            setStatus(data.status);
            setEditedConfig(data.config);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const saveStorageConfig = async () => {
        setSaving(true);
        try {
            const response = await fetch('/api/storage', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(editedConfig)
            });
            
            if (!response.ok) {
                throw new Error('Failed to save storage configuration');
            }
            
            setConfig(editedConfig);
            setEditMode(false);
            await loadStorageConfig(); // Reload to get updated status
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const createDirectory = async (path) => {
        try {
            const response = await fetch('/api/storage/mkdir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ path })
            });
            
            if (!response.ok) {
                throw new Error('Failed to create directory');
            }
            
            await loadStorageConfig();
        } catch (err) {
            setError(err.message);
        }
    };

    const updateServicePath = (service, newPath) => {
        setEditedConfig(prev => ({
            ...prev,
            downloadPaths: {
                ...prev.downloadPaths,
                [service]: newPath
            }
        }));
    };

    const updateCategoryPath = (category, newPath) => {
        setEditedConfig(prev => ({
            ...prev,
            categories: {
                ...prev.categories,
                [category]: newPath
            }
        }));
    };

    if (loading) return (
        <div className="p-6 text-center text-gray-900 dark:text-gray-100">
            <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            <p className="mt-2">Loading storage configuration...</p>
        </div>
    );

    if (error) return (
        <div className="p-6">
            <div className="bg-red-100 dark:bg-red-900/20 border border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded">
                <div className="flex items-center">
                    <AlertCircle className="w-5 h-5 mr-2" />
                    Error: {error}
                </div>
            </div>
        </div>
    );

    return (
        <div className="container mx-auto p-6">
            <div className="mb-6">
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        <HardDrive className="w-6 h-6" />
                        Storage Management
                    </h1>
                    <div className="flex gap-2">
                        {!editMode ? (
                            <button
                                onClick={() => setEditMode(true)}
                                className="bg-blue-500 dark:bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 transition-colors flex items-center gap-2"
                            >
                                <Settings className="w-4 h-4" />
                                Configure
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    onClick={saveStorageConfig}
                                    disabled={saving}
                                    className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    <Check className="w-4 h-4" />
                                    {saving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                    onClick={() => {
                                        setEditMode(false);
                                        setEditedConfig(config);
                                    }}
                                    className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
                                >
                                    <X className="w-4 h-4" />
                                    Cancel
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Download Services */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700 p-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                        <Folder className="w-5 h-5" />
                        Download Services
                    </h2>
                    <div className="space-y-4">
                        {Object.entries(config?.downloadPaths || {}).map(([service, path]) => (
                            <div key={service} className="border dark:border-gray-600 rounded-lg p-4">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="font-medium text-gray-700 dark:text-gray-300 capitalize">
                                        {service}
                                    </label>
                                    <div className="flex items-center gap-2">
                                        {status[service]?.exists ? (
                                            <Check className="w-4 h-4 text-green-500" />
                                        ) : (
                                            <button
                                                onClick={() => createDirectory(path)}
                                                className="text-blue-500 hover:text-blue-600 flex items-center gap-1 text-sm"
                                            >
                                                <Plus className="w-3 h-3" />
                                                Create
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {editMode ? (
                                    <input
                                        type="text"
                                        value={editedConfig.downloadPaths[service]}
                                        onChange={(e) => updateServicePath(service, e.target.value)}
                                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100"
                                    />
                                ) : (
                                    <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                        {path}
                                    </div>
                                )}
                                {status[service] && !status[service].exists && (
                                    <div className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                                        Directory does not exist
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Categories */}
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700 p-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                        <Folder className="w-5 h-5" />
                        Categories
                    </h2>
                    <div className="space-y-4">
                        {Object.entries(config?.categories || {}).map(([category, path]) => (
                            <div key={category} className="border dark:border-gray-600 rounded-lg p-4">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="font-medium text-gray-700 dark:text-gray-300 capitalize">
                                        {category}
                                    </label>
                                    <button
                                        onClick={() => createDirectory(path)}
                                        className="text-blue-500 hover:text-blue-600 flex items-center gap-1 text-sm"
                                    >
                                        <Plus className="w-3 h-3" />
                                        Create
                                    </button>
                                </div>
                                {editMode ? (
                                    <input
                                        type="text"
                                        value={editedConfig.categories[category]}
                                        onChange={(e) => updateCategoryPath(category, e.target.value)}
                                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100"
                                    />
                                ) : (
                                    <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                        {path}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Common Paths */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700 p-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Common Paths
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border dark:border-gray-600 rounded-lg p-4">
                        <label className="font-medium text-gray-700 dark:text-gray-300">Temporary Downloads</label>
                        {editMode ? (
                            <input
                                type="text"
                                value={editedConfig?.tempPath || ''}
                                onChange={(e) => setEditedConfig(prev => ({ ...prev, tempPath: e.target.value }))}
                                className="w-full mt-2 p-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100"
                            />
                        ) : (
                            <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded mt-2">
                                {config?.tempPath}
                            </div>
                        )}
                    </div>
                    <div className="border dark:border-gray-600 rounded-lg p-4">
                        <label className="font-medium text-gray-700 dark:text-gray-300">Completed Downloads</label>
                        {editMode ? (
                            <input
                                type="text"
                                value={editedConfig?.completedPath || ''}
                                onChange={(e) => setEditedConfig(prev => ({ ...prev, completedPath: e.target.value }))}
                                className="w-full mt-2 p-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-gray-100"
                            />
                        ) : (
                            <div className="text-sm text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900 p-2 rounded mt-2">
                                {config?.completedPath}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StorageManagement;