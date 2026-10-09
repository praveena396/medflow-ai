'use client';

import { useEffect, useState } from 'react';
import { apiJson, errorMessage } from '../lib/api';
import { displayFileName, downloadDocument } from '../lib/download';
import { useRequireAuth } from '../lib/useRequireAuth';

interface Allergy {
  substance: string;
  reaction?: string;
  severity?: 'mild' | 'moderate' | 'severe' | 'unknown';
}

interface Medication {
  name: string;
  dose?: string;
  frequency?: string;
}

interface Visit {
  _id: string;
  date: string;
  doctorId?: { _id: string; name: string } | null;
  appointmentId?: string;
  reason?: string;
  diagnosis?: string;
  notes?: string;
  documentIds: string[];
}

interface RecordDocument {
  _id: string;
  fileName: string;
  documentType: string;
  uploadDate: string;
  processingStatus: string;
  summary?: string;
}

interface HealthRecord {
  id: string;
  patient: { _id: string; name?: string; email?: string; phone?: string };
  allergies: Allergy[];
  currentMedications: Medication[];
  notes?: string;
  visits: Visit[];
  documents: RecordDocument[];
  updatedAt: string;
}

interface PatientSummary {
  _id: string;
  name: string;
  email: string;
}

const SEVERITIES: NonNullable<Allergy['severity']>[] = ['unknown', 'mild', 'moderate', 'severe'];
const SEVERITY_STYLES: Record<string, string> = {
  severe: 'bg-red-100 text-red-800',
  moderate: 'bg-orange-100 text-orange-800',
  mild: 'bg-yellow-100 text-yellow-800',
  unknown: 'bg-gray-100 text-gray-700',
};

const inputClass = 'px-3 py-2 border border-gray-300 rounded w-full';

export default function RecordsPage() {
  const user = useRequireAuth();
  const isPatient = user?.role === 'patient';

  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [record, setRecord] = useState<HealthRecord | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Doctors and admins choose a patient first.
  useEffect(() => {
    if (!user || user.role === 'patient') return;
    let active = true;
    apiJson<{ patients: PatientSummary[] }>('/api/records/patients')
      .then((data) => active && setPatients(data.patients))
      .catch((err) => active && setError(errorMessage(err, 'Failed to load patients')));
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const path = user.role === 'patient' ? '/api/records/me' : selectedId ? `/api/records/${selectedId}` : null;
    if (!path) return;
    let active = true;
    apiJson<{ record: HealthRecord; canEdit?: boolean }>(path)
      .then((data) => {
        if (!active) return;
        setError('');
        setRecord(data.record);
        setCanEdit(Boolean(data.canEdit));
      })
      .catch((err) => active && setError(errorMessage(err, 'Failed to load the health record')));
    return () => {
      active = false;
    };
  }, [user, selectedId, reloadKey]);

  if (!user) return null;

  const saved = (text: string) => {
    setMessage(text);
    setReloadKey((key) => key + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-4xl font-bold text-blue-600">{isPatient ? 'My Health Record' : 'Health Records'}</h1>

        {!isPatient && (
          <div className="bg-white p-4 rounded-lg shadow">
            <label className="block text-sm text-gray-600 mb-1" htmlFor="patient">
              {user.role === 'doctor' ? 'Your patients' : 'Patient'}
            </label>
            <select
              id="patient"
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setRecord(null);
                setMessage('');
              }}
              className={inputClass}
            >
              <option value="">Select a patient…</option>
              {patients.map((p) => (
                <option key={p._id} value={p._id}>{p.name} ({p.email})</option>
              ))}
            </select>
            {user.role === 'doctor' && patients.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">Patients appear here once they book an appointment with you.</p>
            )}
          </div>
        )}

        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">{error}</div>}
        {message && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">{message}</div>}

        {record && (
          <>
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-2xl font-bold">{record.patient.name}</h2>
              <p className="text-gray-600">
                {record.patient.email}
                {record.patient.phone && ` · ${record.patient.phone}`}
              </p>
              <p className="text-xs text-gray-400 mt-1">Last updated {new Date(record.updatedAt).toLocaleString()}</p>
              {!canEdit && !isPatient && <p className="text-sm text-gray-500 mt-2">Read-only: only this patient&apos;s doctors can edit.</p>}
            </div>

            {canEdit ? (
              <RecordEditor key={`${record.id}-${record.updatedAt}`} record={record} onSaved={saved} onError={setError} />
            ) : (
              <RecordSummary record={record} />
            )}

            <VisitList record={record} onError={setError} />
            {canEdit && <AddVisitForm key={`visit-${record.id}-${record.visits.length}`} record={record} onSaved={saved} onError={setError} />}
            <DocumentList documents={record.documents} onError={setError} />
          </>
        )}
      </div>
    </div>
  );
}

