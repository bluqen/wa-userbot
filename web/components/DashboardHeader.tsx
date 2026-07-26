'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SignOutButton from './SignOutButton';

function NavLink({
  href,
  label,
  active,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-sm font-medium transition ${
        active
          ? 'bg-surface-raised text-slate-100'
          : 'text-slate-300 hover:bg-surface-raised hover:text-slate-100'
      }`}
    >
      {label}
    </Link>
  );
}

// Desktop keeps everything in one row; below sm, nav links and the
// account row collapse behind a hamburger toggle instead of squeezing the
// logo/nav/email/sign-out into one line that would otherwise wrap badly
// or force horizontal scrolling on a phone-width screen.
export default function DashboardHeader({
  email,
  isAdmin,
}: {
  email: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const onAdmin = pathname?.startsWith('/dashboard/admin') ?? false;

  return (
    <header className="sticky top-0 z-40 border-b border-surface-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-3 sm:gap-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
              W
            </span>
            <span className="text-base font-semibold tracking-tight sm:text-lg">
              WA Bot Console
            </span>
          </Link>
          <nav className="hidden gap-1 sm:flex">
            <NavLink href="/dashboard" label="Sessions" active={!onAdmin} />
            {isAdmin && <NavLink href="/dashboard/admin" label="Admin" active={onAdmin} />}
          </nav>
        </div>

        <div className="hidden items-center gap-4 sm:flex">
          <span className="max-w-[220px] truncate text-sm text-slate-400">{email}</span>
          <SignOutButton />
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-surface-border text-slate-300 sm:hidden"
        >
          {open ? '✕' : '☰'}
        </button>
      </div>

      {open && (
        <div className="border-t border-surface-border px-4 py-3 sm:hidden">
          <nav className="flex flex-col gap-1">
            <NavLink href="/dashboard" label="Sessions" active={!onAdmin} onClick={() => setOpen(false)} />
            {isAdmin && (
              <NavLink
                href="/dashboard/admin"
                label="Admin"
                active={onAdmin}
                onClick={() => setOpen(false)}
              />
            )}
          </nav>
          <div className="mt-3 flex items-center justify-between border-t border-surface-border pt-3">
            <span className="truncate text-sm text-slate-400">{email}</span>
            <SignOutButton />
          </div>
        </div>
      )}
    </header>
  );
}
