import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Providers } from '@/lib/query/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'CPE Ops Console',
  description: 'Internal operations dashboard for the Circular Paper Economy platform',
  // Never let an internal console be indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
