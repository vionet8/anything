const { defineConfig } = require('@playwright/test');

// Run `bash <skill-dir>/scripts/find_chromium.sh` and paste its output below.
// If it printed nothing, there's no pre-installed browser gotcha in this
// environment — delete the executablePath line and run
// `npx playwright install chromium` instead.
const PRE_INSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

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
      executablePath: PRE_INSTALLED_CHROMIUM,
    },
  },
});
