import "../src/app/globals.css";

import type { Preview } from "@storybook/nextjs";

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        app: { name: "App", value: "var(--color-page-bg)" },
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "fullscreen",
  },
};

export default preview;
