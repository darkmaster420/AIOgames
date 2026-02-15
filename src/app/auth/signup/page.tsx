'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignUp() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to sign in after 5 seconds
    const timer = setTimeout(() => {
      router.push('/auth/signin');
    }, 5000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 bg-white dark:bg-gray-800 p-8 rounded-lg shadow-lg">
        <div className="text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-4">
            Registration Closed
          </h2>
          <div className="space-y-4">
            <p className="text-gray-600 dark:text-gray-400">
              Public user registration is currently disabled.
            </p>
            <p className="text-gray-600 dark:text-gray-400">
              To create an account, please contact an administrator.
            </p>
            <div className="pt-4 space-y-3">
              <Link 
                href="/auth/signin"
                className="block w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Go to Sign In
              </Link>
              <Link 
                href="/"
                className="block w-full px-4 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
              >
                Browse Games
              </Link>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 pt-4">
              Redirecting to sign in page in 5 seconds...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
