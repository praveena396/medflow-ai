'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getUser, logout, type AuthUser } from '../lib/api';

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);

  // Read the saved login after mount (localStorage doesn't exist during
  // server rendering). Re-check on navigation so login/logout updates the bar.
  useEffect(() => {
    setUser(getUser());
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    router.push('/auth/login');
  };

  return (
    <nav className="bg-blue-600 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          <Link href="/" className="text-2xl font-bold">
            🏥 MedFlow AI
          </Link>
          <div className="flex items-center space-x-4">
            {user && (
              <>
                <Link href="/chat" className="hover:text-blue-200">Chat</Link>
                <Link href="/triage" className="hover:text-blue-200">Triage</Link>
                <Link href="/appointments" className="hover:text-blue-200">Appointments</Link>
                <Link href="/documents" className="hover:text-blue-200">Documents</Link>
                {user.role === 'admin' && (
                  <Link href="/admin" className="hover:text-blue-200 font-bold">Admin</Link>
                )}
                <span className="text-blue-200 hidden sm:inline">Hi, {user.name}</span>
                <button
                  onClick={handleLogout}
                  className="bg-white text-blue-600 px-4 py-2 rounded font-bold hover:bg-blue-100"
                >
                  Logout
                </button>
              </>
            )}
            {!user && (
              <Link href="/auth/login" className="bg-white text-blue-600 px-4 py-2 rounded">
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
