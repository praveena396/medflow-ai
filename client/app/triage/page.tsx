'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { useRequireAuth } from '../lib/useRequireAuth';

interface TriageResult {
  urgency: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  nextSteps?: string[];
  symptoms?: string;
  createdAt?: string;
}

const URGENCY_COLORS = {
  low: 'bg-green-100 border-green-400 text-green-800',
  medium: 'bg-yellow-100 border-yellow-400 text-yellow-800',
  high: 'bg-orange-100 border-orange-400 text-orange-800',
  critical: 'bg-red-100 border-red-400 text-red-800',
};

export default function TriagePage() {
  const user = useRequireAuth();
  const [symptoms, setSymptoms] = useState('');
  const [result, setResult] = useState<TriageResult | null>(null);
  const [history, setHistory] = useState<TriageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = () =>
    apiJson<{ triages: TriageResult[] }>('/api/triage/history')
      .then((data) => setHistory(data.triages))
      .catch(() => {});

  useEffect(() => {
    if (user) loadHistory();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptoms.trim() || loading) return;

    setLoading(true);
    setError('');
    try {
      const data = await apiJson<{ triage: TriageResult }>('/api/triage', {
        method: 'POST',
        body: JSON.stringify({ symptoms }),
      });
      setResult(data.triage);
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process triage');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-blue-600">Symptom Triage</h1>

        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow-lg mb-6">
          <label className="block text-gray-700 font-bold mb-2">Describe your symptoms</label>
          <textarea
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            placeholder="E.g., I have a severe headache and fever..."
            className="w-full px-4 py-2 border border-gray-300 rounded h-32"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Analyzing…' : 'Get Triage Assessment'}
          </button>
        </form>

        {result && (
          <div className="bg-white p-6 rounded-lg shadow-lg mb-6">
            <div className={`border-l-4 p-4 mb-4 ${URGENCY_COLORS[result.urgency]}`}>
              <h2 className="text-xl font-bold mb-2">Urgency Level: {result.urgency.toUpperCase()}</h2>
              <p>{result.recommendation}</p>
            </div>

            <div>
              <h3 className="font-bold mb-2">Recommended Next Steps:</h3>
              <ul className="list-disc pl-5">
                {result.nextSteps?.map((step, idx) => (
                  <li key={idx} className="text-gray-700">{step}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h2 className="text-xl font-bold mb-4">Past Assessments</h2>
            <ul className="divide-y">
              {history.map((item, idx) => (
                <li key={idx} className="py-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-bold border ${URGENCY_COLORS[item.urgency]}`}>
                      {item.urgency.toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-400">
                      {item.createdAt && new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-gray-700 mt-1">{item.symptoms}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
