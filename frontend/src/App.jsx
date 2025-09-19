import React, { useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Navbar from './components/Navbar'
import Dashboard from './components/Dashboard'
import Downloads from './components/Downloads'
import Updates from './components/Updates'
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
    <Router>
      <div className="min-h-screen bg-gray-100">
        <Toaster position="top-right" />
        {isAuthenticated && <Navbar />}
        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={isAuthenticated ? <Dashboard /> : <Navigate to="/login" />} />
            <Route path="/login" element={!isAuthenticated ? <LoginForm setIsAuthenticated={setIsAuthenticated} /> : <Navigate to="/" />} />
            <Route path="/downloads" element={isAuthenticated ? <Downloads /> : <Navigate to="/login" />} />
            <Route path="/updates" element={isAuthenticated ? <Updates /> : <Navigate to="/login" />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}
