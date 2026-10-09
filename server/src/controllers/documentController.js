import { MedicalDocument } from '../models/index.js';
import {
  uploadFile,
  deleteFile,
  getFile,
  getDownloadUrl,
  originalFileName,
  contentDisposition,
} from '../services/storageService.js';
import { recordAccess } from '../services/healthRecordService.js';
import { vectorStore } from '../services/vectorStoreService.js';
import { enqueueDocumentProcessing } from '../queues/index.js';
import { logger } from '../utils/logger.js';

// POST /api/documents — receive a file, store it, queue background processing.
export const uploadDocument = async (req, res) => {
  try {
    const { userId } = req.user;
    const { documentType = 'other' } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const stored = await uploadFile(req.file);
    if (!stored.success) {
      return res.status(500).json({ message: 'Failed to store file', error: stored.error });
    }

    const document = await MedicalDocument.create({
      patientId: userId,
      uploadedBy: userId,
      documentType,
      fileName: stored.fileName,
      filePath: stored.filePath,
      fileSize: stored.size,
      mimeType: stored.mimeType,
      processingStatus: 'pending',
    });

    await enqueueDocumentProcessing(document._id.toString());

    logger.info(`📄 Document uploaded by ${userId}: ${stored.fileName}`);

    res.status(201).json({
      message: 'Document uploaded. Processing has started.',
      document: {
        id: document._id,
        fileName: stored.originalName,
        documentType: document.documentType,
        processingStatus: document.processingStatus,
        uploadDate: document.uploadDate,
      },
    });
  } catch (error) {
    logger.error('Upload document error:', error.message);
    res.status(500).json({ message: 'Failed to upload document' });
  }
};

// GET /api/documents — list the current user's documents (without bulky text).
export const getDocuments = async (req, res) => {
  try {
    const { userId } = req.user;
    const documents = await MedicalDocument.find({ patientId: userId })
      .select('-extractedText')
      .sort({ createdAt: -1 });

    res.json({ documents });
  } catch (error) {
    logger.error('Get documents error:', error.message);
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
};

// GET /api/documents/:id/status — polled by the frontend during processing.
export const getDocumentStatus = async (req, res) => {
  try {
    const { userId } = req.user;
    const document = await MedicalDocument.findOne({
      _id: req.params.id,
      patientId: userId,
    }).select('processingStatus processingError chunkCount isProcessed');

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    res.json({
      status: document.processingStatus,
      error: document.processingError,
      chunkCount: document.chunkCount,
      isProcessed: document.isProcessed,
    });
  } catch (error) {
    logger.error('Get document status error:', error.message);
    res.status(500).json({ message: 'Failed to fetch document status' });
  }
};

// DELETE /api/documents/:id — remove file, search chunks, and record.
export const deleteDocument = async (req, res) => {
  try {
    const { userId } = req.user;
    const document = await MedicalDocument.findOne({
      _id: req.params.id,
      patientId: userId,
    });

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    await deleteFile(document.fileName);
    await vectorStore.deleteDocument(document._id);
    await document.deleteOne();

    logger.info(`🗑️  Document deleted by ${userId}: ${document.fileName}`);

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    logger.error('Delete document error:', error.message);
    res.status(500).json({ message: 'Failed to delete document' });
  }
};

// The patient, their doctors and admins may open a document (the same rule
// as the health record that links it).
const findReadableDocument = async (req) => {
  const document = await MedicalDocument.findById(req.params.id);
  if (!document) return { status: 404 };
  const access = await recordAccess(req.user, document.patientId);
  return access.read ? { document } : { status: 404 }; // don't reveal that it exists
};

// GET /api/documents/:id/download — where to fetch the file from.
// S3: a pre-signed URL that expires in 15 minutes. Local storage: the
// authenticated /file route below.
export const getDocumentDownload = async (req, res) => {
  try {
    const { document, status } = await findReadableDocument(req);
    if (!document) return res.status(status).json({ message: 'Document not found' });

    const link = await getDownloadUrl(document.fileName, { contentType: document.mimeType });
    if (!link.success) return res.status(502).json({ message: 'Could not create a download link' });

    if (link.local) {
      return res.json({ mode: 'local', url: `/api/documents/${document._id}/file` });
    }
    res.json({ mode: 's3', url: link.url, expiresIn: link.expiresIn });
  } catch (error) {
    logger.error('Document download link error:', error.message);
    res.status(500).json({ message: 'Failed to create download link' });
  }
};

// GET /api/documents/:id/file — the file itself, through the API (local
// storage). With S3 it redirects to a fresh pre-signed URL instead.
export const streamDocumentFile = async (req, res) => {
  try {
    const { document, status } = await findReadableDocument(req);
    if (!document) return res.status(status).json({ message: 'Document not found' });

    const link = await getDownloadUrl(document.fileName, { contentType: document.mimeType });
    if (link.success && !link.local) return res.redirect(302, link.url);

    const file = await getFile(document.fileName);
    if (!file.success) return res.status(404).json({ message: 'File is missing from storage' });

    res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(originalFileName(document.fileName)));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.data);
  } catch (error) {
    logger.error('Document stream error:', error.message);
    res.status(500).json({ message: 'Failed to read document' });
  }
};
