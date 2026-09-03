import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * The next-core-web-vitals + next-typescript presets carry the real rules.
 * Only genuinely noisy/subjective rules are relaxed here — correctness
 * rules (unused vars, unreachable code, hook deps) stay ON so lint keeps
 * catching real problems instead of rubber-stamping everything.
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // The app logs sync/auth diagnostics on purpose.
      "no-console": "off",
      // Substantively checked by TypeScript; the JSX entities rule fights
      // apostrophes in user-facing copy.
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-unescaped-entities": "off",
      // Experimental compiler pass — informational, not a merge gate yet.
      "react-compiler/react-compiler": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "examples/**",
      "skills",
    ],
  },
];

export default eslintConfig;
