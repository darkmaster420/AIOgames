'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { ThemeToggle } from './ThemeToggle';

export function Navigation() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user && typeof session.user === 'object' && 'role' in session.user)
    ? (session.user as { role?: string }).role === 'admin'
    : false;

  const handleLogout = () => {
    // Clear custom cookies before signing out
    document.cookie = 'showRecentGames=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    signOut({ callbackUrl: '/' });
  };

  const navItems = [
    { href: '/', label: '🏠 Home', description: 'Main Dashboard' },
    { href: '/tracking', label: '📊 Tracking', description: 'Your Games' },
    ...(session ? [{ href: '/updates', label: '🔄 Updates', description: 'Game Updates' }] : []),
    ...(isAdmin ? [{ href: '/admin', label: '⚙️ Admin', description: 'Admin Panel' }] : []),
    ...(session ? [{ href: '/user/manage', label: '👤 Account', description: 'Manage your account' }] : []),
  ];

  return (
    <nav className="nav-glass shadow-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
            <div className="flex-shrink-0">
              <h1 className="text-xl font-bold text-gradient">
                🎮 AIO Games
              </h1>
            </div>
            
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 backdrop-blur-sm ${
                      pathname === item.href
                        ? 'bg-gradient-to-r from-primary-500/20 to-accent-500/20 text-primary-700 dark:text-primary-300 border border-primary-300/30 shadow-lg'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-white/20 dark:hover:bg-white/10 hover:text-primary-600 dark:hover:text-primary-400 hover:scale-105'
                    }`}
                    title={item.description}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <ThemeToggle />
            {session && (
              <>
                <Link
                  href="/user/manage"
                  className="text-sm text-slate-700 dark:text-slate-300 bg-white/20 dark:bg-white/10 px-3 py-1 rounded-lg backdrop-blur-sm border border-white/30 dark:border-white/20 hover:bg-white/30 dark:hover:bg-white/20 transition flex items-center gap-2"
                  title="Manage Account"
                >
                  👋 {('username' in session.user ? (session.user as { username?: string }).username : undefined) || session.user?.name}
                  {isAdmin && <span className="ml-1 status-badge status-admin">ADMIN</span>}
                </Link>
                <button
                  onClick={handleLogout}
                  className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-red-500/20 to-pink-500/20 text-red-600 dark:text-red-400 hover:from-red-500/30 hover:to-pink-500/30 hover:text-red-700 dark:hover:text-red-300 rounded-lg transition-all duration-200 backdrop-blur-sm border border-red-300/30 hover:scale-105"
                  title="Sign out"
                >
                  🚪 Logout
                </button>
              </>
            )}
            {!session && (
              <Link
                href="/auth/signin"
                className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-primary-500/20 to-accent-500/20 text-primary-600 dark:text-primary-400 hover:from-primary-500/30 hover:to-accent-500/30 hover:text-primary-700 dark:hover:text-primary-300 rounded-lg transition-all duration-200 backdrop-blur-sm border border-primary-300/30 hover:scale-105"
              >
                🔑 Sign In
              </Link>
            )}
          </div>
        </div>

        {/* Mobile menu */}
        <div className="md:hidden pb-3 pt-2">
          <div className="flex flex-wrap gap-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 backdrop-blur-sm ${
                  pathname === item.href
                    ? 'bg-gradient-to-r from-primary-500/20 to-accent-500/20 text-primary-700 dark:text-primary-300 border border-primary-300/30'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-white/20 dark:hover:bg-white/10 hover:text-primary-600 dark:hover:text-primary-400'
                }`}
              >
                {item.label}
              </Link>
            ))}
            {!session && (
              <Link
                href="/auth/signin"
                className="px-3 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-primary-500/20 to-accent-500/20 text-primary-600 dark:text-primary-400 hover:from-primary-500/30 hover:to-accent-500/30 transition-all duration-200 backdrop-blur-sm border border-primary-300/30"
              >
                🔑 Sign In
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}