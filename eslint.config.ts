import { fileURLToPath } from "node:url";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import jsdoc from "eslint-plugin-jsdoc";
import tsdoc from "eslint-plugin-tsdoc";
import tseslint from "typescript-eslint";
import { maxOneLineComment } from "./tools/eslint-rules/max-one-line-comment.ts";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "reports/**",
      "graphify-out/**",
      "apps/docs/.astro/**",
      "apps/docs/src/content.config.ts",
      "tests/tooling/fixtures/**",
      "apps/fpving/test/fixtures/plugins/**",
      "apps/fpving/test/fixture-plugin/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  stylistic.configs.customize({
    indent: 2,
    quotes: "double",
    semi: true,
    commaDangle: "always-multiline",
    braceStyle: "1tbs",
    arrowParens: true,
    jsx: false,
  }),
  {
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.tools.json",
          "./packages/*/tsconfig.json",
          "./apps/*/tsconfig.json",
          "./tests/tooling/fixtures/tsconfig.json",
        ],
        tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
      },
    },
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
      "local": { rules: { "max-one-line-comment": maxOneLineComment } },
    },
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": true,
        },
      ],
      "@eslint-community/eslint-comments/no-use": ["error", { allow: [] }],
      "no-magic-numbers": "off",
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: [-1, 0, 1],
          enforceConst: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
      "no-warning-comments": [
        "error",
        {
          terms: ["todo", "fixme", "hack", "xxx", "v8 ignore", "c8 ignore", "istanbul ignore", "node:coverage"],
          location: "anywhere",
        },
      ],
      "multiline-comment-style": ["error", "separate-lines"],
      "local/max-one-line-comment": "error",
      "@stylistic/max-len": ["error", { code: 120, ignoreUrls: true, ignoreStrings: false }],
    },
  },
  {
    files: ["**/*.ts"],
    plugins: { tsdoc },
    rules: { "tsdoc/syntax": "error" },
  },
  {
    files: [
      "packages/plugin-sdk/src/**/*.ts",
      "packages/core/src/**/*.ts",
      "tests/tooling/fixtures/public-api/**/*.ts",
    ],
    plugins: { jsdoc },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
            MethodDefinition: false,
          },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSEnumDeclaration", "VariableDeclaration"],
        },
      ],
      "jsdoc/require-description": "error",
    },
  },
);
