'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiJson } from '../lib/api';
import { useRequireAuth } from '../lib/useRequireAuth';

interface Stats {
  users: Record<string, number>;
  appointments: Record<string, number>;
  upcomingAppointments: number;
  triageByUrgency: Record<string, number>;
  totalDocuments: number;
}

interface QueueItem {
  _id: string;
  dateTime: string;
  reason: string;
  status: string;
  patientId?: { name: string; email: string };
  doctorId?: { name: string; email: string };
}

interface AdminUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface Health {
  status: string;
  services: Record<string, string>;
}

const URGENCY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  high: 'bg-orange-100 text-orange-800 border-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  low: 'bg-green-100 text-green-800 border-green-300',
};

export default function AdminDashboardPage() {
  const user = useRequireAuth('admin');
  const [stats, setStats] = useState<Stats | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');

  const rangeQuery = from || to ? `?from=${from}&to=${to}` : '';

  const loadAll = useCallback(async () => {
    try {
      setError('');
      const [statsData, queueData, healthRes] = await Promise.all([
        apiJson<Stats>(`/api/admin/stats${rangeQuery}`),
        apiJson<{ appointments: QueueItem[] }>(`/api/admin/appointments${rangeQuery}`),
        fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/health`).then(
          (r) => r.json()
        ),
      ]);
      setStats(statsData);
      setQueue(queueData.appointments);
      setHealth(healthRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    }
  }, [rangeQuery]);

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiJson<{ users: AdminUser[] }>(
        `/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`
      );
      setUsers(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    }
  }, [search]);

  useEffect(() => {
    if (user) loadAll();
  }, [user, loadAll]);

  // Debounce the user search: wait 400ms after typing stops before asking the server.
  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(loadUsers, 400);
    return () => clearTimeout(timer);
  }, [user, loadUsers]);

  const downloadCsv = async () => {
    try {
      const response = await apiFetch(`/api/admin/export/appointments${rangeQuery}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'appointments.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  if (!user) return null; // still checking login / redirecting

  const totalUsers = stats ? Object.values(stats.users).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <h1 className="text-4xl font-bold text-blue-600">🛡️ Admin Dashboard</h1>
          <div className="flex items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border border-gray-300 rounded" />
            <span className="text-gray-500">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border border-gray-300 rounded" />
            <button onClick={downloadCsv} className="bg-blue-600 text-white px-4 py-2 rounded font-bold hover:bg-blue-700">
              ⬇ Export CSV
            </button>
          </div>
        </div>

        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-5 rounded-lg shadow">
            <p className="text-gray-500 text-sm">Total Users</p>
            <p className="text-3xl font-bold">{totalUsers}</p>
            <p className="text-xs text-gray-400 mt-1">
              {Object.entries(stats?.users || {}).map(([role, n]) => `${n} ${role}`).join(' · ')}
            </p>
          </div>
          <div className="bg-white p-5 rounded-lg shadow">
            <p className="text-gray-500 text-sm">Upcoming Appointments</p>
            <p className="text-3xl font-bold">{stats?.upcomingAppointments ?? '–'}</p>
          </div>
          <div className="bg-white p-5 rounded-lg shadow">
            <p className="text-gray-500 text-sm">Documents Uploaded</p>
            <p className="text-3xl font-bold">{stats?.totalDocuments ?? '–'}</p>
          </div>
          <div className="bg-white p-5 rounded-lg shadow">
            <p className="text-gray-500 text-sm">System Status</p>
            <p className={`text-3xl font-bold ${health?.status === 'OK' ? 'text-green-600' : 'text-red-600'}`}>
              {health?.status || '–'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {Object.entries(health?.services || {}).map(([name, s]) => `${name}: ${s}`).join(' · ')}
            </p>
          </div>
        </div>

        {/* Triage summary */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold mb-4">Triage Cases by Urgency</h2>
          <div className="grid grid-cols-4 gap-4">
            {(['critical', 'high', 'medium', 'low'] as const).map((level) => (
              <div key={level} className={`border rounded-lg p-4 text-center ${URGENCY_STYLES[level]}`}>
                <p className="text-2xl font-bold">{stats?.triageByUrgency[level] || 0}</p>
                <p className="text-sm font-bold uppercase">{level}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Appointment queue */}
        <div className="bg-white p-6 rounded-lg shadow mb-8 overflow-x-auto">
          <h2 className="text-xl font-bold mb-4">Appointment Queue</h2>
          {queue.length === 0 ? (
            <p className="text-gray-500">No scheduled appointments in this period.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Patient</th>
                  <th className="py-2 pr-4">Doctor</th>
                  <th className="py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item._id} className="border-b last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap">{new Date(item.dateTime).toLocaleString()}</td>
                    <td className="py-2 pr-4">{item.patientId?.name || '—'}</td>
                    <td className="py-2 pr-4">{item.doctorId?.name || '—'}</td>
                    <td className="py-2">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* User list */}
        <div className="bg-white p-6 rounded-lg shadow overflow-x-auto">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-xl font-bold">Users</h2>
            <input
              type="text"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded w-64"
            />
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-bold">{u.name}</td>
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                      u.role === 'admin' ? 'bg-purple-100 text-purple-800'
                      : u.role === 'doctor' ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                    }`}>{u.role}</span>
                  </td>
                  <td className="py-2">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
