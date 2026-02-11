import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type TokenUsage,
  type InferenceConfiguration,
} from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';
import type { GenerationModelConfig, GenerationStep } from './generation-state';

// ============================================
// Client
// ============================================

const client = new BedrockRuntimeClient({});

/** Env-var fallback when no config is provided at all */
const DEFAULT_MODEL_ID = process.env.BEDROCK_DEFAULT_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

// ============================================
// Model Shortcuts (US inference profiles)
// ============================================

/** Short names -> full Bedrock inference profile IDs. Use these in execution input instead of full strings. */
export const MODEL_SHORTCUTS: Record<string, string> = {
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  sonnet4: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  opus: 'us.anthropic.claude-opus-4-6-v1',
  opus45: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  opus41: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
};

function expandModelId(idOrShortcut: string): string {
  const lower = idOrShortcut.toLowerCase().trim();
  return MODEL_SHORTCUTS[lower] ?? idOrShortcut;
}

// ============================================
// Model Max Output Tokens
// ============================================

/**
 * Maximum output tokens (thinking + text combined) for each model.
 * Used to set maxTokens to the model's ceiling so output is never truncated.
 * The thinking budget is set to half the max, leaving the other half for text.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview
 *
 * Keyed by full Bedrock inference profile ID.
 */
const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  // Haiku 4.5 — max output 64K
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': 64000,
  // Sonnet 4.5 — max output 64K
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0': 64000,
  // Sonnet 4 — max output 64K
  'us.anthropic.claude-sonnet-4-20250514-v1:0': 64000,
  // Opus 4.6 — max output 128K
  'us.anthropic.claude-opus-4-6-v1': 128000,
  // Opus 4.5 — max output 64K
  'us.anthropic.claude-opus-4-5-20251101-v1:0': 64000,
  // Opus 4.1 — max output 32K (legacy)
  'us.anthropic.claude-opus-4-1-20250805-v1:0': 32000,
};

/** Conservative fallback if we don't recognise the model ID. */
const DEFAULT_MAX_OUTPUT_TOKENS = 32768;

/**
 * Look up the maximum output tokens for a resolved model ID.
 * Falls back to DEFAULT_MAX_OUTPUT_TOKENS for unknown models.
 */
