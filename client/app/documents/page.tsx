'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch, apiJson, errorMessage } from '../lib/api';
import { displayFileName, downloadDocument } from '../lib/download';
import { useRequireAuth } from '../lib/useRequireAuth';

interface MedicalDocument {
  _id: string;
  fileName: string;
  documentType: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: string;
  chunkCount: number;
  summary?: string;
  uploadDate: string;
  fileSize?: number;
  extractionMethod?: 'pdf-text' | 'text' | 'ocr';
  ocrConfidence?: number;
}

const DOCUMENT_TYPES = [
  { value: 'lab-report', label: 'Lab Report' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'medical-record', label: 'Medical Record' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'other', label: 'Other' },
];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const formatSize = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DocumentsPage() {
  const user = useRequireAuth();
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('lab-report');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    if (!user) return;
    let active = true;
    apiJson<{ documents: MedicalDocument[] }>('/api/documents')
      .then((data) => active && setDocuments(data.documents))
      .catch((err) => active && setError(errorMessage(err, 'Failed to load documents')));
    return () => {
      active = false;
    };
  }, [user, reloadKey]);

  // While any document is still processing, re-check every 3 seconds.
  useEffect(() => {
    const busy = documents.some(
      (doc) => doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
    );
    if (!busy) return;
    const timer = setInterval(() => setReloadKey((key) => key + 1), 3000);
    return () => clearInterval(timer);
  }, [documents]);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setError('');
    setSuccess('');
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('documentType', documentType);

      const response = await apiFetch('/api/documents', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Upload failed');

      setSuccess('Document uploaded! Processing has started.');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: MedicalDocument) => {
    if (!window.confirm(`Delete "${displayFileName(doc.fileName)}"? This cannot be undone.`)) return;
    try {
      await apiJson(`/api/documents/${doc._id}`, { method: 'DELETE' });
      setDocuments((prev) => prev.filter((d) => d._id !== doc._id));
    } catch (err) {
      setError(errorMessage(err, 'Delete failed'));
    }
  };

  const handleDownload = async (doc: MedicalDocument) => {
    try {
      await downloadDocument(doc._id, doc.fileName);
    } catch (err) {
      setError(errorMessage(err, 'Download failed'));
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-blue-600">📄 My Documents</h1>

        {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}
        {success && <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">{success}</div>}

        {/* Upload area */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold mb-4">Upload a Medical Document</h2>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragging ? 'border-blue-600 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
            }`}
          >
            <p className="text-gray-600">
              {dragging ? 'Drop the file here' : 'Drag & drop a file here, or click to browse'}
            </p>
            <p className="text-sm text-gray-400 mt-2">
              PDF, TXT, or a PNG/JPEG photo of a lab result or prescription (read with OCR), up to 10 MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.png,.jpg,.jpeg,application/pdf,text/plain,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          {selectedFile && (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 bg-gray-50 border rounded px-4 py-2">
                <span className="font-bold">{selectedFile.name}</span>
                <span className="text-gray-500 ml-2">{formatSize(selectedFile.size)} · {selectedFile.type || 'unknown type'}</span>
              </div>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded"
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          )}
        </div>

        {/* Document list */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4">Uploaded Documents</h2>
          {documents.length === 0 ? (
            <p className="text-gray-500">No documents yet. Upload your first medical report above.</p>
          ) : (
            <ul className="divide-y">
              {documents.map((doc) => (
                <li key={doc._id} className="py-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-bold">{displayFileName(doc.fileName)}</span>
                      <span className={`text-xs px-2 py-1 rounded-full font-bold ${STATUS_STYLES[doc.processingStatus]}`}>
                        {doc.processingStatus}
                      </span>
                      <span className="text-sm text-gray-400">{formatSize(doc.fileSize)}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {doc.documentType} · uploaded {new Date(doc.uploadDate).toLocaleString()}
                      {doc.processingStatus === 'completed' && ` · ${doc.chunkCount} searchable sections`}
                      {doc.extractionMethod === 'ocr' &&
                        ` · read with OCR${doc.ocrConfidence !== undefined ? ` (${Math.round(doc.ocrConfidence)}% confidence)` : ''}`}
                    </p>
                    {doc.summary && <p className="text-sm text-gray-700 mt-2 bg-gray-50 rounded p-2">{doc.summary}</p>}
                    {doc.processingStatus === 'failed' && (
                      <p className="text-sm text-red-600 mt-1">Error: {doc.processingError}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button onClick={() => handleDownload(doc)} className="text-blue-600 hover:text-blue-800 font-bold">
                      Download
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="text-red-600 hover:text-red-800 font-bold"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
