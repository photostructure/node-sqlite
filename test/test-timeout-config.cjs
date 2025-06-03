// @ts-check

const fs = require("node:fs");
const { arch, platform } = require("node:process");

/**
 * Get appropriate test timeout for the current environment.
 * 
 * Timeouts are adjusted based on:
 * - CI vs local development
 * - Operating system (Windows is slow with process forking)
 * - Architecture (ARM64 emulation is very slow)
 * - Container environment (Alpine Linux needs more time)
 * 
 * @returns {number} Timeout in milliseconds
 */
function getTestTimeout() {
  if (!process.env.CI) return 10000; // Local development: 10 seconds

  // Check if we're in Alpine Linux (common in Docker containers)
  const isAlpine = fs.existsSync("/etc/alpine-release");

  // Extra time for slow environments
  if (platform === "win32") return 60000; // Windows: 60s (slow process forking)
  if (isAlpine && arch === "arm64") return 60000; // Alpine ARM64: 60s (emulation is very slow)
  if (isAlpine) return 45000; // Alpine: 45s (generally slower)

  return 30000; // Default CI timeout: 30 seconds
}

module.exports = { getTestTimeout };