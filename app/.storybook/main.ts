import type { StorybookConfig } from "@storybook/nextjs";

const config: StorybookConfig = {
  addons: [],
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },
  previewHead: (head) =>
    `${head}<link rel="icon" href="/brand/pop-charts-glyph.svg" />`,
  staticDirs: ["../public"],
  stories: ["../src/**/*.stories.@(ts|tsx)"],
};

export default config;
