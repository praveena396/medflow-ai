'use client';

import { useRequireAuth } from '../lib/useRequireAuth';

export default function DashboardPage() {
  const user = useRequireAuth();
  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-blue-600">Dashboard</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold mb-2">💬 Chat with AI</h3>
            <p className="text-gray-600 mb-4">Get medical advice from our AI assistant</p>
            <a href="/chat" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Go to Chat</a>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold mb-2">🏥 Symptom Triage</h3>
            <p className="text-gray-600 mb-4">Get urgency assessment for your symptoms</p>
            <a href="/triage" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Start Triage</a>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold mb-2">📅 Appointments</h3>
            <p className="text-gray-600 mb-4">Book and manage your appointments</p>
            <a href="/appointments" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">View Appointments</a>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold mb-2">🩺 Health Record</h3>
            <p className="text-gray-600 mb-4">Allergies, medications, visits and linked documents</p>
            <a href="/records" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Open Record</a>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-xl font-bold mb-2">📄 Documents</h3>
            <p className="text-gray-600 mb-4">Upload reports, or photos of lab results and prescriptions</p>
            <a href="/documents" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Manage Documents</a>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-2xl font-bold mb-4">Welcome to MedFlow AI</h2>
          <p className="text-gray-700">Your personal healthcare assistant powered by AI. Chat with our health bot, get symptom assessment, and manage your appointments all in one place.</p>
        </div>
      </div>
    </div>
  );
}
