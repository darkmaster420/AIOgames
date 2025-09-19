import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './contexts/ThemeContext'
import Navbar from './components/Navbar'
import Dashboard from './components/Dashboard'
import Downloads from './components/Downloads'
import Updates from './components/Updates'
import StorageManagement from './components/StorageManagement'
import LoginForm from './components/LoginForm'

const PrivateRoute = ({ element }) => {
  const token = localStorage.getItem('token')
  return token ? element : <Navigate to="/login" />
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'))

  useEffect(() => {
    const token = localStorage.getItem('token')
    setIsAuthenticated(!!token)
  }, [])

  // Debug logging
  console.log('Is Authenticated:', isAuthenticated)
  console.log('Current token:', localStorage.getItem('token'))

  return (
    <ThemeProvider>
      <Router>
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
          <Toaster 
            position="top-right" 
            containerClassName="!top-16 !right-2 !left-2 sm:!left-auto sm:!right-4" 
            toastOptions={{
              className: 'text-sm max-w-sm',
              duration: 4000,
            }}
          />
          <Navbar isAuthenticated={isAuthenticated} setIsAuthenticated={setIsAuthenticated} />
          <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/login" element={!isAuthenticated ? <LoginForm setIsAuthenticated={setIsAuthenticated} /> : <Navigate to="/" />} />
              <Route path="/downloads" element={<PrivateRoute element={<Downloads />} />} />
              <Route path="/updates" element={<PrivateRoute element={<Updates />} />} />
              <Route path="/storage" element={<PrivateRoute element={<StorageManagement />} />} />
            </Routes>
          </main>
        </div>
      </Router>
    </ThemeProvider>
  )
}
