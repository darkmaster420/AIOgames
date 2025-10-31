'use client';

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { validateEmailOrUsername, normalizeLoginInput } from '../../../utils/authUtils';

import { Suspense } from 'react';

function SignInInner() {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputValidation, setInputValidation] = useState<{ isValid: boolean; type: 'email' | 'username' | null }>({ isValid: false, type: null });
  const searchParams = useSearchParams();
  // Get callbackUrl and ensure it's a valid path (not double-encoded)
  const rawCallbackUrl = searchParams.get('callbackUrl') || '/';
  // If the callback URL looks like an encoded URL, decode it
  const callbackUrl = rawCallbackUrl.includes('%') ? decodeURIComponent(rawCallbackUrl) : rawCallbackUrl;
  const message = searchParams.get('message');
  const { status } = useSession();

  // If already authenticated, redirect away quickly
  useEffect(() => {
    if (status === 'authenticated') {
      window.location.href = callbackUrl;
    }
  }, [status, callbackUrl]);

  // Validate input as user types
  const handleInputChange = (value: string) => {
    setEmailOrUsername(value);
    const validation = validateEmailOrUsername(value);
    setInputValidation({ isValid: validation.isValid, type: validation.type });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Client-side validation
    const validation = validateEmailOrUsername(emailOrUsername);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid email or username format');
      setLoading(false);
      return;
    }

    try {
      const normalizedInput = normalizeLoginInput(emailOrUsername);
      const result = await signIn('credentials', { email: normalizedInput, password, redirect: false });

      // Check if sign in was successful
      if (!result?.ok || result?.error) {
        setError(result?.error || 'Invalid email/username or password');
        setLoading(false);
        return;
      }

      // Sign in was successful, redirect
      window.location.href = callbackUrl;
    } catch (err) {
      console.error('Sign in exception:', err);
      setError('An error occurred during sign in');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white">
            Sign in to AIOgames
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            Or{' '}
            <Link 
              href="/auth/signup" 
              className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              create a new account
            </Link>
          </p>
        </div>
        {message && (
          <div className="mb-4 p-3 bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-600 text-green-700 dark:text-green-300 rounded-md text-sm text-center">
            {message}
          </div>
        )}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm space-y-4">
            <div>
              <label htmlFor="emailOrUsername" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Email or Username
              </label>
              <div className="relative">
                <input
                  id="emailOrUsername"
                  name="emailOrUsername"
                  type="text"
                  autoComplete="email"
                  required
                  value={emailOrUsername}
                  onChange={(e) => handleInputChange(e.target.value)}
                  className={`mt-1 appearance-none relative block w-full px-3 py-2 pr-10 border ${
                    emailOrUsername && inputValidation.isValid 
                      ? 'border-green-500 dark:border-green-400' 
                      : emailOrUsername && !inputValidation.isValid
                      ? 'border-red-500 dark:border-red-400'
                      : 'border-gray-300 dark:border-gray-600'
                  } placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white bg-white dark:bg-gray-800 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm`}
                  placeholder="Enter email or username"
                />
                {emailOrUsername && (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center mt-1">
                    {inputValidation.isValid ? (
                      <span className="text-green-500 text-sm">
                        {inputValidation.type === 'email' ? '📧' : '👤'}
                      </span>
                    ) : (
                      <span className="text-red-500 text-sm">❌</span>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                You can sign in with either your email address or username
                {emailOrUsername && inputValidation.isValid && (
                  <span className="text-green-600 dark:text-green-400 ml-1">
                    • Detected as {inputValidation.type}
                  </span>
                )}
              </p>
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-white bg-white dark:bg-gray-800 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="Enter your password"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-900 p-4">
              <div className="text-sm text-red-800 dark:text-red-200">
                {error}
              </div>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SignIn() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}