function RecordSummary({ record }: { record: HealthRecord }) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <section className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-xl font-bold mb-3">Allergies</h3>
        {record.allergies.length === 0 ? (
          <p className="text-gray-500">None recorded.</p>
        ) : (
          <ul className="space-y-2">
            {record.allergies.map((a, i) => (
              <li key={i} className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">{a.substance}</span>
                {a.reaction && <span className="text-gray-600">— {a.reaction}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full ${SEVERITY_STYLES[a.severity || 'unknown']}`}>{a.severity || 'unknown'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-xl font-bold mb-3">Current medications</h3>
        {record.currentMedications.length === 0 ? (
          <p className="text-gray-500">None recorded.</p>
        ) : (
          <ul className="space-y-2">
            {record.currentMedications.map((m, i) => (
              <li key={i}>
                <span className="font-bold">{m.name}</span>
                <span className="text-gray-600"> {[m.dose, m.frequency].filter(Boolean).join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {record.notes && (
        <section className="bg-white p-6 rounded-lg shadow md:col-span-2">
          <h3 className="text-xl font-bold mb-2">Notes</h3>
          <p className="whitespace-pre-wrap text-gray-700">{record.notes}</p>
        </section>
      )}
    </div>
  );
}

function RecordEditor({
  record,
  onSaved,
  onError,
}: {
  record: HealthRecord;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [allergies, setAllergies] = useState<Allergy[]>(record.allergies);
  const [medications, setMedications] = useState<Medication[]>(record.currentMedications);
  const [notes, setNotes] = useState(record.notes || '');
  const [saving, setSaving] = useState(false);

  const updateAllergy = (index: number, patch: Partial<Allergy>) =>
    setAllergies((list) => list.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  const updateMedication = (index: number, patch: Partial<Medication>) =>
    setMedications((list) => list.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  const save = async () => {
    setSaving(true);
    try {
      await apiJson(`/api/records/${record.patient._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          allergies: allergies.filter((a) => a.substance.trim()),
          currentMedications: medications.filter((m) => m.name.trim()),
          notes,
        }),
      });
      onSaved('Health record saved.');
    } catch (err) {
      onError(errorMessage(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow space-y-6">
      <section>
        <h3 className="text-xl font-bold mb-3">Allergies</h3>
        <div className="space-y-2">
          {allergies.map((a, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input aria-label="Substance" placeholder="Substance" value={a.substance} onChange={(e) => updateAllergy(i, { substance: e.target.value })} className={`${inputClass} col-span-4`} />
              <input aria-label="Reaction" placeholder="Reaction" value={a.reaction || ''} onChange={(e) => updateAllergy(i, { reaction: e.target.value })} className={`${inputClass} col-span-4`} />
              <select aria-label="Severity" value={a.severity || 'unknown'} onChange={(e) => updateAllergy(i, { severity: e.target.value as Allergy['severity'] })} className={`${inputClass} col-span-3`}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={() => setAllergies((list) => list.filter((_, j) => j !== i))} className="col-span-1 text-red-600" aria-label="Remove allergy">✕</button>
            </div>
          ))}
        </div>
        <button onClick={() => setAllergies((list) => [...list, { substance: '', severity: 'unknown' }])} className="mt-2 text-blue-600 hover:underline text-sm">+ Add allergy</button>
      </section>

      <section>
        <h3 className="text-xl font-bold mb-3">Current medications</h3>
        <div className="space-y-2">
          {medications.map((m, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input aria-label="Medication" placeholder="Medication" value={m.name} onChange={(e) => updateMedication(i, { name: e.target.value })} className={`${inputClass} col-span-5`} />
              <input aria-label="Dose" placeholder="Dose" value={m.dose || ''} onChange={(e) => updateMedication(i, { dose: e.target.value })} className={`${inputClass} col-span-3`} />
              <input aria-label="Frequency" placeholder="Frequency" value={m.frequency || ''} onChange={(e) => updateMedication(i, { frequency: e.target.value })} className={`${inputClass} col-span-3`} />
              <button onClick={() => setMedications((list) => list.filter((_, j) => j !== i))} className="col-span-1 text-red-600" aria-label="Remove medication">✕</button>
            </div>
          ))}
        </div>
        <button onClick={() => setMedications((list) => [...list, { name: '' }])} className="mt-2 text-blue-600 hover:underline text-sm">+ Add medication</button>
      </section>

      <section>
        <h3 className="text-xl font-bold mb-3">Notes</h3>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} rows={4} className={inputClass} />
      </section>

      <button onClick={save} disabled={saving} className="bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Saving…' : 'Save record'}
      </button>
    </div>
  );
}

function VisitList({ record, onError }: { record: HealthRecord; onError: (message: string) => void }) {
  const documentName = (id: string) => record.documents.find((d) => d._id === id)?.fileName;
  return (
    <section className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-xl font-bold mb-3">Visit history</h3>
      {record.visits.length === 0 ? (
        <p className="text-gray-500">No visits yet. A visit is added when the doctor marks an appointment completed.</p>
      ) : (
        <ol className="space-y-4">
          {record.visits.map((visit) => (
            <li key={visit._id} className="border-l-4 border-blue-200 pl-4">
              <p className="font-bold">
                {new Date(visit.date).toLocaleDateString()} · {visit.reason || 'Visit'}
              </p>
              <p className="text-sm text-gray-600">
                {visit.doctorId?.name ? `with ${visit.doctorId.name}` : ''}
                {visit.appointmentId && ' · from an appointment'}
              </p>
              {visit.diagnosis && <p className="text-sm"><span className="text-gray-500">Diagnosis:</span> {visit.diagnosis}</p>}
              {visit.notes && <p className="text-sm whitespace-pre-wrap text-gray-700">{visit.notes}</p>}
              {visit.documentIds.length > 0 && (
                <p className="text-sm mt-1">
                  <span className="text-gray-500">Documents:</span>{' '}
                  {visit.documentIds.map((id) => {
                    const name = documentName(id);
                    return name ? (
                      <button
                        key={id}
                        onClick={() => downloadDocument(id, name).catch((err) => onError(errorMessage(err, 'Download failed')))}
                        className="text-blue-600 hover:underline mr-2"
                      >
                        {displayFileName(name)}
                      </button>
                    ) : null;
                  })}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AddVisitForm({
  record,
  onSaved,
  onError,
}: {
  record: HealthRecord;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({ date: '', reason: '', diagnosis: '', notes: '' });
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiJson(`/api/records/${record.patient._id}/visits`, {
        method: 'POST',
        body: JSON.stringify({
          reason: form.reason,
          ...(form.date && { date: new Date(form.date).toISOString() }),
          ...(form.diagnosis && { diagnosis: form.diagnosis }),
          ...(form.notes && { notes: form.notes }),
          documentIds,
        }),
      });
      onSaved('Visit added.');
    } catch (err) {
      onError(errorMessage(err, 'Failed to add the visit'));
    } finally {
      setSaving(false);
    }
  };

  const toggleDocument = (id: string) =>
    setDocumentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <form onSubmit={submit} className="bg-white p-6 rounded-lg shadow space-y-3">
      <h3 className="text-xl font-bold">Add a visit</h3>
      <div className="grid md:grid-cols-2 gap-3">
        <input required maxLength={500} placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputClass} />
        <input type="date" aria-label="Visit date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
      </div>
      <input maxLength={500} placeholder="Diagnosis (optional)" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} className={inputClass} />
      <textarea maxLength={4000} rows={3} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} />
      {record.documents.length > 0 && (
        <fieldset>
          <legend className="text-sm text-gray-600 mb-1">Link documents</legend>
          <div className="flex flex-wrap gap-3">
            {record.documents.map((doc) => (
              <label key={doc._id} className="text-sm flex items-center gap-1">
                <input type="checkbox" checked={documentIds.includes(doc._id)} onChange={() => toggleDocument(doc._id)} />
                {displayFileName(doc.fileName)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <button type="submit" disabled={saving} className="bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Adding…' : 'Add visit'}
      </button>
    </form>
  );
}

function DocumentList({ documents, onError }: { documents: RecordDocument[]; onError: (message: string) => void }) {
  return (
    <section className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-xl font-bold mb-3">Documents</h3>
      {documents.length === 0 ? (
        <p className="text-gray-500">No documents uploaded.</p>
      ) : (
        <ul className="divide-y">
          {documents.map((doc) => (
            <li key={doc._id} className="py-3 flex items-start justify-between gap-4">
              <div>
                <p className="font-bold">{displayFileName(doc.fileName)}</p>
                <p className="text-sm text-gray-500">
                  {doc.documentType} · {new Date(doc.uploadDate).toLocaleDateString()} · {doc.processingStatus}
                </p>
                {doc.summary && <p className="text-sm text-gray-700 mt-1">{doc.summary}</p>}
              </div>
              <button
                onClick={() => downloadDocument(doc._id, doc.fileName).catch((err) => onError(errorMessage(err, 'Download failed')))}
                className="text-blue-600 hover:text-blue-800 font-bold"
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
