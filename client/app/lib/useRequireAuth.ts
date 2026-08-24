'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser, type AuthUser } from './api';

// Call at the top of any page that requires login:
//   const user = useRequireAuth();            // any logged-in user
//   const user = useRequireAuth('admin');     // admins only
// Redirects to login (or dashboard if the role doesn't match) and
// returns the user once verified, or null while checking.
export const useRequireAuth = (requiredRole?: AuthUser['role']) => {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    // localStorage only exists in the browser, so this runs after mount.
    const token = getToken();
    const currentUser = getUser();

    if (!token || !currentUser) {
      router.replace('/auth/login');
      return;
    }
    if (requiredRole && currentUser.role !== requiredRole) {
      router.replace('/dashboard');
      return;
    }
    setUser(currentUser);
  }, [router, requiredRole]);

  return user;
};
