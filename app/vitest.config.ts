import { defineConfig } from 'vitest/config';

// Keep QA serialized on the user's working computer, including direct Vitest runs.
export default defineConfig({
  test: {
    // Evidence contains historical source snapshots, not executable test suites.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/codex-terminal-probe-bridge.test.mjs', 'scripts/installer-build.test.mjs', 'scripts/installer-update-recovery.test.mjs', 'scripts/legacy-workspace-fixtures.test.ts', 'scripts/vitest-temp.test.mjs'],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
