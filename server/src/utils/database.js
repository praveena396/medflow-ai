import mongoose from 'mongoose';
import { logger } from './logger.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/medflow';

export const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info(`MongoDB connected: ${MONGO_URI}`);
  } catch (error) {
    logger.error('MongoDB connection error:', error.message);
    throw error;
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch (error) {
    logger.error('MongoDB disconnection error:', error.message);
    throw error;
  }
};
