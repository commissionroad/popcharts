import base from "../.prettierrc.json" with { type: "json" };

/** @type {import("prettier").Config} */
export default {
  ...base,
  plugins: ["prettier-plugin-tailwindcss"],
  printWidth: 88,
  trailingComma: "es5",
};
