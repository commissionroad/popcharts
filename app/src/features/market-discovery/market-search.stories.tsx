import type { Decorator, Meta, StoryObj } from "@storybook/nextjs";
import { useState } from "react";

import {
  BOARD_STATUS_FILTERS,
  DEFAULT_BOARD_STATUS_FILTER,
} from "@/domain/markets/board-filters";
import type { Market, MarketCategory } from "@/domain/markets/types";
import { DiscoveryFilterBar } from "@/features/market-discovery/discovery-filter-bar";
import type { MarketSearchState } from "@/features/market-discovery/market-search-field";
import { MarketSearchResults } from "@/features/market-discovery/market-search-results";
import { marketFactory } from "@/test/factories/markets";

/**
 * Design surface for repo ADR 0013's open "market search and richer
 * category/status filtering" item. Everything here is presentational: no API
 * call, no URL state, no wiring into the live discovery page.
 *
 * The status half already shipped (repo ADR 0022 P8) as server-side `status`
 * filtering behind the board's chips, and it appears here unchanged so the new
 * search and category work can be judged beside it rather than in isolation.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A board wide enough to search against: every category represented, several
 * statuses, and questions that overlap on real words ("rate", "record") so a
 * query can plausibly match more than one card.
 */
const CATALOGUE: Market[] = [
  market({
    category: "Crypto",
    id: "eth-5000",
    matchedUsd: 356_000,
    noPriceCents: 36,
    question: "Will ETH flip $5,000 before August?",
    status: "bootstrap",
    volumeUsd: 812_000,
    yesPriceCents: 64,
  }),
  market({
    category: "Crypto",
    id: "btc-record-q2",
    matchedUsd: 480_000,
    noPriceCents: 12,
    question: "Did BTC set a new all-time high in Q2?",
    status: "graduated",
    volumeUsd: 1_400_000,
    yesPriceCents: 88,
  }),
  market({
    category: "Econ",
    id: "fed-rate-cut",
    matchedUsd: 210_000,
    noPriceCents: 59,
    question: "Will the Fed cut rates at the next meeting?",
    status: "bootstrap",
    volumeUsd: 430_000,
    yesPriceCents: 41,
  }),
  market({
    category: "Econ",
    id: "inflation-under-two",
    matchedUsd: 96_000,
    noPriceCents: 73,
    question: "Will inflation print below 2% this year?",
    status: "resolved",
    volumeUsd: 265_000,
    yesPriceCents: 27,
  }),
  market({
    category: "Politics",
    id: "incumbent-general",
    matchedUsd: 302_000,
    noPriceCents: 48,
    question: "Will the incumbent win the general election?",
    status: "bootstrap",
    volumeUsd: 690_000,
    yesPriceCents: 52,
  }),
  market({
    category: "Sports",
    id: "underdog-final",
    matchedUsd: 141_000,
    noPriceCents: 77,
    question: "Will an underdog win the next major final?",
    status: "graduating",
    volumeUsd: 318_000,
    yesPriceCents: 23,
  }),
  market({
    category: "Weather",
    id: "hottest-june",
    matchedUsd: 74_000,
    noPriceCents: 31,
    question: "Will this be the hottest June on record?",
    status: "bootstrap",
    volumeUsd: 152_000,
    yesPriceCents: 69,
  }),
  market({
    category: "Tech",
    id: "frontier-model",
    matchedUsd: 288_000,
    noPriceCents: 21,
    question: "Will a frontier lab ship a new model this quarter?",
    status: "graduating",
    volumeUsd: 574_000,
    yesPriceCents: 79,
  }),
  market({
    category: "Culture",
    id: "tentpole-billion",
    matchedUsd: 118_000,
    noPriceCents: 55,
    question: "Will the summer tentpole cross $1B worldwide?",
    status: "bootstrap",
    volumeUsd: 246_000,
    yesPriceCents: 45,
  }),
];

