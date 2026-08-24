import { connectDB, disconnectDB } from '../src/utils/database.js';
import { User } from '../src/models/index.js';
import { logger } from '../src/utils/logger.js';

// Idempotent seed: creates starter accounts only if they don't already exist.
// Run with: npm run seed
const SEED_USERS = [
  { name: 'Dr. Asha Menon', email: 'asha.menon@medflow.local', password: 'Doctor@123', role: 'doctor' },
  { name: 'Dr. Rahul Verma', email: 'rahul.verma@medflow.local', password: 'Doctor@123', role: 'doctor' },
  { name: 'Admin User', email: 'admin@medflow.local', password: 'Admin@123', role: 'admin' },
  { name: 'Test Patient', email: 'patient@medflow.local', password: 'Patient@123', role: 'patient' },
];

const main = async () => {
  await connectDB();

  for (const userData of SEED_USERS) {
    const existing = await User.findOne({ email: userData.email });
    if (existing) {
      logger.info(`⏭️  ${userData.email} already exists (${existing.role})`);
      continue;
    }
    await User.create(userData); // password hashed by the model's pre-save hook
    logger.info(`✅ Created ${userData.role}: ${userData.email}`);
  }

  logger.info('🌱 Seed complete. Default password pattern: <Role>@123 — change in production!');
  await disconnectDB();
};

main().catch((error) => {
  logger.error('Seed failed:', error.message);
  process.exit(1);
});
