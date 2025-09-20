'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Navigation } from '../../components/Navigation';

interface AdminStats {
  totalUsers: number;
  totalTrackedGames: number;
  activeUsers: number;
  totalUpdates: number;
  pendingUpdates: number;
  newUsersThisWeek: number;
}

interface RecentUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface TopGame {
  title: string;
  trackingCount: number;
  source: string;
  image?: string;
}

interface User {
  _id: string;
  name: string;
  email: string;
  createdAt: string;
  trackedGamesCount: number;
  lastActivity?: string;
}

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [topGames, setTopGames] = useState<TopGame[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'games'>('overview');

  useEffect(() => {
    if (status === 'authenticated') {
      loadAdminData();
      if (activeTab === 'users') {
        loadUsers();
      }
    }
  }, [status, activeTab]);

  const loadAdminData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/stats');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      setStats(data.stats);
      setRecentUsers(data.recentUsers);
      setTopGames(data.topTrackedGames);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error('Failed to load users');
      
      const data = await response.json();
      setUsers(data.users);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to delete user "${userName}" and all their tracked games?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/users?userId=${userId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete user');

      // Reload users and stats
      loadUsers();
      loadAdminData();
    } catch (err) {
      alert('Failed to delete user: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  if (status === 'loading') {
    return <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    </div>;
  }

  if (status !== 'authenticated') {
    return <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Admin Access Required</h1>
        <Link href="/auth/signin" className="text-blue-600 dark:text-blue-400 hover:underline">
          Please sign in to access the admin dashboard
        </Link>
      </div>
    </div>;
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-2 sm:p-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center sm:text-left mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">System management and user oversight</p>
          </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap justify-center sm:justify-start border-b border-gray-200 dark:border-gray-700 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview' 
                ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            📊 Overview
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'users' 
                ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            👥 Users
          </button>
          <button
            onClick={() => setActiveTab('games')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'games' 
                ? 'border-blue-500 text-blue-600 dark:text-blue-400' 
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            🎮 Games
          </button>
        </div>

        {/* Content */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded">
            {error}
          </div>
        )}

        {loading && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading admin data...</p>
          </div>
        )}

        {!loading && (
          <>
            {/* Overview Tab */}
            {activeTab === 'overview' && stats && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.totalUsers}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Total Users</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.activeUsers}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Active Users</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.totalTrackedGames}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Tracked Games</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{stats.totalUpdates}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Total Updates</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.pendingUpdates}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Pending Updates</div>
                  </div>
                  <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                    <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.newUsersThisWeek}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">New This Week</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Recent Users */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Users</h3>
                    <div className="space-y-3">
                      {recentUsers.map((user) => (
                        <div key={user.id} className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">{user.name}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{user.email}</div>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(user.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top Tracked Games */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Most Tracked Games</h3>
                    <div className="space-y-3">
                      {topGames.map((game, index) => (
                        <div key={game.title} className="flex items-center gap-3 py-2">
                          <div className="w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded flex items-center justify-center text-sm font-bold">
                            {index + 1}
                          </div>
                          {game.image && (
                            <Image 
                              src={game.image} 
                              alt={game.title}
                              width={32}
                              height={32}
                              className="w-8 h-8 object-cover rounded"
                              unoptimized
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white truncate">{game.title}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">{game.source}</div>
                          </div>
                          <div className="text-sm font-medium text-blue-600 dark:text-blue-400">
                            {game.trackingCount} users
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">User Management</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Tracked Games</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Joined</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {users.map((user) => (
                        <tr key={user._id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900 dark:text-white">{user.name}</div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">{user.email}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {user.trackedGamesCount}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {new Date(user.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <button
                              onClick={() => handleDeleteUser(user._id, user.name)}
                              className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Games Tab */}
            {activeTab === 'games' && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Game Statistics</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {topGames.map((game) => (
                    <div key={game.title} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-2">
                        {game.image && (
                          <Image 
                            src={game.image} 
                            alt={game.title}
                            width={48}
                            height={48}
                            className="w-12 h-12 object-cover rounded"
                            unoptimized
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-gray-900 dark:text-white truncate">{game.title}</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{game.source}</p>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{game.trackingCount}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">users tracking</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </>
  );
}