'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';

const navItems = [
  { href: '/', label: 'Home', description: 'Game discovery' },
  { href: '/tracking', label: 'Library', description: 'NAS game library' },
  { href: '/updates', label: 'Updates', description: 'Game updates' },
  { href: '/user/manage', label: 'Settings', description: 'Library preferences and notifications' },
  { href: '/admin', label: 'Maintenance', description: 'Application maintenance' },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="nav-glass shadow-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
            <h1 className="text-xl font-bold text-gradient">AIO Games</h1>
            <div className="hidden md:block">
              <div className="flex items-baseline space-x-4">
                {navItems.map(item => (
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
          <ThemeToggle />
        </div>

        <div className="md:hidden pb-3 pt-2">
          <div className="flex flex-wrap gap-2">
            {navItems.map(item => (
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
          </div>
        </div>
      </div>
    </nav>
  );
}
