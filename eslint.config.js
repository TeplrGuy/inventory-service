module.exports = [{
  files: ['src/**/*.js', 'tests/**/*.js'],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
    globals: {
      console: 'readonly',
      fetch: 'readonly',
      process: 'readonly',
      structuredClone: 'readonly',
      setTimeout: 'readonly'
    }
  },
  rules: {
    eqeqeq: 'error',
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-unused-vars': ['error', { args: 'none' }]
  }
}];
