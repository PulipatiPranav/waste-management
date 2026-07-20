'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { visibleNav } from '@/lib/auth/nav';

/**
 * The authenticated shell. It is the console's auth GATE: an unauthenticated visitor is bounced to
 * /login before any dashboard renders, and the nav shows only the sections the signed-in role may
 * reach. The backend enforces the same roles on every call — this is the courtesy layer so a link
 * that would only 403 is never shown.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <main className="shell">
        <p className="muted" role="status">
          Loading console…
        </p>
      </main>
    );
  }

  if (status === 'unauthenticated' || user === null) {
    // The redirect effect is in flight; render nothing to avoid a flash of the shell.
    return null;
  }

  const nav = visibleNav(user.role);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar__brand">CPE Ops</div>
        {nav.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar__link ${active ? 'sidebar__link--active' : ''}`}
            >
              {item.label}
            </Link>
          );
        })}
        <div className="sidebar__footer">
          <div className="muted">{user.email ?? user.name ?? 'Staff'}</div>
          <div className="muted mono">{user.role}</div>
          <div style={{ marginTop: '0.5rem' }}>
            <Button
              variant="ghost"
              onClick={() => {
                void logout().then(() => router.replace('/login'));
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}
