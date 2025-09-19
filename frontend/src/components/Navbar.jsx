import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Download, RefreshCw, LogOut } from 'lucide-react';

const Navbar = () => {
  const location = useLocation();

  const isActive = (path) => {
    return location.pathname === path ? 'bg-blue-700' : '';
  };

  return (
    <nav className="bg-blue-600 text-white shadow-lg">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-4">
            <Link to="/" className="text-xl font-bold">
              AIOgames
            </Link>
            <div className="hidden md:flex space-x-2">
              <Link
                to="/"
                className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors ${isActive(
                  '/'
                )}`}
              >
                <span className="flex items-center gap-2">
                  <Home size={18} />
                  Dashboard
                </span>
              </Link>
              <Link
                to="/downloads"
                className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors ${isActive(
                  '/downloads'
                )}`}
              >
                <span className="flex items-center gap-2">
                  <Download size={18} />
                  Downloads
                </span>
              </Link>
              <Link
                to="/updates"
                className={`px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors ${isActive(
                  '/updates'
                )}`}
              >
                <span className="flex items-center gap-2">
                  <RefreshCw size={18} />
                  Updates
                </span>
              </Link>
            </div>
          </div>
          <div className="flex items-center">
            <Link
              to="/login"
              className="px-3 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <span className="flex items-center gap-2">
                <LogOut size={18} />
                Logout
              </span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
