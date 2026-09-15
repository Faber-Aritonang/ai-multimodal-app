/**
 * Jest configuration (backend)
 * Unit test dijalankan tanpa koneksi MongoDB maupun Firebase.
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: [
    'controllers/**/*.js',
    'middleware/**/*.js',
    'config/**/*.js',
    'models/**/*.js'
  ]
};
