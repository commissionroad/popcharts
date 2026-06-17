<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Pop Charts App Rules

- Production frontend code lives in this `app/` package.
- Route files in `src/app/` compose pages. Do not put LMSR, receipt, clearing, or solvency logic in route files.
- Domain modules in `src/domain/` are pure TypeScript. They must not import React, Next.js, browser APIs, wallet SDKs, or UI components.
- Client components should be the smallest useful interactive islands: wallet controls, filters, forms, sliders, and trade tickets.
- Use the product language from `CONTEXT.md`: pre-graduation buys are receipts or priced intents, not fills or final positions.
- Use Pop Charts tokens from `src/design-system/tokens.css`; avoid raw hex colors in product components.
- Keep tests close to the code for domain and component behavior. Browser flows live in `src/tests/e2e/`.
- For UI-impacting PRs, use `../skills/engineering/ui-pr-verification/SKILL.md`:
  exercise the real local app path when feasible, capture a screenshot of the
  changed state, and include the screenshot plus local verification notes in the
  PR description.
