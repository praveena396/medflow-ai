'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { useRequireAuth } from '../lib/useRequireAuth';

interface Doctor {
  _id: string;
  name: string;
  email: string;
}

interface Appointment {
  _id: string;
  reason: string;
  dateTime: string;
  duration: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no-show';
  doctorId?: { name: string };
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
  'no-show': 'bg-gray-100 text-gray-800',
};

export default function AppointmentsPage() {
  const user = useRequireAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ doctorId: '', dateTime: '', reason: '', duration: 30 });

  const fetchAppointments = useCallback(async () => {
    try {
      const data = await apiJson<{ appointments: Appointment[] }>('/api/appointments');
      setAppointments(data.appointments || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchAppointments();
    apiJson<{ doctors: Doctor[] }>('/api/appointments/doctors')
      .then((data) => setDoctors(data.doctors || []))
      .catch((error) => console.error('Error:', error));
  }, [user, fetchAppointments]);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleBookAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');

    try {
      await apiJson('/api/appointments', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false);
      setForm({ doctorId: '', dateTime: '', reason: '', duration: 30 });
      await fetchAppointments();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to book appointment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (apt: Appointment) => {
    if (!window.confirm(`Cancel your appointment on ${new Date(apt.dateTime).toLocaleString()}?`)) return;
    try {
      await apiJson(`/api/appointments/${apt._id}`, { method: 'DELETE' });
      await fetchAppointments();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to cancel appointment');
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-blue-600">Your Appointments</h1>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded font-bold hover:bg-blue-700"
          >
            {showForm ? 'Cancel' : '+ Book Appointment'}
          </button>
        </div>

        {showForm && (
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <h2 className="text-xl font-bold mb-4">Book an Appointment</h2>
            {formError && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{formError}</div>}
            <form onSubmit={handleBookAppointment} className="space-y-4">
              <div>
                <label className="block text-gray-700 font-bold mb-2">Doctor</label>
                <select name="doctorId" value={form.doctorId} onChange={handleFormChange} className="w-full px-4 py-2 border border-gray-300 rounded" required>
                  <option value="">Select a doctor</option>
                  {doctors.map((doc) => (
                    <option key={doc._id} value={doc._id}>{doc.name} ({doc.email})</option>
                  ))}
                </select>
                {doctors.length === 0 && (
                  <p className="text-sm text-gray-500 mt-1">No doctors found yet — register a user with role "doctor" to book against.</p>
                )}
              </div>
              <div>
                <label className="block text-gray-700 font-bold mb-2">Date & Time</label>
                <input type="datetime-local" name="dateTime" value={form.dateTime} onChange={handleFormChange} className="w-full px-4 py-2 border border-gray-300 rounded" required />
              </div>
              <div>
                <label className="block text-gray-700 font-bold mb-2">Reason</label>
                <textarea name="reason" value={form.reason} onChange={handleFormChange} className="w-full px-4 py-2 border border-gray-300 rounded" required />
              </div>
              <div>
                <label className="block text-gray-700 font-bold mb-2">Duration (minutes)</label>
                <input type="number" name="duration" value={form.duration} onChange={handleFormChange} className="w-full px-4 py-2 border border-gray-300 rounded" min={10} step={5} />
              </div>
              <button type="submit" disabled={submitting} className="w-full bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700">
                {submitting ? 'Booking...' : 'Book Appointment'}
              </button>
            </form>
          </div>
        )}

        {loading ? (
          <p className="text-gray-600">Loading appointments...</p>
        ) : appointments.length === 0 ? (
          <div className="bg-white p-6 rounded-lg shadow">
            <p className="text-gray-600">No appointments yet. <button onClick={() => setShowForm(true)} className="text-blue-600 hover:underline">Book one now</button></p>
          </div>
        ) : (
          <div className="space-y-4">
            {appointments.map((apt) => (
              <div key={apt._id} className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold">{apt.reason}</h3>
                    <p className="text-gray-600">📅 {new Date(apt.dateTime).toLocaleString()}</p>
                    <p className="text-gray-600">👨‍⚕️ Doctor: {apt.doctorId?.name || 'TBD'}</p>
                    <p className="text-gray-600">⏱️ Duration: {apt.duration} minutes</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`px-3 py-1 rounded ${STATUS_STYLES[apt.status] || STATUS_STYLES['no-show']}`}>
                      {apt.status}
                    </span>
                    {apt.status === 'scheduled' && (
                      <button
                        onClick={() => handleCancel(apt)}
                        className="text-red-600 hover:text-red-800 text-sm font-bold"
                      >
                        Cancel appointment
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
