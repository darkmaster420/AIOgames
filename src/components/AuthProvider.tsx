'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';

interface AuthProviderProps {
  children: ReactNode;
}

export default function AuthProvider({ children }: AuthProviderProps) {
  return (
    <SessionProvider
      session={{
        user: {
          id: 'local',
          email: 'local@aiogames.invalid',
          name: 'Local Library',
          username: 'local',
          role: 'owner',
        },
        expires: '2999-12-31T23:59:59.999Z',
      }}
      refetchOnWindowFocus={false}
      refetchInterval={0}
    >
      {children}
    </SessionProvider>
  );
}
