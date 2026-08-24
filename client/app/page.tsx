'use client';

import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100">
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-blue-600 mb-4">🏥 MedFlow AI</h1>
          <p className="text-xl text-gray-700 mb-8">Your AI-Powered Healthcare Assistant</p>
          <div className="flex gap-4 justify-center">
            <Link href="/auth/login" className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 font-bold">Login</Link>
            <Link href="/auth/register" className="bg-white text-blue-600 px-8 py-3 rounded-lg hover:bg-gray-50 font-bold border-2 border-blue-600">Register</Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition">
            <h3 className="text-2xl font-bold mb-4 text-blue-600">💬 AI Chat Assistant</h3>
            <p className="text-gray-700">Chat with our intelligent health assistant for medical advice and information.</p>
          </div>

          <div className="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition">
            <h3 className="text-2xl font-bold mb-4 text-blue-600">🏥 Symptom Triage</h3>
            <p className="text-gray-700">Describe your symptoms and get an urgency assessment with recommended care.</p>
          </div>

          <div className="bg-white p-8 rounded-lg shadow-lg hover:shadow-xl transition">
            <h3 className="text-2xl font-bold mb-4 text-blue-600">📅 Appointments</h3>
            <p className="text-gray-700">Book, reschedule, or manage your medical appointments easily.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
