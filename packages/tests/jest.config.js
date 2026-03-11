const { join } = require("path");
const { createDefaultPreset } = require("ts-jest");

/** @type {import('ts-jest/dist/types').JestConfigWithTsJest} */
module.exports = { 
  ...createDefaultPreset(),
  testEnvironment: "node",
  setupFilesAfterEnv: [join(__dirname, "setup-jest.ts")],
};

