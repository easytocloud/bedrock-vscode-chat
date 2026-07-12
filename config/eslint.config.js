const parser = require("@typescript-eslint/parser");

module.exports = [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: parser,
      ecmaVersion: 2020,
      sourceType: "module",
    },
    rules: {
      "no-console": "warn",
      "no-unused-vars": "off",
    },
  },
];
