// Minimal security-focused ESLint config.
// Intentionally narrow: only security + a few high-signal correctness rules.
// Style / formatting is NOT enforced here — tsc handles type safety.
// Run with: npm run lint:security
import security from 'eslint-plugin-security';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'android/**',
      'old files/**',
      'supabase/functions/**/_shared/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    rules: {
      // Disable noisy style/typing rules — we only want security signal here.
      ...(c.rules ?? {}),
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-misleading-character-class': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  })),
  {
    // Silence pre-existing inline `eslint-disable` comments that reference
    // rules (e.g. react-hooks/*) which this security-focused config doesn't
    // load. Those comments are legitimate hints for a future full ESLint
    // setup; they should not produce "rule not found" noise here.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // Inline `// eslint-disable-next-line react-hooks/exhaustive-deps`
      // would otherwise crash this run. Register the rule namespace as a
      // silent no-op via processor plugins is overkill — just rely on
      // ESLint's default behaviour, which is to error on unknown rules
      // referenced in inline comments. We override by NOT loading react
      // hooks plugin and accepting that those comments are dormant.
    },
  },
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: { security, 'react-hooks': reactHooks },
    rules: {
      // react-hooks plugin loaded only so pre-existing inline
      // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments
      // resolve. The rule itself is off — this is a security-only lint pass.
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off',
      // Security plugin — only the high-signal rules, no noisy ones.
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'warn',
      'security/detect-child-process': 'warn',
      'security/detect-unsafe-regex': 'warn',
      'security/detect-buffer-noassert': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      // Built-in correctness rules with security implications.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
];
