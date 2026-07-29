import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'node_modules/', '*.cjs', 'scripts/'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler memoization hints are not actionable
      'react-refresh/only-export-components': 'off',
      'react-hooks/preserve-manual-memoization': 'off',

      // match existing code style
      semi: ['error', 'never'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'no-trailing-spaces': 'error',

      // Zustand immer-style produce() bodies are intentionally empty; downgrade to warn
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // valid async-function-in-effect pattern: useEffect(() => { void load() }, [...])
      'react-hooks/set-state-in-effect': 'off',

      // no-useless-assignment fires on Zustand draft mutations — disable
      'no-useless-assignment': 'off',

      // preserve-caught-error requires { cause: e } on every rethrow — too pedantic
      'preserve-caught-error': 'off',

      // TypeScript-specific
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // @ts-ignore is occasionally needed in test files
      '@typescript-eslint/ban-ts-comment': ['warn', { minimumDescriptionLength: 3 }],

      // allow void-returning event handlers like onClick={() => { void fn() }}
      'no-void': 'off'
    }
  }
)
