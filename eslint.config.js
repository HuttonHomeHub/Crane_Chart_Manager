import { hhhConfig } from '@hhh/config/eslint';

export default hhhConfig({
  browser: ['src/**/*.{ts,tsx}', 'tests/**/*.tsx'],
  // The React rules (hooks included) cover hooks in .ts files too.
  react: ['src/**/*.{ts,tsx}', 'tests/**/*.tsx'],
  node: ['server/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts', 'e2e/**/*.ts', '*.config.{js,ts}'],
  ignores: ['dist/**', 'coverage/**', 'e2e-results/**'],
});
