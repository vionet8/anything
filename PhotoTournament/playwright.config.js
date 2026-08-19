const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 20000,
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://localhost:4174',
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium',
    },
  },
});
