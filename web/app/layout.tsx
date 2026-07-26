import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'WA Bot Console',
  description: 'Pair your WhatsApp account and manage your autoreply bot',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
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