function getModelMaxOutputTokens(modelId: string): number {
  return MODEL_MAX_OUTPUT_TOKENS[modelId] ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

// ============================================
// Model Resolution
// ============================================

/**
 * Resolve which Bedrock model ID to use for a given pipeline step.
 *
 * Priority (highest first):
 *   1. Per-step override in modelConfig.steps[stepName]
 *   2. modelConfig.default
 *   3. BEDROCK_DEFAULT_MODEL_ID env var
 *   4. Hard-coded fallback (Claude Haiku 4.5)
 *
 * Both full inference profile IDs and shortcuts (e.g. "haiku", "sonnet") are accepted.
 */
export function resolveModelId(
  stepName: GenerationStep,
  modelConfig?: GenerationModelConfig,
): string {
  const raw =
    modelConfig?.steps?.[stepName]
    ?? modelConfig?.default
    ?? DEFAULT_MODEL_ID;
  return expandModelId(raw);
}

// ============================================
// callModel — structured JSON generation
// ============================================

export interface CallModelOptions {
  /** Pipeline step name — used for model resolution and logging */
  stepName: GenerationStep;
  /** System prompt providing context and instructions */
  systemPrompt: string;
  /** User message with the specific generation request */
  userPrompt: string;
  /** Per-step model config (passed through the generation state) */
  modelConfig?: GenerationModelConfig;
  /** Temperature. Defaults to 0.7 for creative generation. Ignored when thinking is enabled (always enabled). */
  temperature?: number;
  /** Number of retry attempts for malformed JSON. Defaults to 2. */
  maxRetries?: number;
}

export interface CallModelResult<T> {
  /** The parsed JSON response */
  data: T;
  /** The model ID that was actually used */
  modelId: string;
  /** Raw text response from the model (for debugging) */
  rawText: string;
  /** The model's reasoning/preamble before the JSON (if any) */
  reasoning: string;
}

/**
 * Call a Bedrock model and parse the response as JSON.
 *
 * The model is encouraged to think through its creative decisions before
 * producing JSON. The reasoning preamble is captured and logged separately
 * from the JSON output.
 *
 * On malformed JSON, the function retries with an error-correcting follow-up
 * message up to `maxRetries` times.
 *
 * @param options - Call configuration
 * @param validate - A function that validates and returns the parsed data (e.g. Zod .parse())
 * @returns Validated, typed data from the model
 */
export async function callModel<T>(
  options: CallModelOptions,
  validate: (raw: unknown) => T,
): Promise<CallModelResult<T>> {
  const {
    stepName,
    systemPrompt,
    userPrompt,
    modelConfig,
    temperature = 0.7,
    maxRetries = 2,
  } = options;

  const modelId = resolveModelId(stepName, modelConfig);

  // Resolve token limits from the model's maximum — no per-step budgets needed.
  // Extended thinking is always enabled; budget gets half the model's max.
  const modelMax = getModelMaxOutputTokens(modelId);
  const thinkingTokens = Math.floor(modelMax / 2);
  const maxTokens = modelMax;

  const messages: Message[] = [
    {
      role: 'user',
      content: [{ text: userPrompt }],
    },
  ];

  let lastError: Error | undefined;
  let rawText = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startMs = Date.now();

    // Build inference config — temperature is incompatible with extended thinking
    const inferenceConfig: InferenceConfiguration = { maxTokens };

    // Extended thinking is always enabled
    const additionalModelRequestFields: DocumentType = {
      thinking: {
        type: 'enabled',
        budget_tokens: thinkingTokens,
      },
    };

    const command = new ConverseCommand({
      modelId,
      system: [{ text: systemPrompt }],
      messages,
      inferenceConfig,
      additionalModelRequestFields,
    });

    const response = await client.send(command);
    const latencyMs = Date.now() - startMs;
    const usage = response.usage;

    // Extract reasoning and text from the response content blocks
    const { reasoning, text } = extractContent(response.output?.message?.content);
    rawText = text;

    // Extended thinking separates reasoning into its own content block.
    // The text block should be pure JSON, but we still run through
    // splitReasoningAndJson in case the model wrapped it in a fence.
    const split = splitReasoningAndJson(text);
    const jsonStr = split.jsonStr;
    const rawTextPreamble = split.reasoning;
    const extractedReasoning = reasoning
      ? rawTextPreamble
        ? `${reasoning}\n\n--- inline reasoning ---\n${rawTextPreamble}`
        : reasoning
      : rawTextPreamble;

    // Log the call details (reasoning = API extended-thinking only; rawTextPreamble = text before JSON)
    logCall({
      stepName,
      modelId,
      attempt: attempt + 1,
      maxAttempts: maxRetries + 1,
      latencyMs,
      usage,
      reasoning,
      rawTextLength: text.length,
      rawTextPreamble,
      systemPrompt,
      userPrompt,
      maxTokens,
      thinkingBudget: thinkingTokens,
    });

    // Try to parse JSON from the response
    try {
      const parsed = JSON.parse(jsonStr);
      const data = validate(parsed);
      return { data, modelId, rawText: text, reasoning: extractedReasoning };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      console.error(
        `[${stepName}] JSON parse/validation failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`,
      );

      if (attempt < maxRetries) {
        // Add the model's failed response and a correction request.
        // The assistant text may be empty when thinking consumed the entire response —
        // Bedrock rejects blank text fields, so fall back to a placeholder.
        const assistantText = rawText.trim() || '[empty response]';
        messages.push(
          {
            role: 'assistant',
            content: [{ text: assistantText }],
          },
          {
            role: 'user',
            content: [
              {
                text: `Your previous response was not valid JSON or failed validation. Error: ${lastError.message}\n\nPlease try again. Provide ONLY the corrected JSON with no other text.`,
              },
            ],
          },
        );
      }
    }
  }

  throw new Error(
    `callModel failed for step "${stepName}" after ${maxRetries + 1} attempts using model "${modelId}". ` +
    `Last error: ${lastError?.message}. Last raw response: ${rawText.slice(0, 500)}`,
  );
}

