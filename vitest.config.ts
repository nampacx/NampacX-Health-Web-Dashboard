import { defineConfig } from 'vitest/config'

// No jsdom, no Testing Library: everything under test here is pure logic
// (data normalization, token rotation, OAuth state handling). A DOM harness
// would be more setup than the components warrant.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
