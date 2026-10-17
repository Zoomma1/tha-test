import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import globals from "globals";

const API_FETCH = "CallExpression[callee.name='fetch']";
const API_URL = "/^\\/api(\\/|\\?|$)/";
const USE_CLIENT = "Use web/src/lib/api-client.ts instead.";

const baseSyntax = [
  {
    selector: "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
    message: "`as unknown as` bypasses typing; parse or narrow instead.",
  },
  {
    selector: "CallExpression[callee.object.name='z'][callee.property.name=/^(any|custom)$/]",
    message: "z.any() and z.custom() disable validation; describe the shape.",
  },
];

const apiFetchSyntax = [
  {
    selector: `${API_FETCH} > Literal.arguments:first-child[value=${API_URL}]`,
    message: `Do not fetch /api directly. ${USE_CLIENT}`,
  },
  {
    selector: `${API_FETCH} > TemplateLiteral.arguments:first-child > TemplateElement:first-child[value.raw=${API_URL}]`,
    message: `Do not fetch /api directly. ${USE_CLIENT}`,
  },
];

// Bare `fetch` is covered by no-restricted-globals; this catches the global-object spellings.
const webFetchSyntax = [
  {
    selector: ":matches(MemberExpression[property.name='fetch'], MemberExpression[property.value='fetch'])[object.name=/^(window|globalThis|self)$/]",
    message: `fetch is forbidden in web/src. ${USE_CLIENT}`,
  },
];

export default tseslint.config(
  // Only the numbered canary fixtures are faulty on purpose (scripts/canary.mjs lints them with ignores off); strays stay linted.
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "api/src/generated/**", "canary/[0-9][0-9]-*.ts"] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "@eslint-community/eslint-comments": eslintComments },
    rules: {
      "@eslint-community/eslint-comments/no-use": ["error", { allow: [] }],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": true },
      ],
      "no-restricted-syntax": ["error", ...baseSyntax, ...apiFetchSyntax],
    },
  },
  { files: ["**/*.mjs"], extends: [tseslint.configs.disableTypeChecked] },
  { files: ["web/**"], languageOptions: { globals: { ...globals.browser } } },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...baseSyntax, ...apiFetchSyntax, ...webFetchSyntax],
      "no-restricted-globals": ["error", { name: "fetch", message: `fetch is forbidden in web/src. ${USE_CLIENT}` }],
    },
  },
  {
    files: ["web/src/lib/api-client.ts"],
    rules: { "no-restricted-syntax": ["error", ...baseSyntax], "no-restricted-globals": "off" },
  },
);
