import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Download, RefreshCw, LogOut, LogIn, Sun, Moon, HardDrive, Menu, X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const Navbar = ({ isAuthenticated, setIsAuthenticated }) => {
  const location = useLocation();
  const { isDarkMode, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (path) => {
    return location.pathname === path ? 'bg-blue-700 dark:bg-blue-800' : '';
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setIsMobileMenuOpen(false);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <nav className="bg-blue-600 dark:bg-gray-800 text-white shadow-lg">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-4">
            <Link to="/" className="text-xl font-bold">
              AIOgames
            </Link>
            {/* Desktop Navigation */}
            <div className="hidden md:flex space-x-2">
              <Link
                to="/"
                className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors ${isActive('/')}`}
              >
                <span className="flex items-center gap-2">
                  <Home size={18} />
                  Dashboard
                </span>
              </Link>
              {isAuthenticated && (
                <>
                  <Link
                    to="/downloads"
                    className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors ${isActive('/downloads')}`}
                  >
                    <span className="flex items-center gap-2">
                      <Download size={18} />
                      Downloads
                    </span>
                  </Link>
                  <Link
                    to="/updates"
                    className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors ${isActive('/updates')}`}
                  >
                    <span className="flex items-center gap-2">
                      <RefreshCw size={18} />
                      Updates
                    </span>
                  </Link>
                  <Link
                    to="/storage"
                    className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors ${isActive('/storage')}`}
                  >
                    <span className="flex items-center gap-2">
                      <HardDrive size={18} />
                      Storage
                    </span>
                  </Link>
                </>
              )}
            </div>
          </div>
          
          {/* Desktop Controls */}
          <div className="hidden md:flex items-center space-x-2">
            {/* Dark Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors"
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            
            {isAuthenticated ? (
              <button
                onClick={handleLogout}
                className="px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <LogOut size={18} />
                  Logout
                </span>
              </button>
            ) : (
              <Link
                to="/login"
                className="px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <LogIn size={18} />
                  Login
                </span>
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center space-x-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors"
              aria-label="Toggle dark mode"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 rounded-md hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors"
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-blue-500 dark:border-gray-700">
            <div className="px-2 pt-2 pb-3 space-y-1">
              <Link
                to="/"
                onClick={closeMobileMenu}
                className={`block px-3 py-2 rounded-md text-base font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors ${isActive('/')}`}
              >
                <span className="flex items-center gap-2">
                  <Home size={18} />
                  Dashboard
                </span>
              </Link>
              {isAuthenticated ? (
                <>
                  <Link
                    to="/downloads"
                    onClick={closeMobileMenu}
                    className={`block px-3 py-2 rounded-md text-base font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors ${isActive('/downloads')}`}
                  >
                    <span className="flex items-center gap-2">
                      <Download size={18} />
                      Downloads
                    </span>
                  </Link>
                  <Link
                    to="/updates"
                    onClick={closeMobileMenu}
                    className={`block px-3 py-2 rounded-md text-base font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors ${isActive('/updates')}`}
                  >
                    <span className="flex items-center gap-2">
                      <RefreshCw size={18} />
                      Updates
                    </span>
                  </Link>
                  <Link
                    to="/storage"
                    onClick={closeMobileMenu}
                    className={`block px-3 py-2 rounded-md text-base font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors ${isActive('/storage')}`}
                  >
                    <span className="flex items-center gap-2">
                      <HardDrive size={18} />
                      Storage
                    </span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left block px-3 py-2 rounded-md text-base font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <LogOut size={18} />
                      Logout
                    </span>
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  onClick={closeMobileMenu}
                  className="block px-3 py-2 rounded-md text-base font-medium hover:bg-blue-700 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <LogIn size={18} />
                    Login
                  </span>
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
