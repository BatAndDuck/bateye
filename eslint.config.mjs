// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: ['.claude/**', 'dist/**', 'node_modules/**', 'coverage/**', 'report/**'],
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        console: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: repoRoot,
      },
    },
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
