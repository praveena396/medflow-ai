import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Picks the MongoDB for the API tests (see the file for the order).
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/setup.js'],
    // Test files share the medflow-test database — run them one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
