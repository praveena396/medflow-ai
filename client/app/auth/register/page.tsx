'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authPost, saveSession } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ email: '', password: '', name: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Phone is optional; leave it out entirely when empty.
      const { phone, ...rest } = formData;
      const response = await authPost('/api/auth/register', phone.trim() ? { ...rest, phone: phone.trim() } : rest);
      const data = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(data.message || 'Registration failed');

      saveSession(data); // access token + user; the refresh token is an httpOnly cookie
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center text-blue-600">Register</h1>
        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 font-bold mb-2">Name</label>
            <input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded" required />
          </div>
          <div>
            <label className="block text-gray-700 font-bold mb-2">Email</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded" required />
          </div>
          <div>
            <label className="block text-gray-700 font-bold mb-2">Password</label>
            <input type="password" name="password" value={formData.password} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded" minLength={8} required />
            <p className="text-sm text-gray-500 mt-1">At least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="phone" className="block text-gray-700 font-bold mb-2">
              Mobile phone <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="+15715550123"
              pattern="\+[1-9][0-9]{7,14}"
              title="International format: + then country code and number, e.g. +15715550123"
              autoComplete="tel"
              className="w-full px-4 py-2 border border-gray-300 rounded"
            />
            <p className="text-sm text-gray-500 mt-1">For SMS appointment reminders. International format, e.g. +15715550123.</p>
          </div>
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700">{loading ? 'Registering...' : 'Register'}</button>
        </form>
        <p className="mt-4 text-center"><Link href="/auth/login" className="text-blue-600 hover:underline">Already have account? Login</Link></p>
      </div>
    </div>
  );
}
