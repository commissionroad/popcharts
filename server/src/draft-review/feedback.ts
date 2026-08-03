import type { ReviewResult } from "src/ai-review/types";
import type {
  DraftFeedbackItem,
  DraftReviewFeedback,
} from "src/db/schema/market-draft-reviews";

/**
 * Canonical creator-facing advice for each deterministic hard flag. The
 * reviewer's own `reasons` describe what it saw; these describe what to do
 * about it — kept here, next to nothing model-generated, so the copy stays
 * stable and reviewable.
 */
const HARD_FLAG_FEEDBACK: Record<
  string,
  Omit<DraftFeedbackItem, "severity">
> = {
  death_market: {
    field: "question",
    howToFix:
      "Reframe around a neutral, verifiable outcome — an official announcement, a record, a score — rather than anyone dying or being harmed.",
    issue: "The market speculates on death or lethal harm to a person.",
    title: "Death and harm can't be market subjects",
  },
  illegal_activity: {
    field: "question",
    howToFix:
      "Ask about a lawful, publicly reported outcome instead. If the news event itself is the subject (e.g. an indictment or verdict), phrase it around the official proceeding, not the crime happening.",
    issue: "The market depends on illegal activity taking place.",
    title: "Markets can't turn on crimes",
  },
  prompt_injection: {
    howToFix:
      "Remove any text that talks to the reviewer or the system — the market text should only describe the event and how it resolves.",
    issue:
      "The text contains instructions aimed at manipulating the automated reviewer.",
    title: "Remove reviewer-directed instructions",
  },
  private_local_knowledge: {
    field: "question",
    howToFix:
      "Rewrite it so a stranger could settle it from public information alone: name public subjects and point at sources anyone can check.",
    issue:
      "Only you (or your circle) could know the outcome — the public can't verify it.",
    title: "Make it publicly checkable",
  },
  sexual_exploitation: {
    field: "question",
    howToFix:
      "This subject can't be reframed into a market. Start from a different question.",
    issue: "The market involves sexual exploitation or abuse.",
    title: "This subject is not allowed",
  },
  violent_harm: {
    field: "question",
    howToFix:
      "Reframe around a neutral, verifiable outcome that doesn't require anyone to be hurt.",
    issue: "The market speculates on violent harm or a heinous crime.",
    title: "Violence can't be a market subject",
  },
};

/**
 * Pattern-matched advice for the reviewer's known soft findings. Reasons are
 * free text, so these match on stable phrases from the deterministic policy;
 * anything unrecognized falls through to a generic item that still shows the
 * reviewer's own words.
 */
const SOFT_REASON_FEEDBACK: Array<{
  item: Omit<DraftFeedbackItem, "severity">;
  pattern: RegExp;
}> = [
  {
    item: {
      field: "question",
      howToFix:
        'Start with "Will", "Is", or "Does", name one subject and one deadline: "Will <subject> <event> by <date>?"',
      issue: "The question doesn't read as a clear yes/no proposition.",
      title: "Phrase it as a yes/no question",
    },
    pattern: /clear yes\/no|binary proposition|phrased as a clear/i,
  },
  {
    item: {
      field: "question",
      howToFix:
        "Markets predict — ask about something that hasn't been decided yet, or move the deadline into the future.",
      issue: "The question asks about an event that already happened.",
      title: "Ask about the future",
    },
    pattern: /already-decided|already decided|past event/i,
  },
  {
    item: {
      field: "resolutionSources",
      howToFix:
        "Point at a durable public source — an article, an official page, a stats feed — that will still exist when the market resolves.",
      issue:
        "Resolution depends on an ephemeral artifact (stories, deletable posts) that can't be verified later.",
      title: "Cite a source that will still exist",
    },
    pattern: /ephemeral/i,
  },
  {
    item: {
      field: "resolutionSources",
      howToFix:
        "Swap the satire outlet for a factual one — official records, wire services, or major news.",
      issue: "A named resolution source is a satire outlet.",
      title: "Satire can't settle a market",
    },
    pattern: /satire|satirical/i,
  },
];

