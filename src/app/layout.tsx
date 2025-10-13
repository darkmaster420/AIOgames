import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/ThemeProvider";
import AuthProvider from "../components/AuthProvider";
import { NotificationProvider } from "../contexts/NotificationContext";
import { ConfirmProvider } from "../contexts/ConfirmContext";
import { NotificationContainer } from "../components/NotificationContainer";
import { Navigation } from "../components/Navigation";
import { Footer } from "../components/Footer";
import './init'; // Initialize background services including scheduler

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AIO Game Update Tracker",
  description: "All-in-one game update tracker",
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '16x16 32x32', type: 'image/x-icon' },
      { url: '/icon.svg', type: 'image/svg+xml' }
    ],
    shortcut: '/favicon.ico',
    apple: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
  <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-hero text-slate-900 dark:text-slate-100 min-h-screen flex flex-col`}
      >
        <AuthProvider>
          <ThemeProvider>
            <NotificationProvider>
              <ConfirmProvider>
                <Navigation />
                <div className="animate-fade-in flex-1">
                  {children}
                </div>
                <Footer />
                <NotificationContainer />
              </ConfirmProvider>
            </NotificationProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
