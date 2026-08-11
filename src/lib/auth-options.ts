import type { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import connectDB from './db';
import { User } from './models';

export const authOptions: AuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email or Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          const db = await connectDB();
          if (!db) {
            console.error('Database connection failed');
            throw new Error('Database connection failed');
          }
          
          // Support login with either email OR username in the same field.
          const loginId = credentials.email.toLowerCase();
          const user = await User.findOne({
            $or: [
              { email: loginId },
              { username: loginId }
            ]
          });

          if (!user) {
            return null;
          }

          // Check if user is banned
          if (user.banned) {
            throw new Error(`Your account has been banned. Reason: ${user.bannedReason || 'No reason provided'}`);
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          );

          if (!isPasswordValid) {
            return null;
          }

          // Update last login
          await User.findByIdAndUpdate(user._id, {
            lastLogin: new Date()
          });

          return {
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            role: user.role || 'user',
            username: user.username,
          } as {
            id: string;
            email: string;
            name: string;
            role: string;
            username?: string;
          };
        } catch (error) {
          console.error('Auth error:', error);
          return null;
        }
      }
    })
  ],
  session: {
    strategy: 'jwt' as const,
  },
  pages: {
    signIn: '/auth/signin',
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Decode any URL-encoded callback URLs to prevent double encoding issues
      const decodedUrl = decodeURIComponent(url);
      
      // If the URL starts with the base URL, use it as-is (already absolute)
      if (decodedUrl.startsWith(baseUrl)) {
        return decodedUrl;
      }
      // If it's a relative URL (starts with /), make it absolute
      if (decodedUrl.startsWith('/')) {
        return `${baseUrl}${decodedUrl}`;
      }
      // Otherwise return the base URL to prevent open redirects
      return baseUrl;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as unknown as { id: string }).id;
        token.role = (user as unknown as { role?: string }).role;
        token.username = (user as unknown as { username?: string }).username;
        token.accountMissing = false;
        token.userValidatedAt = Date.now();
        return token;
      }

      const lastValidated = Number(token.userValidatedAt || 0);
      if (Date.now() - lastValidated >= 5 * 60 * 1000) {
        try {
          await connectDB();

          const tokenId = String(token.id || '');
          const tokenEmail = String(token.email || '').trim().toLowerCase();
          let currentUser = /^[a-f\d]{24}$/i.test(tokenId)
            ? await User.findById(tokenId).select('_id role username banned')
            : null;

          // A restored/recreated database gives the same account a new ObjectId.
          // Recover the session by its unique email instead of making the user log in again.
          if (!currentUser && tokenEmail) {
            currentUser = await User.findOne({ email: tokenEmail }).select('_id role username banned');
          }

          if (currentUser && !currentUser.banned) {
            token.id = currentUser._id.toString();
            token.role = currentUser.role || 'user';
            token.username = currentUser.username;
            token.accountMissing = false;
          } else {
            token.id = '';
            token.accountMissing = true;
          }
          token.userValidatedAt = Date.now();
        } catch (error) {
          // Keep the existing session during transient database failures.
          console.error('Failed to validate auth session:', error);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        (session.user as { id: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { username?: string }).username = token.username as string | undefined;
        (session.user as { accountMissing?: boolean }).accountMissing = Boolean(token.accountMissing);
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
