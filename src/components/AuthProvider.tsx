'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';

interface AuthProviderProps {
  children: ReactNode;
}

export default function AuthProvider({ children }: AuthProviderProps) {
  return (
    <SessionProvider
      refetchOnWindowFocus={true}
      refetchInterval={5 * 60} // refresh every 5 minutes to keep role/claims fresh
    >
      {children}
    </SessionProvider>
  );
}