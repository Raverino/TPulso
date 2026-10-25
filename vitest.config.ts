import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so unit tests run in plain Node, without the Workers runtime.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['worker/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
