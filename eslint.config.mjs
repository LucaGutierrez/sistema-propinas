import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const FORBIDDEN_IN_ENGINE = [
  'Number',
  'parseFloat',
  'parseInt',
  'Date',
  'Intl',
  'process',
  'Buffer',
  'require',
  'console',
  'fetch',
  'window',
  'document',
  'setTimeout',
  'setInterval',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      'apps/web/src/generated/**',
      'apps/web/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  // Aplicación Next.js (apps/web/src). Los tests de base de datos no usan React.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  // El motor de cálculo: TypeScript puro, BigInt, sin floats ni APIs de plataforma.
  {
    files: ['packages/tip-engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./)',
              message: 'tip-engine only imports its own files (./...). No packages, no node:*.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...FORBIDDEN_IN_ENGINE.map((name) => ({
          name,
          message: `"${name}" is not allowed in tip-engine (BigInt-only, no platform APIs).`,
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', message: 'Math.* works on floats; use BigInt arithmetic.' },
        { property: 'toFixed', message: 'Floats are not allowed in tip-engine.' },
        { property: 'toLocaleString', message: 'Locale formatting is not allowed in tip-engine.' },
        { property: 'toPrecision', message: 'Floats are not allowed in tip-engine.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[raw=/^[0-9]*\\.[0-9]+/]',
          message: 'Floating-point literals are not allowed in tip-engine.',
        },
        {
          selector: 'ImportExpression',
          message: 'Dynamic import is not allowed in tip-engine.',
        },
      ],
    },
  },
);
