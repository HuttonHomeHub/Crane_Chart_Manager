import { hhhConfig } from '@hhh/config/eslint';

export default hhhConfig({
  browser: ['src/**/*.{ts,tsx}', 'tests/**/*.tsx'],
  // The React rules (hooks included) cover hooks in .ts files too.
  react: ['src/**/*.{ts,tsx}', 'tests/**/*.tsx'],
  node: ['server/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts', '*.config.{js,ts}'],
  // The Python app's front end until the rebuild replaces it (phase 4).
  ignores: ['dist/**', 'coverage/**', 'static/**', 'templates/**', 'htmlcov/**'],
});
