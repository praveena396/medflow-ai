// Runs once before all test files. Decides which MongoDB the API tests use:
//
// 1. MONGO_URI is set (CI, or your own server): use it.
// 2. Otherwise start a throwaway in-memory MongoDB with mongodb-memory-server
//    (it downloads a mongod binary on first use and caches it).
// 3. If that can't start (e.g. offline), fall back to the old default,
//    mongodb://localhost:27017/medflow-test.
//
// The tests drop the database they connect to, so the database name must
// contain "test"; anything else is refused.
const LOCAL_FALLBACK_URI = 'mongodb://localhost:27017/medflow-test';

const databaseName = (uri) => new URL(uri).pathname.replace(/^\//, '');

export default async function setup(project) {
  let uri = process.env.MONGO_URI;
  let memoryServer;

  if (!uri) {
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri('medflow-test');
      console.log(`[tests] Using in-memory MongoDB at ${uri}`);
    } catch (error) {
      uri = LOCAL_FALLBACK_URI;
      console.warn(
        `[tests] Could not start an in-memory MongoDB (${error.message}). ` +
          `Falling back to ${uri}; start one with: docker compose up -d mongo`
      );
    }
  }

  if (!/test/i.test(databaseName(uri))) {
    throw new Error(
      `Refusing to run tests against "${databaseName(uri)}": the tests drop their database, ` +
        'so MONGO_URI must name a database containing "test" (e.g. .../medflow-test).'
    );
  }

  project.provide('mongoUri', uri);

  return async () => {
    if (memoryServer) await memoryServer.stop();
  };
}
