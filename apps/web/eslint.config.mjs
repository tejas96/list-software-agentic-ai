import reactHooks from 'eslint-plugin-react-hooks';
import base from '@lsa/config/eslint';

export default [
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
