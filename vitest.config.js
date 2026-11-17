import { defineConfig, mergeConfig } from 'vitest/config';
import { hhhVitest } from '@hhh/config/vitest';

// The standard's 80% line-coverage gate (from @hhh/config), over the TypeScript rebuild.
export default mergeConfig(
  hhhVitest({
    include: ['tests/**/*.test.{ts,tsx}'],
    coverageInclude: ['server/**/*.ts', 'shared/**/*.ts'],
  }),
  defineConfig({})
);
