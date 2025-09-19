import React, { useState, useEffect } from 'react';
import { fetchGames, checkSupportedDownloaders, addDownload } from '../api';

const Dashboard = () => {
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedGame, setSelectedGame] = useState(null);
    const [supportedDownloaders, setSupportedDownloaders] = useState([]);

    useEffect(() => {
        loadGames();
    }, []);

    const loadGames = async () => {
        try {
            const data = await fetchGames();
            setGames(data);
        } catch (err) {
            setError('Failed to load games');
        } finally {
            setLoading(false);
        }
    };

    const handleGameSelect = async (game) => {
        setSelectedGame(game);
        try {
            const supported = await checkSupportedDownloaders(game.id);
            setSupportedDownloaders(supported);
        } catch (err) {
            setError('Failed to check supported downloaders');
        }
    };

    const handleDownload = async (game, downloadLink, downloader) => {
        try {
            await addDownload(game.id, {
                url: downloadLink.url,
                service: downloadLink.service,
                downloader: downloader
            });
            // Show success message or update UI
            alert('Download added successfully!');
        } catch (err) {
            setError('Failed to add download');
        }
    };

    if (loading) return <div className="p-4">Loading...</div>;
    if (error) return <div className="p-4 text-red-500">{error}</div>;

    return (
        <div className="container mx-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Game Updates</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {games.map((game) => (
                    <div key={game.id} className="border rounded-lg p-4 shadow-sm">
                        <img 
                            src={game.image} 
                            alt={game.title} 
                            className="w-full h-48 object-cover rounded-lg mb-4"
                        />
                        <h2 className="text-xl font-semibold mb-2">{game.title}</h2>
                        <p className="text-gray-600 mb-4" 
                           dangerouslySetInnerHTML={{ __html: game.excerpt }} 
                        />
                        <div className="space-y-2">
                            <button
                                onClick={() => handleGameSelect(game)}
                                className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
                            >
                                View Download Options
                            </button>
                            
                            {selectedGame?.id === game.id && supportedDownloaders.length > 0 && (
                                <div className="mt-4 border-t pt-4">
                                    <h3 className="font-semibold mb-2">Available Downloads:</h3>
                                    {game.downloadLinks.map((link) => (
                                        <div key={link.url} className="mb-2 p-2 border rounded">
                                            <p className="font-medium">{link.service}</p>
                                            {supportedDownloaders.map((downloader) => (
                                                <button
                                                    key={downloader}
                                                    onClick={() => handleDownload(game, link, downloader)}
                                                    className="mt-1 mr-2 bg-green-500 text-white py-1 px-2 rounded text-sm hover:bg-green-600"
                                                >
                                                    Download with {downloader}
                                                </button>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Dashboard;
