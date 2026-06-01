// Jest config for LoadQ. Uses jest-expo preset for Expo + RN-friendly
// transforms (handles react-native and a long allowlist of ESM deps
// from node_modules that ship as raw .ts/.tsx). transformIgnorePatterns
// extends the preset's list with the few @supabase / expo packages we
// import that aren't already covered.
module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts", "**/tests/**/*.test.tsx"],
  setupFiles: ["<rootDir>/tests/setup.ts"],
  moduleNameMapper: {
    "^../../services/supabase$": "<rootDir>/tests/__mocks__/supabase.ts",
    "^./supabase$": "<rootDir>/tests/__mocks__/supabase.ts",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-native-community|@react-native-async-storage|expo-modules-core|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg))",
  ],
  collectCoverageFrom: [
    "services/**/*.ts",
    "utils/**/*.ts",
    "hooks/**/*.ts",
    "!**/*.d.ts",
  ],
};
