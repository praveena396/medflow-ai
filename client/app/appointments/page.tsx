'use client';

import { useEffect, useState } from 'react';
import { ApiError, apiJson, errorMessage } from '../lib/api';
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
  doctorId?: { _id: string; name: string };
  patientId?: { _id: string; name: string };
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
  'no-show': 'bg-gray-100 text-gray-800',
};

const EMPTY_FORM = { doctorId: '', dateTime: '', reason: '', duration: 30 };

export default function AppointmentsPage() {
  const user = useRequireAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const isPatient = user?.role === 'patient';
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    if (!user) return;
    let active = true;
    apiJson<{ appointments: Appointment[] }>('/api/appointments')
      .then((data) => active && setAppointments(data.appointments || []))
      .catch((error) => console.error('Error:', error))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user, reloadKey]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    apiJson<{ doctors: Doctor[] }>('/api/appointments/doctors')
      .then((data) => active && setDoctors(data.doctors || []))
      .catch((error) => console.error('Error:', error));
    return () => {
      active = false;
    };
  }, [user]);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setConflict(false);
  };

  const handleBookAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    setConflict(false);

    try {
      await apiJson('/api/appointments', {
        method: 'POST',
        // datetime-local has no time zone; send an exact instant.
        body: JSON.stringify({
          ...form,
          dateTime: new Date(form.dateTime).toISOString(),
          duration: Number(form.duration),
        }),
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      reload();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const doctor = doctors.find((d) => d._id === form.doctorId);
        setConflict(true);
        setFormError(
          `${doctor ? doctor.name : 'This doctor'} is already booked at that time. Please choose a different time or doctor.`
        );
      } else {
        setFormError(errorMessage(error, 'Failed to book appointment'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (apt: Appointment) => {
    if (!window.confirm(`Cancel the appointment on ${new Date(apt.dateTime).toLocaleString()}?`)) return;
    try {
      await apiJson(`/api/appointments/${apt._id}`, { method: 'DELETE' });
      reload();
    } catch (error) {
      alert(errorMessage(error, 'Failed to cancel appointment'));
    }
  };

  // Doctors record the outcome; "completed" adds a visit to the health record.
  const handleOutcome = async (apt: Appointment, status: 'completed' | 'no-show') => {
    let notes: string | null = null;
    if (status === 'completed') {
      notes = window.prompt('Visit notes for the patient’s health record (optional):', '');
      if (notes === null) return; // cancelled
    }
    try {
      await apiJson(`/api/appointments/${apt._id}`, {
        method: 'PATCH',
        body: JSON.stringify(notes ? { status, notes } : { status }),
      });
      reload();
    } catch (error) {
      alert(errorMessage(error, 'Failed to update appointment'));
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-blue-600">Your Appointments</h1>
          {isPatient && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="bg-blue-600 text-white px-4 py-2 rounded font-bold hover:bg-blue-700"
            >
              {showForm ? 'Cancel' : '+ Book Appointment'}
            </button>
          )}
        </div>

        {showForm && (
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <h2 className="text-xl font-bold mb-4">Book an Appointment</h2>
            {formError && (
              <div
                role="alert"
                className={`border px-4 py-3 rounded mb-4 ${
                  conflict ? 'bg-amber-50 border-amber-400 text-amber-800' : 'bg-red-100 border-red-400 text-red-700'
                }`}
              >
                {conflict && <p className="font-bold">That time slot is taken</p>}
                <p>{formError}</p>
              </div>
            )}
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
                  <p className="text-sm text-gray-500 mt-1">No doctors yet. Run <code>npm run seed</code> in server/ to create two.</p>
                )}
              </div>
              <div>
                <label className="block text-gray-700 font-bold mb-2">Date & Time</label>
                <input
                  type="datetime-local"
                  name="dateTime"
                  value={form.dateTime}
                  onChange={handleFormChange}
                  className={`w-full px-4 py-2 border rounded ${conflict ? 'border-amber-500' : 'border-gray-300'}`}
                  required
                />
              </div>
              <div>
                <label className="block text-gray-700 font-bold mb-2">Reason</label>
                <textarea name="reason" value={form.reason} onChange={handleFormChange} maxLength={500} className="w-full px-4 py-2 border border-gray-300 rounded" required />
              </div>
              <div>
                <label className="block text-gray-700 font-bold mb-2">Duration (minutes)</label>
                <input type="number" name="duration" value={form.duration} onChange={handleFormChange} className="w-full px-4 py-2 border border-gray-300 rounded" min={5} max={480} step={5} />
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
            <p className="text-gray-600">
              No appointments yet.{' '}
              {isPatient && (
                <button onClick={() => setShowForm(true)} className="text-blue-600 hover:underline">Book one now</button>
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {appointments.map((apt) => {
              const iAmTheDoctor = apt.doctorId?._id === user.id;
              return (
                <div key={apt._id} className="bg-white p-6 rounded-lg shadow">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-xl font-bold">{apt.reason}</h3>
                      <p className="text-gray-600">📅 {new Date(apt.dateTime).toLocaleString()}</p>
                      {iAmTheDoctor ? (
                        <p className="text-gray-600">🧑 Patient: {apt.patientId?.name || 'Unknown'}</p>
                      ) : (
                        <p className="text-gray-600">👨‍⚕️ Doctor: {apt.doctorId?.name || 'TBD'}</p>
                      )}
                      <p className="text-gray-600">⏱️ Duration: {apt.duration} minutes</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-3 py-1 rounded ${STATUS_STYLES[apt.status] || STATUS_STYLES['no-show']}`}>
                        {apt.status}
                      </span>
                      {apt.status === 'scheduled' && iAmTheDoctor && (
                        <>
                          <button onClick={() => handleOutcome(apt, 'completed')} className="text-blue-600 hover:text-blue-800 text-sm font-bold">
                            Mark completed
                          </button>
                          <button onClick={() => handleOutcome(apt, 'no-show')} className="text-gray-600 hover:text-gray-800 text-sm font-bold">
                            Mark no-show
                          </button>
                        </>
                      )}
                      {apt.status === 'scheduled' && (
                        <button onClick={() => handleCancel(apt)} className="text-red-600 hover:text-red-800 text-sm font-bold">
                          Cancel appointment
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
