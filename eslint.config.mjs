// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.js'],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // Catch real bugs
      'no-console': 'off',
      'no-constant-condition': 'error',
      'no-unreachable': 'error',
      'no-duplicate-case': 'error',
      'no-loss-of-precision': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',

      // TypeScript-specific
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'off', // too noisy without tsconfig integration
      '@typescript-eslint/no-require-imports': 'error',

      // Turn off stylistic rules
      '@typescript-eslint/no-inferrable-types': 'off',
    },
  },
);
