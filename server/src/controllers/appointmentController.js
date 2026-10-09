import { Appointment, User } from '../models/index.js';
import { enqueueNotification } from '../queues/index.js';
import { logger } from '../utils/logger.js';

// Who may change an appointment: admins may change any; doctors only those
// assigned to them; patients only their own. req.user comes from the verified JWT.
export const canModifyAppointment = (user, appointment) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'doctor') return appointment.doctorId?.toString() === user.userId;
  return appointment.patientId?.toString() === user.userId;
};

const MS_PER_MINUTE = 60 * 1000;
const DEFAULT_DURATION_MINUTES = 30;

// Finds a scheduled appointment of this doctor whose time window
// [dateTime, dateTime + duration) overlaps the requested one. Back-to-back
// appointments (one ends exactly when the next starts) do not overlap.
export const findDoctorConflict = async ({ doctorId, dateTime, duration, excludeId }) => {
  const start = new Date(dateTime);
  const end = new Date(start.getTime() + duration * MS_PER_MINUTE);
  const query = {
    doctorId,
    status: 'scheduled',
    dateTime: { $lt: end },
    $expr: {
      $gt: [
        {
          $add: [
            '$dateTime',
            { $multiply: [{ $ifNull: ['$duration', DEFAULT_DURATION_MINUTES] }, MS_PER_MINUTE] },
          ],
        },
        start,
      ],
    },
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Appointment.findOne(query).select('_id dateTime duration');
};

const conflictResponse = (res) =>
  res.status(409).json({ message: 'The doctor already has an appointment at that time' });

// List doctors available for booking (patients need this to create an appointment)
export const getDoctors = async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor', isActive: true }).select('name email');
    res.json({ doctors });
  } catch (error) {
    logger.error('Get doctors error:', error.message);
    res.status(500).json({ message: 'Failed to fetch doctors' });
  }
};

export const getAppointments = async (req, res) => {
  try {
    const { userId } = req.user;
    const appointments = await Appointment.find({
      $or: [{ patientId: userId }, { doctorId: userId }],
    })
      .populate('patientId', 'name email')
      .populate('doctorId', 'name email')
      .sort({ dateTime: -1 });

    res.json({ appointments });
  } catch (error) {
    logger.error('Get appointments error:', error.message);
    res.status(500).json({ message: 'Failed to fetch appointments' });
  }
};

export const createAppointment = async (req, res) => {
  try {
    const { doctorId, dateTime, reason, duration = DEFAULT_DURATION_MINUTES } = req.body;
    const { userId } = req.user;

    if (!doctorId || !dateTime || !reason) {
      return res.status(400).json({ message: 'doctorId, dateTime, and reason are required' });
    }
    if (Number.isNaN(new Date(dateTime).getTime())) {
      return res.status(400).json({ message: 'dateTime must be a valid date' });
    }

    // No double-booking: the doctor must be free for the whole slot.
    if (await findDoctorConflict({ doctorId, dateTime, duration })) {
      return conflictResponse(res);
    }

    const appointment = new Appointment({
      patientId: userId,
      doctorId,
      dateTime,
      reason,
      duration,
    });

    await appointment.save();
    await appointment.populate('patientId doctorId', 'name email');

    logger.info(`Appointment created: ${appointment._id}`);

    // Queue confirmation email now, and a reminder 24h before the appointment
    // (1h before if it is sooner than 24h away). Failures here must not
    // break the booking itself.
    try {
      const details = {
        patientName: appointment.patientId.name,
        doctorName: appointment.doctorId.name,
        dateTime: appointment.dateTime,
        reason: appointment.reason,
      };

      await enqueueNotification({
        type: 'appointment-confirmation',
        email: appointment.patientId.email,
        appointment: details,
      });

      const msUntilAppointment = new Date(appointment.dateTime).getTime() - Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const reminderDelay =
        msUntilAppointment > dayMs
          ? msUntilAppointment - dayMs
          : Math.max(msUntilAppointment - 60 * 60 * 1000, 0);

      if (msUntilAppointment > 0) {
        await enqueueNotification(
          {
            type: 'appointment-reminder',
            email: appointment.patientId.email,
            appointment: details,
          },
          { delayMs: reminderDelay }
        );
      }
    } catch (notifyError) {
      logger.error('Failed to queue appointment notifications:', notifyError.message);
    }

    res.status(201).json({
      message: 'Appointment booked successfully',
      appointment,
    });
  } catch (error) {
    logger.error('Create appointment error:', error.message);
    res.status(500).json({ message: 'Failed to create appointment' });
  }
};

export const updateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateTime, reason, status } = req.body;

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    if (!canModifyAppointment(req.user, appointment)) {
      return res.status(403).json({ message: 'You can only change your own appointments' });
    }

    if (dateTime !== undefined) {
      if (Number.isNaN(new Date(dateTime).getTime())) {
        return res.status(400).json({ message: 'dateTime must be a valid date' });
      }
      appointment.dateTime = dateTime;
    }
    if (reason !== undefined) appointment.reason = reason;
    if (status !== undefined) appointment.status = status;

    // A rescheduled (or re-activated) appointment must not overlap another
    // scheduled appointment of the same doctor. It never conflicts with itself.
    const timeOrStatusChanged = dateTime !== undefined || status !== undefined;
    if (timeOrStatusChanged && appointment.status === 'scheduled') {
      const conflict = await findDoctorConflict({
        doctorId: appointment.doctorId,
        dateTime: appointment.dateTime,
        duration: appointment.duration || DEFAULT_DURATION_MINUTES,
        excludeId: appointment._id,
      });
      if (conflict) return conflictResponse(res);
    }

    await appointment.save();

    logger.info(`Appointment updated: ${id}`);

    res.json({
      message: 'Appointment updated successfully',
      appointment,
    });
  } catch (error) {
    logger.error('Update appointment error:', error.message);
    res.status(500).json({ message: 'Failed to update appointment' });
  }
};

export const cancelAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await Appointment.findById(id);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    if (!canModifyAppointment(req.user, appointment)) {
      return res.status(403).json({ message: 'You can only cancel your own appointments' });
    }

    appointment.status = 'cancelled';
    await appointment.save();

    logger.info(`Appointment cancelled: ${id}`);

    res.json({
      message: 'Appointment cancelled successfully',
      appointment,
    });
  } catch (error) {
    logger.error('Cancel appointment error:', error.message);
    res.status(500).json({ message: 'Failed to cancel appointment' });
  }
};
