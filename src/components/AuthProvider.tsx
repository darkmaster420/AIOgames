'use client';

import { SessionProvider, signOut, useSession } from 'next-auth/react';
import { ReactNode, useEffect } from 'react';

interface AuthProviderProps {
  children: ReactNode;
}

function SessionHealthGuard() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.accountMissing) {
      void signOut({ callbackUrl: '/auth/signin' });
    }
  }, [session?.user?.accountMissing, status]);

  return null;
}

export default function AuthProvider({ children }: AuthProviderProps) {
  return (
    <SessionProvider
      refetchOnWindowFocus={true}
      refetchInterval={5 * 60} // refresh every 5 minutes to keep role/claims fresh
    >
      <SessionHealthGuard />
      {children}
    </SessionProvider>
  );
}
