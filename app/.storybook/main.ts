import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/nextjs";
import webpack from "webpack";

const mock = (path: string) => fileURLToPath(new URL(path, import.meta.url));

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
  webpackFinal: (webpackConfig) => {
    // Render hook-driven components (e.g. the market position panel) from
    // fixtures: replace the connected-wallet and indexed-portfolio reads with a
    // preview stub that stories drive through context. This keeps the real
    // wallet stack (Privy/wagmi and its optional connectors) out of the build.
    // A replacement plugin rather than resolve.alias because Next resolves the
    // "@/" paths itself and wins over a plain alias.
    webpackConfig.plugins ??= [];
    webpackConfig.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^@\/(features\/portfolio\/use-portfolio|integrations\/wallet\/wallet-provider|integrations\/contracts\/hooks\/use-refund-claim|integrations\/contracts\/hooks\/use-redemption)$/,
        mock("./mocks/panel-hooks.ts")
      )
    );

    return webpackConfig;
  },
};

export default config;
