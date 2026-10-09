import { describe, it, expect } from 'vitest';
import { appointmentReminderSms } from '../../src/services/notificationService.js';

describe('appointmentReminderSms', () => {
  it('names the doctor and the time, and stays within one SMS segment', () => {
    const text = appointmentReminderSms({
      doctorName: 'Dr. Asha Menon',
      dateTime: '2026-10-20T14:30:00Z',
    });
    expect(text).toContain('Dr. Asha Menon');
    expect(text).toContain(new Date('2026-10-20T14:30:00Z').toLocaleString());
    expect(text.length).toBeLessThanOrEqual(160);
  });
});
