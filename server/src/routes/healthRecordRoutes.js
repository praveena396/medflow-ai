import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getMyRecord,
  listPatients,
  getRecord,
  updateRecord,
  addVisit,
} from '../controllers/healthRecordController.js';
import {
  validatePatientId,
  validateUpdateRecord,
  validateAddVisit,
} from '../validators/healthRecordValidators.js';

const router = express.Router();

router.use(authenticateToken);

// Static paths first so 'me' and 'patients' aren't read as ids.
router.get('/me', getMyRecord);
router.get('/patients', listPatients);
router.get('/:patientId', validatePatientId, getRecord);
router.patch('/:patientId', validateUpdateRecord, updateRecord);
router.post('/:patientId/visits', validateAddVisit, addVisit);

export default router;
