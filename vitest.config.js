import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';
import { hhhVitest } from '@hhh/config/vitest';

// The standard's 80% line-coverage gate (from @hhh/config), over the TypeScript rebuild.
export default mergeConfig(
  hhhVitest({
    include: ['tests/**/*.test.{ts,tsx}'],
    coverageInclude: ['server/**/*.ts', 'shared/**/*.ts', 'src/**/*.{ts,tsx}'],
  }),
  defineConfig({
    // React plugin so component tests can render JSX. Server and logic tests run in
    // Node; component tests opt into jsdom with a `// @vitest-environment jsdom` docblock.
    plugins: [react()],
    test: { coverage: { exclude: ['src/main.tsx'] } },
  })
);
