import base from "../../.prettierrc.json" with { type: "json" };

// Matches the formatting the generated client had when it lived in app/
// (app/prettier.config.mjs minus the tailwind plugin, which never affects
// the generated .ts files). Orval runs prettier over ./src/generated, so
// this config decides the committed bytes — keep it in sync with app's
// effective options or api:check will flag phantom drift.
/** @type {import("prettier").Config} */
export default {
  ...base,
  printWidth: 88,
  trailingComma: "es5",
};
