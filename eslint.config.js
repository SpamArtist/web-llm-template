import eslint from '@eslint/js';
import css from '@eslint/css';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import cssMaxLines from './scripts/css-max-lines-rule.js';
import noInlineTypes from './scripts/no-inline-types-rule.js';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '**/.local/**', '**/.artifacts/**', '**/.scratch/**', 'prototype/**', 'drizzle/**', 'test-results/**'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['src/**/*.{js,mjs,cjs,ts,tsx,mts,cts}', 'meta/spec-planning/{db,shared,use-cases}/**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    rules: {
      'max-lines': ['error', 350],
    },
  },
  {
    files: ['{src,tests}/**/*.{ts,tsx}', 'meta/spec-planning/{db,shared,use-cases,tests}/**/*.{ts,tsx}'],
    plugins: { local: { rules: { 'no-inline-types': noInlineTypes } } },
    rules: { 'local/no-inline-types': 'error' },
  },
  {
    files: ['src/server/http/**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'drizzle-orm', message: 'Call a use case; keep queries in src/db/.' },
          { name: 'pg', message: 'Call a use case; keep DB access in src/db/.' },
        ],
        patterns: [
          { group: ['drizzle-orm/*', 'pg/*'], message: 'Call a use case; keep DB access in src/db/.' },
          { regex: '(?:^|[/@])db(?:/|$)', message: 'HTTP adapters must call use cases, not import src/db/.' },
        ],
      }],
    },
  },
  {
    files: ['src/server/use-cases/**/*.{js,mjs,cjs,ts,tsx,mts,cts}', 'meta/spec-planning/use-cases/**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'drizzle-orm', message: 'Call a persistence function in src/db/.' },
          { name: 'pg', message: 'Call a persistence function in src/db/.' },
        ],
        patterns: [
          { group: ['drizzle-orm/*', 'pg/*'], message: 'Call a persistence function in src/db/.' },
          { regex: '(?:^|[/@])db/schema(?:\\.[^/]+|/.*)?$', message: 'Use cases must call persistence functions, not import table schemas.' },
        ],
      }],
    },
  },
  {
    files: ['src/**/*.css'],
    language: 'css/css',
    plugins: { css, local: { rules: { 'css-max-lines': cssMaxLines } } },
    rules: {
      'local/css-max-lines': ['error', 350],
    },
  },
);