function market(overrides: Partial<Market>): Market {
  return marketFactory({
    graduationTargetUsd: 500_000,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Preview-only filtering
// ---------------------------------------------------------------------------

/**
 * Filters the catalogue so the stories are explorable — type in the field and
 * the grid responds.
 *
 * Deliberately local to this file rather than a `src/domain` module. ADR 0013
 * asks for search and category filtering *against the API*, replacing
 * client-side filtering; a domain helper here would be a shipped
 * implementation of the thing that item exists to delete, and would read as
 * the answer when it is only the scaffolding that makes a story move.
 */
function previewFilter({
  categories,
  query,
  statusKey,
}: {
  categories: readonly MarketCategory[];
  query: string;
  statusKey: string;
}): Market[] {
  const needle = query.trim().toLowerCase();
  const statuses =
    BOARD_STATUS_FILTERS.find((filter) => filter.key === statusKey)?.statuses ?? [];

  return CATALOGUE.filter((entry) => {
    if (categories.length > 0 && !categories.includes(entry.category)) {
      return false;
    }
    if (statuses.length > 0 && !statuses.includes(entry.status)) {
      return false;
    }

    return (
      needle === "" ||
      `${entry.question} ${entry.description} ${entry.category}`
        .toLowerCase()
        .includes(needle)
    );
  });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type BoardArgs = {
  /** Categories selected on open. */
  categories: readonly MarketCategory[];
  /** Query in the field on open. */
  query: string;
  /** Drives the in-flight and failed surfaces; `idle` renders real results. */
  searchState: MarketSearchState;
  /** Status view on open — the half that already ships server-side. */
  statusKey: string;
};

/**
 * Composes the two new pieces the way the real board eventually will: the
 * filter bar over the results region, sharing one filter state.
 *
 * The state is seeded from args and then owned locally, so each story opens in
 * the state it is about and stays clickable from there. Args changed in the
 * controls panel re-seed it during render — the same reset-on-new-props shape
 * `MarketCardLive` uses — rather than through an effect that would render the
 * stale filters once first.
 */
function SearchableBoardPreview({
  categories,
  query,
  searchState,
  statusKey,
}: BoardArgs) {
  const seed = `${query}|${categories.join(",")}|${statusKey}`;
  const [state, setState] = useState(() => ({ categories, query, seed, statusKey }));

  if (state.seed !== seed) {
    setState({ categories, query, seed, statusKey });
  }

  const filtered =
    state.query.trim() !== "" ||
    state.categories.length > 0 ||
    state.statusKey !== DEFAULT_BOARD_STATUS_FILTER.key;
  const results = previewFilter(state);
  const settled = searchState === "idle";

  return (
    <div>
      <DiscoveryFilterBar
        categories={state.categories}
        onCategoriesClear={() => setState({ ...state, categories: [] })}
        onCategoryToggle={(category) =>
          setState({
            ...state,
            categories: state.categories.includes(category)
              ? state.categories.filter((entry) => entry !== category)
              : [...state.categories, category],
          })
        }
        onClearAll={() =>
          setState({
            ...state,
            categories: [],
            query: "",
            statusKey: DEFAULT_BOARD_STATUS_FILTER.key,
          })
        }
        onQueryChange={(next) => setState({ ...state, query: next })}
        onQueryClear={() => setState({ ...state, query: "" })}
        onStatusChange={(next) => setState({ ...state, statusKey: next })}
        query={state.query}
        resultCount={settled ? results.length : null}
        searchState={searchState}
        statusKey={state.statusKey}
      />
      <MarketSearchResults
        filtered={filtered}
        markets={results}
        onClearFilters={() =>
          setState({
            ...state,
            categories: [],
            query: "",
            statusKey: DEFAULT_BOARD_STATUS_FILTER.key,
          })
        }
        onRetry={() => undefined}
        query={state.query}
        state={searchState}
      />
    </div>
  );
}

/** The board's real page width and background, so density reads honestly. */
const BoardFrame: Decorator = (Story) => (
  <div style={{ background: "var(--color-page-bg)", minHeight: "100vh", padding: 32 }}>
    <div style={{ margin: "0 auto", maxWidth: "var(--layout-max)" }}>
      <Story />
    </div>
  </div>
);

const meta = {
  args: {
    categories: [],
    query: "",
    searchState: "idle",
    statusKey: DEFAULT_BOARD_STATUS_FILTER.key,
  },
  argTypes: {
    searchState: {
      control: "inline-radio",
      options: ["idle", "loading", "error"] satisfies MarketSearchState[],
    },
    statusKey: {
      control: "select",
      options: BOARD_STATUS_FILTERS.map((filter) => filter.key),
    },
  },
  component: SearchableBoardPreview,
  decorators: [BoardFrame],
  parameters: { layout: "fullscreen" },
  title: "Market discovery/Search and filtering",
} satisfies Meta<typeof SearchableBoardPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * The board as it opens: a search field that has never been typed in, the
 * status views that ship today, and the category row. Nothing is filtered, so
 * no summary strip and no "Clear all" — the header is the two rows the board
 * already has, plus a search box.
 */
export const Idle: Story = {};

/**
 * Mid-query. The summary strip has appeared to say how many markets came back
 * and what was asked for, and the field has grown its clear button. This is
 * the state that decides whether search feels like part of the board or like a
 * separate mode: the grid below is the same grid, re-filtered, not a results
 * page.
 */
export const TypingWithResults: Story = {
  args: { query: "will the" },
};

/**
 * A query that matches nothing — the state most worth designing, because it is
 * how a new user usually meets the board.
 *
 * It quotes the query back so a typo is visible as a typo, offers the way out
 * of the filters, and then offers to create the market. That last one is the
 * point: on a prediction market, a question someone searched for and could not
 * find is the clearest demand signal the product ever gets, and the empty
 * result is the only moment it is legible.
 */
export const NoMatches: Story = {
  args: { query: "eurovision" },
};

/**
 * Zero matches with no query — filters alone narrowed it to nothing. No create
 * prompt here: there is no question to create, so the panel drops to the one
 * action that helps and says which lever to widen.
 */
export const NoMatchesFromFiltersOnly: Story = {
  args: { categories: ["Weather"], statusKey: "resolved" },
};

/**
 * The search in flight. Card-shaped placeholders hold the grid's exact
 * dimensions so results land without the page jumping under the pointer, and
 * the summary strip reports "Searching…" rather than a stale count — a number
 * next to a spinner reads as the answer to the query being typed.
 */
export const Loading: Story = {
  args: { query: "rate", searchState: "loading" },
};

/**
 * The search failed. Kept visibly distinct from "found nothing", which is the
 * failure this state exists to prevent: a search that renders an empty grid on
 * a 500 teaches people the market does not exist. The filters survive the
 * retry, and the strip says the count is unavailable instead of guessing.
 */
export const SearchError: Story = {
  args: { query: "rate", searchState: "error" },
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * One category, which is all today's board can express. The chip row is the
 * same shape as the shipped one — the change is what a second click does.
 */
export const CategorySingleSelect: Story = {
  args: { categories: ["Crypto"] },
};

/**
 * Two categories at once — the actual reason to touch this. Today "Politics"
 * then "Econ" shows Econ only; here it shows both, which is what a board
 * mixing seven categories is usually asked for. "All" stays lit only while
 * nothing is chosen, so it reads as the empty selection rather than an eighth
 * category.
 */
export const CategoryMultiSelect: Story = {
  args: { categories: ["Econ", "Politics"] },
};

/**
 * Category and status together, with search idle. The two filters compose
 * without either taking over the header, and the summary strip is where they
 * are stated in one line — the only place the full filter state is written
 * out, which is what keeps the chips from having to.
 */
export const CategoryAndStatus: Story = {
  args: { categories: ["Crypto", "Tech"], statusKey: "graduating" },
};

/**
 * All three filters on at once — the densest the header ever gets, and the
 * case for putting "Clear all" in the summary strip rather than beside the
 * chips. One button resets the lot; it exists only while there is something to
 * reset, so it never sits inert in the corner of an unfiltered board.
 */
export const ClearAllFilters: Story = {
  args: { categories: ["Crypto"], query: "all-time", statusKey: "graduated" },
};

/**
 * The board with nothing on it and nothing filtered — kept separate from zero
 * matches, since "there are no markets yet" and "your search found none" want
 * opposite responses. This is the copy the board ships today, unchanged.
 */
export const EmptyBoard: Story = {
  args: { categories: ["Sports"], statusKey: "refunded" },
  render: () => (
    <div>
      <DiscoveryFilterBar
        categories={[]}
        onCategoriesClear={() => undefined}
        onCategoryToggle={() => undefined}
        onClearAll={() => undefined}
        onQueryChange={() => undefined}
        onQueryClear={() => undefined}
        onStatusChange={() => undefined}
        query=""
        resultCount={0}
        statusKey={DEFAULT_BOARD_STATUS_FILTER.key}
      />
      <MarketSearchResults
        filtered={false}
        markets={[]}
        onClearFilters={() => undefined}
        onRetry={() => undefined}
        query=""
      />
    </div>
  ),
};
