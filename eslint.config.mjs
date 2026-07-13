import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Single flat config for every TypeScript workspace in the monorepo.
 *
 * `projectService: true` lets typescript-eslint locate the nearest tsconfig.json
 * for each linted file on its own, so this one config works whether ESLint is
 * invoked from the repo root (lint-staged, CI) or from inside a workspace.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/mobile/**',
      '**/*.config.mjs',
      '**/*.config.js',
      '**/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // NestJS leans on decorator metadata and constructor param injection; a few
  // type-aware rules fight that idiom rather than catching real bugs.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },

  // The domain layer must stay framework-free: it is the one place where a stray
  // import of Nest/Prisma silently turns Clean Architecture into a big ball of mud.
  {
    files: ['apps/api/src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'prisma', 'ioredis', 'bullmq', 'express'],
              message:
                'The domain layer must not depend on frameworks or infrastructure. Depend on interfaces defined in domain/ and implement them in infrastructure/.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['apps/admin/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  prettier,
);
