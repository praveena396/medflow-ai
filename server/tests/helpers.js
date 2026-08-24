import mongoose from 'mongoose';
import request from 'supertest';
import { connectDB } from '../src/utils/database.js';
import { redis } from '../src/config/redis.js';

// Connect to the test database and wipe it so every run starts clean.
export const setupTestDB = async () => {
  await connectDB();
  await mongoose.connection.dropDatabase();
};

// Close open connections so the test runner can exit.
export const teardownTestDB = async () => {
  await mongoose.connection.close();
  redis.disconnect();
};

let userCounter = 0;

// Register a fresh user via the real API and return their tokens + info.
export const registerUser = async (app, overrides = {}) => {
  userCounter += 1;
  const body = {
    name: `Test User ${userCounter}`,
    email: `testuser${userCounter}@medflow.test`,
    password: 'Password@123',
    role: 'patient',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) {
    throw new Error(`Test user registration failed: ${JSON.stringify(res.body)}`);
  }
  return { ...res.body, credentials: body };
};

export const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

// Create a doctor/admin directly in the database (public registration is
// patient-only by design), then log in through the real API.
export const createStaffUser = async (app, role) => {
  const { User } = await import('../src/models/index.js');
  userCounter += 1;
  const credentials = {
    name: `Test ${role} ${userCounter}`,
    email: `test${role}${userCounter}@medflow.test`,
    password: 'Password@123',
    role,
  };
  const user = await User.create(credentials);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: credentials.email, password: credentials.password });
  if (res.status !== 200) {
    throw new Error(`Staff login failed: ${JSON.stringify(res.body)}`);
  }
  return { ...res.body, userId: user._id.toString(), credentials };
};
