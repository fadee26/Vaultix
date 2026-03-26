import { Linter } from "eslint";
import tseslint from "@typescript-eslint/eslint-plugin";
import prettierPlugin from "eslint-plugin-prettier";

/** @type {Linter.FlatConfig[]} */
const config = [
  {
    languageOptions: {
      parser: "@typescript-eslint/parser",
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        browser: "readonly",
        node: "readonly",
        es6: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      prettier: prettierPlugin,
    },
    rules: {
      // Add your custom rules here
    },
    extends: [
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:prettier/recommended",
    ],
  },
];

export default config;