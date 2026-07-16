import type { ResolutionEvalCase } from "./dataset-types";

/**
 * Draw/void cases: real events that genuinely tied or slipped past the
 * market's stated deadline, where the criteria explicitly map that state to a
 * DRAW outcome (redeem at half). The resolver must follow the criteria's
 * draw clause instead of forcing a YES/NO. Note `deriveVerdict` maps `draw`
 * to `cancel_draw`, which always parks for an operator.
 */
export const DRAW_CASES: ResolutionEvalCase[] = [
  {
    id: "draw-copa-2024-final-regulation",
    taxonomy: "draw/tie",
    expected: "draw",
    rationale:
      "The 2024 Copa América final between Argentina and Colombia was 0-0 after 90-minute regulation (Argentina won 1-0 in extra time), so the regulation-only market draws.",
    metadata: {
      category: "Sports",
      question:
        "Did Argentina beat Colombia in regulation time in the 2024 Copa América final?",
      description:
        "Regulation time only: the score at the end of the 90 minutes plus stoppage, before any extra time.",
      resolutionCriteria:
        "Resolves YES if Argentina led at the end of regulation (90 minutes plus stoppage, extra time and penalties excluded) in the 2024 Copa América final (July 14, 2024), per CONMEBOL's official record or the AP match report. Resolves NO if Colombia led at that point. Resolves DRAW if the score was level at the end of regulation.",
      resolutionSources: [
        "https://copaamerica.com",
        "https://apnews.com/hub/copa-america",
      ],
      resolutionUrl: "https://copaamerica.com",
      observationWindowStart: "2024-07-14T00:00:00Z",
      observationWindowEnd: "2024-07-15T23:59:59Z",
    },
  },
  {
    id: "draw-usa-china-golds-paris-2024",
    taxonomy: "draw/tie",
    expected: "draw",
    rationale:
      "The USA and China each won exactly 40 gold medals at Paris 2024, meeting the criteria's explicit equal-count draw clause.",
    metadata: {
      category: "Sports",
      question:
        "Did the United States win strictly more gold medals than China at the Paris 2024 Summer Olympics?",
      description:
        "Compares final official gold-medal counts for the United States and China.",
      resolutionCriteria:
        "Resolves YES if the final official Paris 2024 medal table published by the IOC (olympics.com) shows the United States with strictly more gold medals than China. Resolves NO if China has strictly more gold medals than the United States. Resolves DRAW if the two gold-medal counts are equal. Post-Games medal reallocations after 2024-12-31 are ignored.",
      resolutionSources: [
        "https://www.olympics.com/en/olympic-games/paris-2024/medals",
      ],
      resolutionUrl:
        "https://www.olympics.com/en/olympic-games/paris-2024/medals",
      observationWindowStart: "2024-07-26T00:00:00Z",
      observationWindowEnd: "2024-08-11T23:59:59Z",
    },
  },
  {
    id: "draw-paul-tyson-july-2024-postponed",
    taxonomy: "draw/postponed-void",
    expected: "draw",
    rationale:
      "The Paul–Tyson bout scheduled for July 20, 2024 was postponed (Tyson's health) past the market's August 31 cutoff — it took place November 15, 2024 — so the void clause applies.",
    metadata: {
      category: "Sports",
      question:
        "Did Jake Paul defeat Mike Tyson in their boxing match scheduled for July 20, 2024?",
      description:
        "Refers to the bout originally scheduled for July 20, 2024 at AT&T Stadium; the market voids if that bout does not happen by the stated cutoff.",
      resolutionCriteria:
        "Resolves YES if Jake Paul is the announced winner of the Paul vs. Tyson bout, provided the bout takes place on or before August 31, 2024, per the promoter's official announcement or the AP report. Resolves NO if Mike Tyson is the announced winner within that window. If the bout is postponed, cancelled, or otherwise does not take place by 2024-08-31 23:59 ET, resolves DRAW (void).",
      resolutionSources: ["https://apnews.com", "https://www.espn.com/boxing/"],
      resolutionUrl: "https://www.espn.com/boxing/",
      observationWindowStart: "2024-07-20T00:00:00Z",
      observationWindowEnd: "2024-08-31T23:59:59Z",
    },
  },
];
