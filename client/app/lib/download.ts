'use client';

import { apiFetch, apiJson } from './api';

// Stored names are "<timestamp>_<original name>"; show and save the original.
export const displayFileName = (fileName: string) => fileName.replace(/^\d+_/, '');

// Opens or saves a document. With S3 the API returns a pre-signed URL that
// expires in 15 minutes; with local storage the file comes through the
// authenticated API route, so it is fetched with the access token.
export const downloadDocument = async (documentId: string, fileName: string) => {
  const link = await apiJson<{ mode: 's3' | 'local'; url: string }>(`/api/documents/${documentId}/download`);
  if (link.mode === 's3') {
    window.open(link.url, '_blank', 'noopener,noreferrer');
    return;
  }
  const response = await apiFetch(link.url);
  if (!response.ok) throw new Error('Download failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = displayFileName(fileName);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
