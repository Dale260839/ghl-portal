'use client';

import type { ReactNode } from 'react';

export function SignOutForm({ children }: { children: ReactNode }) {
  // A native POST keeps working when this tab outlives a deployment's action IDs.
  return <form action="/api/auth/sign-out" method="post" onSubmit={() => {
    try {
      window.localStorage.removeItem('bs_field_draft:update');
      for (const key of Object.keys(window.sessionStorage)) {
        if (key.startsWith('bs_field_draft:')) window.sessionStorage.removeItem(key);
      }
    } catch {}
  }}>{children}</form>;
}
