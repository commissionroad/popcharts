import { truncate } from "src/shared/cli-runner";

/**
 * Parsing for the Claude Code CLI's `--output-format stream-json` transcript.
 *
 * The review provider reads this stream rather than the single-object `json`
 * envelope for one reason: the stream is the only place the CLI reports which
 * web searches and fetches actually ran. Without those records a claimed
 * source is indistinguishable from an invented one, so every sourceCheck the
 * model emits would have to be trusted on its word.
 *
 * Everything here is untrusted: the transcript carries model output and
 * fetched page text, so unrecognized lines and blocks are skipped rather than
 * assumed well-formed.
 *
 * Verified against Claude Code 2.1.77.
 */

/** One tool invocation the CLI recorded, keyed to its result by `id`. */
export type ClaudeCliToolUse = {
  id: string;
  input: Record<string, unknown>;
  name: string;
};

/**
 * One tool result the CLI recorded. `isError` is what separates a retrieval
 * that happened from one that failed — a 403 or DNS failure still leaves a
 * tool_use behind, so the result is the only proof the URL was reached.
 */
export type ClaudeCliToolResult = {
  content: string;
  isError: boolean;
  toolUseId: string;
};

/** The final reply plus the tool records that produced it. */
export type ClaudeCliStream = {
  result: string;
  toolResults: ClaudeCliToolResult[];
  toolUses: ClaudeCliToolUse[];
};

export function parseClaudeCliStream(stdout: string): ClaudeCliStream {
  const toolResults: ClaudeCliToolResult[] = [];
  const toolUses: ClaudeCliToolUse[] = [];
  let resultEvent: { isError: boolean; result: string } | null = null;

  for (const line of stdout.split("\n")) {
    const event = parseLine(line);
    if (!event) {
      continue;
    }

    if (event.type === "result") {
      resultEvent = {
        isError: event.is_error === true,
        result: typeof event.result === "string" ? event.result : "",
      };
      continue;
    }

    for (const block of contentBlocks(event)) {
      collectBlock(block, toolResults, toolUses);
    }
  }

  if (!resultEvent) {
    throw new Error(
      `claude CLI did not emit a stream-json result event: ${truncate(stdout, 200)}`,
    );
  }

  if (resultEvent.isError) {
    throw new Error(
      `claude CLI reported an error result: ${truncate(resultEvent.result, 200)}`,
    );
  }

  return { result: resultEvent.result, toolResults, toolUses };
}

type StreamEvent = {
  is_error?: unknown;
  message?: unknown;
  result?: unknown;
  type?: unknown;
};

function parseLine(line: string): (StreamEvent & { type: string }) | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as StreamEvent).type === "string"
    ) {
      return parsed as StreamEvent & { type: string };
    }
  } catch {
    // A line that is not JSON is progress noise, not a transcript event.
  }

  return null;
}

function contentBlocks(event: StreamEvent): Record<string, unknown>[] {
  const message = event.message;
  if (typeof message !== "object" || message === null) {
    return [];
  }

  const content = (message as { content?: unknown }).content;
  return Array.isArray(content)
    ? content.filter(
        (block): block is Record<string, unknown> =>
          typeof block === "object" && block !== null,
      )
    : [];
}

function collectBlock(
  block: Record<string, unknown>,
  toolResults: ClaudeCliToolResult[],
  toolUses: ClaudeCliToolUse[],
) {
  if (block.type === "tool_use") {
    if (typeof block.id === "string" && typeof block.name === "string") {
      toolUses.push({
        id: block.id,
        input:
          typeof block.input === "object" && block.input !== null
            ? (block.input as Record<string, unknown>)
            : {},
        name: block.name,
      });
    }
    return;
  }

  if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
    toolResults.push({
      content: resultText(block.content),
      isError: block.is_error === true,
      toolUseId: block.tool_use_id,
    });
  }
}

/**
 * Flattens a tool result's payload to text. WebSearch and WebFetch return a
 * plain string; the structured array form belongs to other tools and is
 * stringified only so an unexpected shape cannot throw here.
 */
function resultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  return content === undefined || content === null
    ? ""
    : JSON.stringify(content);
}
