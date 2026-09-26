// @ts-check

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // A config object with ONLY `ignores` (plus `name`) is what ESLint's flat
    // config treats as a GLOBAL ignore. Combining `ignores` with any other
    // key (as this used to do with `linterOptions`) turns it into a
    // per-config `files` restriction instead, so dist/ was still being
    // linted with zero rules enabled — enough for a stray comment in
    // compiled output to trip `reportUnusedDisableDirectives` below.
    name: 'kit/ignore-build-output',
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    name: 'kit/linter-controls',
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    name: 'kit/typescript',
    files: ['src/**/*.ts', 'test/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    name: 'kit/async-test-doubles',
    files: ['src/**/*.test.ts', 'test/**/*.ts'],
    rules: {
      // In-memory doubles implement async interfaces on purpose.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    name: 'kit/node-esm-scripts',
    files: ['scripts/**/*.mjs', 'examples/**/*.mjs', 'eslint.config.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.nodeBuiltin,
    },
  },
);
