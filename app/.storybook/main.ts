import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/react-vite";

const resolveLocal = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Minimal Vite Storybook scoped to isolated product components. The panel
 * depends on two data hooks — the connected wallet and the indexed portfolio
 * read — that would otherwise drag in Privy/wagmi and a live indexer. Aliasing
 * them (and the chain-config module they touch) to lightweight preview stubs
 * lets a story render the real component and styles with fixture data, no
 * wallet or backend required.
 */
const config: StorybookConfig = {
  addons: [],
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  viteFinal: (viteConfig) => {
    const panelHooks = resolveLocal("./mocks/panel-hooks.ts");
    const contractsConfig = resolveLocal("./mocks/contracts-config.ts");
    const nextLink = resolveLocal("./mocks/next-link.tsx");
    const src = resolveLocal("../src");
    const existing = viteConfig.resolve?.alias ?? [];
    const existingEntries = Array.isArray(existing)
      ? existing
      : Object.entries(existing).map(([find, replacement]) => ({ find, replacement }));

    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: [
        { find: "@/features/portfolio/use-portfolio", replacement: panelHooks },
        { find: "@/integrations/wallet/wallet-provider", replacement: panelHooks },
        { find: "@/integrations/contracts/config", replacement: contractsConfig },
        { find: "next/link", replacement: nextLink },
        { find: /^@\/(.*)$/, replacement: `${src}/$1` },
        ...existingEntries,
      ],
    };

    return viteConfig;
  },
};

export default config;
