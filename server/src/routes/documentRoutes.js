import express from 'express';
import multer from 'multer';
import { config } from '../config/index.js';
import {
  uploadDocument,
  getDocuments,
  getDocumentStatus,
  deleteDocument,
} from '../controllers/documentController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// File arrives in memory; the storage service decides where it is persisted.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.maxFileSizeBytes },
  fileFilter: (req, file, cb) => {
    if (config.documents.allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  },
});

router.use(authenticateToken);

router.post('/', upload.single('file'), uploadDocument);
router.get('/', getDocuments);
router.get('/:id/status', getDocumentStatus);
router.delete('/:id', deleteDocument);

// Turn multer errors (file too large, bad type) into clean 400 responses.
router.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ message: err.message });
  }
  next();
});

export default router;
