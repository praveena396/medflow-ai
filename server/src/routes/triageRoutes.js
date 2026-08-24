import express from 'express';
import { submitSymptoms, getTriageHistory } from '../controllers/triageController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

router.post('/', submitSymptoms);
router.get('/history', getTriageHistory);

export default router;
