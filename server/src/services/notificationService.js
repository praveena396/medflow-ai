import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let transporterPromise = null;

// Lazily build the mail transporter once and reuse it.
const getTransporter = () => {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      if (config.notifications.emailDriver === 'smtp') {
        return nodemailer.createTransport({
          host: config.notifications.smtp.host,
          port: config.notifications.smtp.port,
          secure: config.notifications.smtp.port === 465,
          auth: {
            user: config.notifications.smtp.user,
            pass: config.notifications.smtp.pass,
          },
        });
      }

      // Ethereal: free auto-generated test inbox. Real SMTP delivery,
      // viewable in the browser via the preview URL logged per email.
      const testAccount = await nodemailer.createTestAccount();
      logger.info(`📧 Ethereal test inbox created: ${testAccount.user}`);
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
    })();
  }
  return transporterPromise;
};

export const sendEmail = async (email, subject, html) => {
  try {
    if (config.notifications.emailDriver === 'mock') {
      logger.info(`📧 [MOCK EMAIL] To: ${email} | Subject: ${subject}`);
      return { success: true, messageId: `mock_email_${Date.now()}`, provider: 'mock' };
    }

    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: config.notifications.smtp.from,
      to: email,
      subject,
      html,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      logger.info(`📧 Email sent to ${email} — preview: ${previewUrl}`);
    } else {
      logger.info(`📧 Email sent to ${email} (${info.messageId})`);
    }

    return {
      success: true,
      messageId: info.messageId,
      previewUrl: previewUrl || undefined,
      provider: config.notifications.emailDriver,
    };
  } catch (error) {
    logger.error('Email send error:', error.message);
    return { success: false, error: error.message };
  }
};

export const sendSMS = async (phoneNumber, message) => {
  try {
    if (config.notifications.smsDriver === 'twilio') {
      // Imported lazily so the app runs without the twilio package configured.
      const { default: twilio } = await import('twilio');
      const client = twilio(
        config.notifications.twilio.accountSid,
        config.notifications.twilio.authToken
      );
      const result = await client.messages.create({
        body: message,
        from: config.notifications.twilio.phone,
        to: phoneNumber,
      });
      logger.info(`📱 SMS sent to ${phoneNumber} (${result.sid})`);
      return { success: true, messageId: result.sid, provider: 'twilio' };
    }

    logger.info(`📱 [MOCK SMS] To: ${phoneNumber} | ${message}`);
    return { success: true, messageId: `mock_sms_${Date.now()}`, provider: 'mock' };
  } catch (error) {
    logger.error('SMS send error:', error.message);
    return { success: false, error: error.message };
  }
};

// Short enough for a single SMS segment (160 characters) with typical names.
export const appointmentReminderSms = ({ doctorName, dateTime }) =>
  `MedFlow reminder: your appointment with ${doctorName} is on ` +
  `${new Date(dateTime).toLocaleString()}. Please arrive 10 minutes early.`;

const appointmentEmailBody = (heading, intro, details) => `
  <h2>${heading}</h2>
  <p>Dear ${details.patientName},</p>
  <p>${intro}</p>
  <ul>
    <li><strong>Date & Time:</strong> ${new Date(details.dateTime).toLocaleString()}</li>
    <li><strong>Doctor:</strong> ${details.doctorName}</li>
    <li><strong>Reason:</strong> ${details.reason}</li>
  </ul>
  <p>Please arrive 10 minutes early.</p>
`;

export const sendAppointmentReminder = async (userEmail, appointmentDetails) =>
  sendEmail(
    userEmail,
    '📅 Appointment Reminder',
    appointmentEmailBody(
      'Your Appointment Reminder',
      'This is a reminder for your upcoming appointment:',
      appointmentDetails
    )
  );

export const sendAppointmentConfirmation = async (userEmail, appointmentDetails) =>
  sendEmail(
    userEmail,
    '✅ Appointment Confirmed',
    appointmentEmailBody(
      'Appointment Confirmed',
      'Your appointment has been successfully booked!',
      appointmentDetails
    )
  );
