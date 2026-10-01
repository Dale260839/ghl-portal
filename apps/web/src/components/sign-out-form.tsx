'use client';

import type { ReactNode } from 'react';
import { signOut } from '@/lib/actions';

export function SignOutForm({ children }: { children: ReactNode }) {
  return <form action={signOut} onSubmit={() => {
    try {
      window.localStorage.removeItem('bs_field_draft:update');
      for (const key of Object.keys(window.sessionStorage)) {
        if (key.startsWith('bs_field_draft:')) window.sessionStorage.removeItem(key);
      }
    } catch {}
  }}>{children}</form>;
}
