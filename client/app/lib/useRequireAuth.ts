'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeSession, type AuthUser } from './api';

// The saved user, read straight from localStorage. `undefined` means "not
// known yet" (server render and hydration), `null` means "not logged in".
const readUser = () => (localStorage.getItem('token') ? localStorage.getItem('user') : null);
const serverUser = () => undefined;

export const useSession = (): AuthUser | null | undefined => {
  const raw = useSyncExternalStore(subscribeSession, readUser, serverUser);
  return useMemo(() => {
    if (raw === undefined) return undefined;
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  }, [raw]);
};

// Call at the top of any page that requires login:
//   const user = useRequireAuth();                     // any logged-in user
//   const user = useRequireAuth('admin');              // admins only
//   const user = useRequireAuth(['doctor', 'admin']);  // either role
// Redirects to login (or the dashboard if the role doesn't match) and
// returns the user once verified, or null while checking.
export const useRequireAuth = (requiredRole?: AuthUser['role'] | AuthUser['role'][]) => {
  const router = useRouter();
  const session = useSession();
  const roles = requiredRole === undefined ? null : ([] as AuthUser['role'][]).concat(requiredRole);
  const roleKey = roles?.join(',') ?? '';
  const allowed = Boolean(session && (!roles || roles.includes(session.role)));

  useEffect(() => {
    if (session === undefined) return; // still hydrating
    if (session === null) router.replace('/auth/login');
    else if (!allowed) router.replace('/dashboard');
  }, [session, allowed, roleKey, router]);

  return allowed ? (session as AuthUser) : null;
};