// ============================================
// Logging
// ============================================

/** CloudWatch log event size limit (256 KB). Chunk below this to avoid truncation. */
const CLOUDWATCH_MAX_EVENT_BYTES = 256 * 1024;
/** Chunk size in chars: leave headroom for UTF-8 and log line framing. */
const LOG_CHUNK_CHARS = 200_000;

/**
 * Log a potentially long string in chunks so no single event exceeds CloudWatch's limit.
 * Each chunk is prefixed with a header so readers can reassemble or skip.
 */
function logChunked(stepName: GenerationStep, label: string, body: string): void {
  if (!body) return;
  if (body.length <= LOG_CHUNK_CHARS) {
    console.log(`[${stepName}] --- ${label} ---`);
    console.log(body);
    console.log(`[${stepName}] --- End ${label} ---`);
    return;
  }
  const totalChunks = Math.ceil(body.length / LOG_CHUNK_CHARS);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * LOG_CHUNK_CHARS;
    const chunk = body.slice(start, start + LOG_CHUNK_CHARS);
    console.log(`[${stepName}] --- ${label} (chunk ${i + 1}/${totalChunks}) ---`);
    console.log(chunk);
  }
  console.log(`[${stepName}] --- End ${label} ---`);
}

interface LogCallParams {
  stepName: GenerationStep;
  modelId: string;
  attempt: number;
  maxAttempts: number;
  latencyMs: number;
  usage?: TokenUsage;
  reasoning: string;
  /** Length of full raw text (for token estimates). */
  rawTextLength: number;
  /** Portion of raw response up to where parsed JSON starts (preamble only; JSON omitted). */
  rawTextPreamble: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  thinkingBudget: number;
}

