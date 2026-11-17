import { hhhConfig } from '@hhh/config/eslint';

export default hhhConfig({
  node: ['server/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts', '*.config.{js,ts}'],
  // The Python app's front end until the rebuild replaces it (phase 4).
  ignores: ['dist/**', 'coverage/**', 'static/**', 'templates/**', 'htmlcov/**'],
});
