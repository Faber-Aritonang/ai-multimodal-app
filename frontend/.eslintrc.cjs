module.exports = {
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true
    }
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime'
  ],
  plugins: ['react'],
  rules: {
    // Komponen memakai propTypes opsional di proyek ini
    'react/prop-types': 'off',
    // Vite + React 18: tidak perlu import React di setiap file JSX
    'react/react-in-jsx-scope': 'off',
    'no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }
    ],
    'no-console': 'off'
  },
  overrides: [
    {
      files: ['vite.config.js', 'tailwind.config.js'],
      env: {
        node: true
      }
    }
  ],
  ignorePatterns: ['dist/', 'node_modules/']
};
