// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// ESLint flat config — TypeScript strict, 타입 정보 없이(빠르고 CI 친화적) 검사한다.
export default tseslint.config(
  {
    // 빌드 산출물·의존성·픽스처는 린트 대상에서 제외한다.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/scripts/**',
      'fixtures/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
