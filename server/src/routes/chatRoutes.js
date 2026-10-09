import express from 'express';
import { sendMessage, getChatHistory, clearChatHistory } from '../controllers/chatController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateChatMessage } from '../validators/aiValidators.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

router.post('/', validateChatMessage, sendMessage);
router.get('/history', getChatHistory);
router.delete('/history', clearChatHistory);

export default router;
