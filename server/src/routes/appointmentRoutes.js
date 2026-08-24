import express from 'express';
import {
  getAppointments,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  getDoctors,
} from '../controllers/appointmentController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Must come before '/:id' routes so 'doctors' isn't parsed as an id
router.get('/doctors', getDoctors);

router.get('/', getAppointments);
router.post('/', createAppointment);
router.patch('/:id', updateAppointment);
router.delete('/:id', cancelAppointment);

export default router;
