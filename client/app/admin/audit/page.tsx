'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiJson, errorMessage } from '../../lib/api';
import { useRequireAuth } from '../../lib/useRequireAuth';

interface AuditEntry {
  _id: string;
  action: string;
  actorRole?: string;
  actorId?: { _id: string; name: string; email: string; role: string } | null;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

const ACTIONS = [
  { value: '', label: 'All actions' },
  { value: 'ai.*', label: 'All AI outputs' },
  { value: 'ai.chat.answer', label: 'Chat: answered' },
  { value: 'ai.chat.declined', label: 'Chat: declined' },
  { value: 'ai.chat.error', label: 'Chat: AI error' },
  { value: 'ai.triage', label: 'Triage result' },
  { value: 'admin.*', label: 'All admin actions' },
  { value: 'admin.user.update', label: 'Admin: user changed' },
  { value: 'admin.appointment.update', label: 'Admin: appointment changed' },
  { value: 'admin.appointment.cancel', label: 'Admin: appointment cancelled' },
  { value: 'admin.export.appointments', label: 'Admin: CSV export' },
  { value: 'record.*', label: 'Health record changes' },
];

const PAGE_SIZE = 25;

const ACTION_STYLES: Record<string, string> = {
  ai: 'bg-indigo-100 text-indigo-800',
  admin: 'bg-purple-100 text-purple-800',
  record: 'bg-teal-100 text-teal-800',
};

// One readable line per entry; the full details are one click away.
const summarize = (entry: AuditEntry) => {
  const d = entry.details || {};
  if (entry.action.startsWith('ai.chat')) return `Q: ${String(d.question ?? '')}`;
  if (entry.action === 'ai.triage') return `${String(d.urgency ?? '').toUpperCase()}: ${String(d.symptoms ?? '')}`;
  if (d.changes) {
    return Object.entries(d.changes as Record<string, { from: unknown; to: unknown }>)
      .map(([field, change]) => `${field}: ${String(change.from)} → ${String(change.to)}`)
      .join(', ');
  }
  if (entry.action === 'admin.export.appointments') return `${String(d.rows ?? 0)} rows`;
  if (Array.isArray(d.fields)) return `fields: ${d.fields.join(', ')}`;
  return '';
};

export default function AuditLogPage() {
  const user = useRequireAuth('admin');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (action) params.set('action', action);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    apiJson<{ entries: AuditEntry[]; total: number }>(`/api/admin/audit?${params}`)
      .then((data) => {
        if (!active) return;
        setError('');
        setEntries(data.entries);
        setTotal(data.total);
      })
      .catch((err) => active && setError(errorMessage(err, 'Failed to load the audit log')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user, action, from, to, page]);

  if (!user) return null;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const changeFilter = (setter: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-4">
          <h1 className="text-4xl font-bold text-blue-600">Audit Log</h1>
          <Link href="/admin" className="text-blue-600 hover:underline">← Admin dashboard</Link>
        </div>
        <p className="text-gray-600 mb-6">
          Append-only record of every AI answer, decline and triage result, and of admin and health-record changes.
          Entries can&apos;t be edited or deleted.
        </p>

        <div className="bg-white p-4 rounded-lg shadow mb-6 flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-sm text-gray-600">
            Action
            <select value={action} onChange={changeFilter(setAction)} className="mt-1 px-3 py-2 border border-gray-300 rounded">
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm text-gray-600">
            From
            <input type="date" value={from} onChange={changeFilter(setFrom)} className="mt-1 px-3 py-2 border border-gray-300 rounded" />
          </label>
          <label className="flex flex-col text-sm text-gray-600">
            To
            <input type="date" value={to} onChange={changeFilter(setTo)} className="mt-1 px-3 py-2 border border-gray-300 rounded" />
          </label>
          <p className="text-sm text-gray-500 ml-auto">{total} entries</p>
        </div>

        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}

        <div className="bg-white rounded-lg shadow overflow-x-auto">
          {loading ? (
            <p className="p-6 text-gray-500">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="p-6 text-gray-500">No entries match these filters.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-2 px-4">When</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">By</th>
                  <th className="py-2 pr-4">Target</th>
                  <th className="py-2 pr-4">Summary</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry._id} className="border-b last:border-0 align-top">
                    <td className="py-2 px-4 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-xs px-2 py-1 rounded-full font-bold whitespace-nowrap ${ACTION_STYLES[entry.action.split('.')[0]] || 'bg-gray-100 text-gray-800'}`}>
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {entry.actorId ? (
                        <>
                          <span className="font-bold">{entry.actorId.name}</span>
                          <span className="text-gray-500"> ({entry.actorRole})</span>
                        </>
                      ) : (
                        <span className="text-gray-500">{entry.actorRole || 'system'}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">
                      {entry.targetType}
                      {entry.targetId && <span className="text-gray-400"> …{entry.targetId.slice(-6)}</span>}
                    </td>
                    <td className="py-2 pr-4 max-w-md">
                      <p className="truncate" title={summarize(entry)}>{summarize(entry)}</p>
                      <details className="text-xs text-gray-500">
                        <summary className="cursor-pointer">Details</summary>
                        <pre className="whitespace-pre-wrap break-words bg-gray-50 p-2 rounded mt-1">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-center gap-4 mt-4">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">
            ← Newer
          </button>
          <span className="text-sm text-gray-600">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">
            Older →
          </button>
        </div>
      </div>
    </div>
  );
}
