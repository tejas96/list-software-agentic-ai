import type { Metadata } from 'next';
// Self-hosted fonts: builds need no network access.
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'List Software · Agentic Engineering', template: '%s · List Software' },
  description: 'AI agent team for the full software lifecycle, with approvals and evidence.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
