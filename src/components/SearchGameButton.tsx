'use client';

import { useRouter } from 'next/navigation';
import { buildSearchUrl } from '../utils/searchUtils';

interface SearchGameButtonProps {
  gameTitle: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function SearchGameButton({ gameTitle, className = '', size = 'md' }: SearchGameButtonProps) {
  const router = useRouter();

  const handleSearch = () => {
    const searchUrl = buildSearchUrl('/', {
      search: gameTitle
    });
    router.push(searchUrl);
  };

  const sizeClasses = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-12 w-12 text-base'
  };

  return (
    <button
      onClick={handleSearch}
      title={`Search for "${gameTitle}"`}
      className={`
        ${sizeClasses[size]}
        flex items-center justify-center rounded-lg 
        bg-white/90 dark:bg-gray-900/80 
        border border-purple-300 dark:border-purple-600 
        hover:bg-purple-100 dark:hover:bg-purple-800/40 
        text-purple-600 dark:text-purple-300 
        transition-all duration-200 shadow-sm hover:shadow-md
        ${className}
      `}
    >
      <span role="img" aria-label="search">🔍</span>
    </button>
  );
}