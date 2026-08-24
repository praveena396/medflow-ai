import express from 'express';
import { register, login, refreshToken } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);

// Protected route (example)
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    message: 'Current user info',
    user: req.user,
  });
});

export default router;
