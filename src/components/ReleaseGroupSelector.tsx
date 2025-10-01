'use client';

import { useState, useEffect } from 'react';
import { useNotification } from '../contexts/NotificationContext';

interface ReleaseGroup {
  releaseGroup: string;
  title: string;
  version: string;
  buildNumber: string;
  detectedAt: string;
  _id: string;
}

interface ReleaseGroupSelectorProps {
  gameId: string;
  gameTitle?: string;
  onReleaseGroupChange?: (releaseGroup: ReleaseGroup | null) => void;
}

export function ReleaseGroupSelector({ 
  gameId, 
  gameTitle: _, // eslint-disable-line @typescript-eslint/no-unused-vars
  onReleaseGroupChange 
}: ReleaseGroupSelectorProps) {
  const [releaseGroups, setReleaseGroups] = useState<ReleaseGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { showError } = useNotification();

  // Load available release groups for this game
  useEffect(() => {
    loadReleaseGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const loadReleaseGroups = async () => {
    if (!gameId) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`/api/tracking/${gameId}/release-groups`);
      if (response.ok) {
        const data = await response.json();
        setReleaseGroups(data.releaseGroups || []);
        
        // Auto-select the first/most recent release group if available
        if (data.releaseGroups && data.releaseGroups.length > 0) {
          const firstGroup = data.releaseGroups[0];
          setSelectedGroup(firstGroup.releaseGroup);
          onReleaseGroupChange?.(firstGroup);
        }
      } else {
        console.error('Failed to load release groups');
      }
    } catch (error) {
      console.error('Error loading release groups:', error);
      showError('Failed to load release groups');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGroupChange = (releaseGroup: string) => {
    setSelectedGroup(releaseGroup);
    const group = releaseGroups.find(g => g.releaseGroup === releaseGroup);
    onReleaseGroupChange?.(group || null);
  };

  // Don't render if no release groups available
  if (releaseGroups.length === 0) {
    return null;
  }

  // If only one release group, show it as info instead of dropdown
  if (releaseGroups.length === 1) {
    const group = releaseGroups[0];
    return (
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Release Group:</span>
          <span className="text-sm text-blue-700 dark:text-blue-300 font-mono bg-blue-100 dark:bg-blue-900/40 px-2 py-1 rounded">
            {group.releaseGroup}
          </span>
        </div>
        {(group.version || group.buildNumber) && (
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            {group.version && `v${group.version}`}
            {group.version && group.buildNumber && ' • '}
            {group.buildNumber && `Build ${group.buildNumber}`}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        disabled={isLoading}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 dark:text-gray-300">Release Groups</span>
          <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full">
            {releaseGroups.length}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m19 9-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="mt-2 space-y-2 border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-white dark:bg-gray-800">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Select a release group variant for version tracking:
          </div>
          
          {releaseGroups.map((group) => (
            <div key={group._id} className="flex items-center gap-3">
              <input
                type="radio"
                id={group._id}
                name="releaseGroup"
                value={group.releaseGroup}
                checked={selectedGroup === group.releaseGroup}
                onChange={(e) => handleGroupChange(e.target.value)}
                className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600"
              />
              <label htmlFor={group._id} className="flex-1 cursor-pointer">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
                    {group.releaseGroup}
                  </span>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {group.version && `v${group.version}`}
                    {group.version && group.buildNumber && ' • '}
                    {group.buildNumber && `Build ${group.buildNumber}`}
                  </div>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1">
                  {group.title}
                </div>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}