import express from 'express';
import {
  getStats,
  getAppointmentQueue,
  getUsers,
  exportAppointments,
  updateUser,
  getAuditLog,
} from '../controllers/adminController.js';
import { validateUpdateUser, validateAuditQuery } from '../validators/adminValidators.js';
import { authenticateToken, authorize } from '../middleware/auth.js';

const router = express.Router();

// Every admin route requires a valid login AND the admin role.
router.use(authenticateToken, authorize('admin'));

router.get('/stats', getStats);
router.get('/appointments', getAppointmentQueue);
router.get('/users', getUsers);
router.patch('/users/:id', validateUpdateUser, updateUser);
router.get('/export/appointments', exportAppointments);
router.get('/audit', validateAuditQuery, getAuditLog);

export default router;
