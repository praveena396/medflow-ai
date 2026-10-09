import express from 'express';
import { submitSymptoms, getTriageHistory } from '../controllers/triageController.js';
import { authenticateToken } from '../middleware/auth.js';
import { triageLimiter } from '../middleware/rateLimiter.js';
import { validateTriage } from '../validators/aiValidators.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);
// 20 requests a minute per user by default (AI_RATE_LIMIT_MAX).
router.use(triageLimiter);

router.post('/', validateTriage, submitSymptoms);
router.get('/history', getTriageHistory);

export default router;
