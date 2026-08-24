import express from 'express';
import {
  getStats,
  getAppointmentQueue,
  getUsers,
  exportAppointments,
} from '../controllers/adminController.js';
import { authenticateToken, authorize } from '../middleware/auth.js';

const router = express.Router();

// Every admin route requires a valid login AND the admin role.
router.use(authenticateToken, authorize('admin'));

router.get('/stats', getStats);
router.get('/appointments', getAppointmentQueue);
router.get('/users', getUsers);
router.get('/export/appointments', exportAppointments);

export default router;
