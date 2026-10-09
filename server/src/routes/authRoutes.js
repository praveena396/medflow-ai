import express from 'express';
import { register, login, refreshToken, logout } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateRegister, validateLogin } from '../validators/authValidators.js';

const router = express.Router();

// Public routes
router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.post('/refresh', refreshToken);
router.post('/logout', logout);

// Protected route (example)
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    message: 'Current user info',
    user: req.user,
  });
});

export default router;
