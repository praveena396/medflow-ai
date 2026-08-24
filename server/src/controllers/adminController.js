import mongoose from 'mongoose';
import { User, Appointment, Triage, MedicalDocument } from '../models/index.js';
import { logger } from '../utils/logger.js';

// Build a createdAt date-range filter from ?from=YYYY-MM-DD&to=YYYY-MM-DD.
const dateRange = (from, to, field = 'createdAt') => {
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999); // include the whole "to" day
    range.$lte = end;
  }
  return Object.keys(range).length > 0 ? { [field]: range } : {};
};

// GET /api/admin/stats — summary numbers for the dashboard cards.
export const getStats = async (req, res) => {
  try {
    const { from, to } = req.query;
    const triageFilter = dateRange(from, to);
    const appointmentFilter = dateRange(from, to, 'dateTime');

    const [userCounts, appointmentCounts, triageCounts, documentCount, upcomingCount] =
      await Promise.all([
        User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
        Appointment.aggregate([
          { $match: appointmentFilter },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Triage.aggregate([
          { $match: triageFilter },
          { $group: { _id: '$urgency', count: { $sum: 1 } } },
        ]),
        MedicalDocument.estimatedDocumentCount(),
        Appointment.countDocuments({ status: 'scheduled', dateTime: { $gte: new Date() } }),
      ]);

    const toObject = (rows) =>
      rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});

    res.json({
      users: toObject(userCounts),
      appointments: toObject(appointmentCounts),
      upcomingAppointments: upcomingCount,
      triageByUrgency: toObject(triageCounts),
      totalDocuments: documentCount,
      database: mongoose.connection.readyState === 1 ? 'up' : 'down',
    });
  } catch (error) {
    logger.error('Admin stats error:', error.message);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
};

// GET /api/admin/appointments — upcoming queue with patient/doctor names.
export const getAppointmentQueue = async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = {
      status: 'scheduled',
      ...(from || to ? dateRange(from, to, 'dateTime') : { dateTime: { $gte: new Date() } }),
    };

    const appointments = await Appointment.find(filter)
      .populate('patientId', 'name email')
      .populate('doctorId', 'name email')
      .sort({ dateTime: 1 })
      .limit(100);

    res.json({ appointments });
  } catch (error) {
    logger.error('Admin appointment queue error:', error.message);
    res.status(500).json({ message: 'Failed to fetch appointment queue' });
  }
};

// GET /api/admin/users?search= — user list with optional name/email search.
export const getUsers = async (req, res) => {
  try {
    const { search } = req.query;
    const filter = search
      ? {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const users = await User.find(filter)
      .select('name email role isActive createdAt')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({ users });
  } catch (error) {
    logger.error('Admin users error:', error.message);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
};

// GET /api/admin/export/appointments — CSV download for spreadsheets.
export const exportAppointments = async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = from || to ? dateRange(from, to, 'dateTime') : {};

    const appointments = await Appointment.find(filter)
      .populate('patientId', 'name email')
      .populate('doctorId', 'name email')
      .sort({ dateTime: 1 });

    // Quote CSV fields and escape embedded quotes so commas in text don't break columns.
    const csvField = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = 'Date,Time,Patient,Patient Email,Doctor,Reason,Status,Duration (min)';
    const rows = appointments.map((a) =>
      [
        csvField(new Date(a.dateTime).toLocaleDateString()),
        csvField(new Date(a.dateTime).toLocaleTimeString()),
        csvField(a.patientId?.name),
        csvField(a.patientId?.email),
        csvField(a.doctorId?.name),
        csvField(a.reason),
        csvField(a.status),
        csvField(a.duration),
      ].join(',')
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="appointments.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (error) {
    logger.error('Admin export error:', error.message);
    res.status(500).json({ message: 'Failed to export appointments' });
  }
};
