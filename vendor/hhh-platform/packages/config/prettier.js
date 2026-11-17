// Shared Prettier settings: the style PhotoMapper already used, so adopting it
// reformats nothing there. Apps re-export this from their own prettier.config.js.
export default {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'es5',
  printWidth: 100,
};
