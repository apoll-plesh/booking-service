// eslint.config.js
// Минимальная конфигурация ESLint для серверной части (Node.js).
// Браузерный код (public/) не проверяется этим линтером.

const js = require('@eslint/js');

module.exports = [
  // Глобальный ignore — идёт ПЕРВЫМ объектом
  {
    ignores: [
      'node_modules/**',
      'public/**',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      // Express требует 4 аргумента в обработчике ошибок, даже если next не используется
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];