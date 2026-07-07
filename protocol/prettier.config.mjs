import base from "../.prettierrc.json" with { type: "json" };

/** @type {import("prettier").Config} */
export default {
  ...base,
  plugins: ["prettier-plugin-solidity"],
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  trailingComma: "all",
  overrides: [
    {
      files: "*.sol",
      options: {
        compiler: "0.8.28",
      },
    },
  ],
};
