'use client';

import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="rounded-md border border-surface-border px-3 py-1.5 text-sm text-slate-300 transition hover:bg-surface-raised"
    >
      Sign out
    </button>
  );
}
