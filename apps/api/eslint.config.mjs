import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', '*.mjs'] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // NestJS usa classes com decorators e injeção por construtor.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
);