/** Score-derived advice thresholds, applied when no equivalent item exists. */
const SCORE_FEEDBACK: Array<{
  applies: (result: ReviewResult) => boolean;
  item: DraftFeedbackItem;
}> = [
  {
    applies: (result) => result.scores.sourceQuality <= 1,
    item: {
      field: "resolutionSources",
      howToFix:
        "Name one to three public sources (outlet names or URLs) a stranger could check to settle this.",
      issue: "No strong resolution source is named.",
      severity: "info",
      title: "Add resolution sources",
    },
  },
  {
    applies: (result) => result.scores.objectivity <= 2,
    item: {
      field: "resolutionCriteria",
      howToFix:
        "Spell out exactly what counts as YES: the measurement, the source of truth, and the cutoff time. Leave no judgment calls.",
      issue: "The resolution criteria leave room for interpretation.",
      severity: "warning",
      title: "Tighten the resolution criteria",
    },
  },
  {
    applies: (result) => result.scores.disputeRisk >= 4,
    item: {
      field: "resolutionCriteria",
      howToFix:
        "Pre-answer the edge cases: what happens on a postponement, a tie, a partial result, or conflicting reports.",
      issue: "As written, reasonable people could dispute the outcome.",
      severity: "warning",
      title: "Reduce dispute risk",
    },
  },
];

const VERDICT_SUMMARIES = {
  approve: "Approved — this market is ready to publish.",
  manual_review:
    "Almost there — fix the flagged issues below and resubmit for review.",
  reject: "This market can't run as written — address the blockers below.",
} as const;

/**
 * Translates a raw review into the feedback the creator sees: a one-line
 * summary and actionable items ("what's wrong" + "how to fix it"), each tied
 * to a form field when one applies. Hard flags become blockers; recognized
 * soft findings become targeted warnings; unrecognized reasons still surface
 * verbatim so model-provider feedback is never dropped.
 */
export function buildDraftReviewFeedback(
  result: ReviewResult,
): DraftReviewFeedback {
  const items: DraftFeedbackItem[] = [];
  const matchedReasons = new Set<string>();

  for (const flag of result.hardFlags) {
    const advice = HARD_FLAG_FEEDBACK[flag];

    if (advice && !items.some((item) => item.title === advice.title)) {
      items.push({ ...advice, severity: "blocker" });
    }
  }

  for (const reason of result.reasons) {
    if (isHardFlagReason(result, reason)) {
      matchedReasons.add(reason);
      continue;
    }

    const soft = SOFT_REASON_FEEDBACK.find(({ pattern }) =>
      pattern.test(reason),
    );

    if (soft) {
      matchedReasons.add(reason);

      if (!items.some((item) => item.title === soft.item.title)) {
        items.push({ ...soft.item, severity: "warning" });
      }
    }
  }

  for (const reason of result.reasons) {
    if (matchedReasons.has(reason)) {
      continue;
    }

    items.push({
      howToFix:
        "Revise the draft with this in mind, then resubmit — the next review sees only the new text.",
      issue: reason,
      severity: result.verdict === "reject" ? "blocker" : "warning",
      title: "Reviewer note",
    });
  }

  for (const { applies, item } of SCORE_FEEDBACK) {
    if (
      applies(result) &&
      !items.some((existing) => existing.title === item.title)
    ) {
      items.push(item);
    }
  }

  return {
    items,
    summary: VERDICT_SUMMARIES[result.verdict],
  };
}

/**
 * A reason that restates a hard flag would double-render next to its blocker
 * item; the hard-flag advice already carries the reviewer's finding.
 */
function isHardFlagReason(result: ReviewResult, reason: string): boolean {
  if (result.hardFlags.length === 0) {
    return false;
  }

  return /speculate|manipulating the reviewer|private circle|private life|illegal activity|sexual exploitation/i.test(
    reason,
  );
}
