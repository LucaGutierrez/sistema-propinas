import js from '@eslint/js';
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
      '**/coverage/**',
      'apps/web/src/generated/**',
      'apps/web/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
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