function logCall(params: LogCallParams): void {
  const {
    stepName,
    modelId,
    attempt,
    maxAttempts,
    latencyMs,
    usage,
    reasoning,
    rawTextLength,
    rawTextPreamble,
    systemPrompt,
    userPrompt,
    maxTokens,
    thinkingBudget,
  } = params;

  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? 0;

  // Estimate thinking vs text tokens from the response.
  // The Bedrock API reports total outputTokens (thinking + text combined).
  // We can approximate text tokens from the raw response length (~4 chars/token)
  // and infer thinking tokens as the remainder.
  const estimatedTextTokens = Math.ceil(rawTextLength / 4);
  const estimatedThinkingTokens = Math.max(0, outputTokens - estimatedTextTokens);

  // Utilisation percentages
  const outputUtilPct = maxTokens > 0 ? ((outputTokens / maxTokens) * 100).toFixed(1) : '0.0';
  const thinkingUtilPct = thinkingBudget > 0 ? ((estimatedThinkingTokens / thinkingBudget) * 100).toFixed(1) : '0.0';

  // Structured summary line with detailed token usage
  console.log(
    JSON.stringify({
      event: 'bedrock_call',
      step: stepName,
      model: modelId,
      attempt: `${attempt}/${maxAttempts}`,
      latencyMs,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: totalTokens,
        estimatedThinking: estimatedThinkingTokens,
        estimatedText: estimatedTextTokens,
      },
      budget: {
        maxTokens,
        thinkingBudget,
        outputUtilisation: `${outputUtilPct}%`,
        thinkingUtilisation: `${thinkingUtilPct}%`,
      },
    }),
  );

  // Prompts (chunked if needed to stay under CloudWatch limit)
  logChunked(stepName, 'System prompt', systemPrompt);
  logChunked(stepName, 'User prompt', userPrompt);

  // Reasoning (from extended thinking API)
  logChunked(stepName, 'Model reasoning (extended thinking)', reasoning);

  // Raw response preamble only (text before JSON; JSON omitted so you can inspect in output if needed)
  if (rawTextPreamble) {
    logChunked(stepName, 'Raw response preamble (before JSON)', rawTextPreamble);
  } else {
    console.log(`[${stepName}] --- Raw response preamble (before JSON) --- (none)`);
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Extract reasoning and text content from Bedrock Converse response content blocks.
 *
 * Extended thinking is always enabled, so the response contains separate
 * `reasoningContent` and `text` content blocks.
 */
function extractContent(content?: ContentBlock[]): { reasoning: string; text: string } {
  if (!content) return { reasoning: '', text: '' };

  const reasoningParts: string[] = [];
  const textParts: string[] = [];

  for (const block of content) {
    if ('reasoningContent' in block && block.reasoningContent) {
      // Extended thinking block
      const rc = block.reasoningContent;
      if ('reasoningText' in rc && rc.reasoningText?.text) {
        reasoningParts.push(rc.reasoningText.text);
      }
      // redactedContent blocks are encrypted — nothing useful to extract
    } else if ('text' in block && typeof block.text === 'string') {
      textParts.push(block.text);
    }
  }

  return {
    reasoning: reasoningParts.join('\n'),
    text: textParts.join(''),
  };
}

/**
 * Split a model response into reasoning preamble and JSON content.
 *
 * With extended thinking enabled, reasoning arrives in a separate API content
 * block and the text block should be pure JSON. This function is a safety net
 * in case the model wraps the JSON in a markdown fence or includes preamble.
 *
 * Strategy:
 *   1. Try the LAST markdown-fenced block that contains valid-looking JSON.
 *   2. Fall back to the LAST top-level `{` or `[` that successfully parses.
 *   3. If nothing works, return the whole text and let the caller's
 *      JSON.parse produce a clear error.
 */
function splitReasoningAndJson(text: string): { reasoning: string; jsonStr: string } {
  // 1. Try the LAST markdown-fenced JSON block whose content looks like JSON
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let lastFenceMatch: { fullMatchIndex: number; content: string; beforeFence: string } | undefined;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const candidate = match[1].trim();
    if (looksLikeJson(candidate)) {
      lastFenceMatch = {
        fullMatchIndex: match.index,
        content: candidate,
        beforeFence: text.slice(0, match.index).trim(),
      };
    }
  }

  if (lastFenceMatch) {
    return {
      reasoning: lastFenceMatch.beforeFence,
      jsonStr: lastFenceMatch.content,
    };
  }

  // 2. Find the LAST { or [ that starts valid JSON
  //    Walk backwards from the end to find a position that JSON.parse accepts.
  const lastObject = text.lastIndexOf('{');
  const lastArray = text.lastIndexOf('[');
  // Try the later position first (the one closer to the end of the string)
  const candidates = [lastObject, lastArray].filter((i) => i >= 0).sort((a, b) => b - a);

  for (const pos of candidates) {
    const slice = text.slice(pos).trim();
    try {
      JSON.parse(slice);
      // It parsed — this is our JSON
      return {
        reasoning: text.slice(0, pos).trim(),
        jsonStr: slice,
      };
    } catch {
      // Not valid JSON from this position, try the other candidate
    }
  }

  // 3. If parsing from the end failed, try the FIRST { or [ as a last resort
  //    (covers the case where the JSON is truncated / the model ran out of tokens)
  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');
  let jsonStart = -1;
  if (firstObject >= 0 && firstArray >= 0) {
    jsonStart = Math.min(firstObject, firstArray);
  } else if (firstObject >= 0) {
    jsonStart = firstObject;
  } else if (firstArray >= 0) {
    jsonStart = firstArray;
  }

  if (jsonStart >= 0) {
    return {
      reasoning: text.slice(0, jsonStart).trim(),
      jsonStr: text.slice(jsonStart).trim(),
    };
  }

  // No JSON-like content found — return as-is (JSON.parse will fail with a clear error)
  return { reasoning: '', jsonStr: text.trim() };
}

/** True if the string looks like the start of a JSON object or array. */
function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith('{') || t.startsWith('[')) && t.length > 1;
}
