// Shared Vitest settings: the standard's 80% line-coverage gate, v8 coverage, node
// environment by default (component tests opt into jsdom with a docblock).
//
//   import { defineConfig, mergeConfig } from 'vitest/config';
//   import { hhhVitest } from '@hhh/config/vitest';
//   export default mergeConfig(hhhVitest({ coverageInclude: ['server/**/*.ts'] }), defineConfig({}));
import { defineConfig } from 'vitest/config';

export interface HhhVitestOptions {
  /** Source files counted for coverage (globs). */
  coverageInclude: string[];
  /** Test files (globs). */
  include?: string[];
}

export const COVERAGE_LINES = 80;

export function hhhVitest(options: HhhVitestOptions) {
  return defineConfig({
    test: {
      environment: 'node',
      include: options.include ?? ['tests/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: options.coverageInclude,
        thresholds: { lines: COVERAGE_LINES },
      },
    },
  });
}
