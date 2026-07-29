import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'WhatsaForge',
  description: 'Pair your WhatsApp account and manage your autoreply bot',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4c1d95',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-surface font-sans text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
