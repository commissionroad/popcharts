import "../src/app/globals.css";

import type { Preview } from "@storybook/react-vite";

/**
 * The panel lives in a dark, narrow trading aside, so every story renders on
 * the product page background at the aside's real width.
 */
const preview: Preview = {
  decorators: [
    (Story) => (
      <div style={{ background: "var(--color-page-bg)", padding: 24 }}>
        <div style={{ width: 340 }}>
          <Story />
        </div>
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
  },
};

export default preview;
