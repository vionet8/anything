const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 15000,
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium',
    },
  },
});
