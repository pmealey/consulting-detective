import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type TokenUsage,
} from '@aws-sdk/client-bedrock-runtime';
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
  /** Max tokens for the response. Defaults to 4096. */
  maxTokens?: number;
  /** Temperature. Defaults to 0.7 for creative generation. */
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
    maxTokens = 4096,
    temperature = 0.7,
    maxRetries = 2,
  } = options;

  const modelId = resolveModelId(stepName, modelConfig);

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

    const command = new ConverseCommand({
      modelId,
      system: [{ text: systemPrompt }],
      messages,
      inferenceConfig: {
        maxTokens,
        temperature,
      },
    });

    const response = await client.send(command);
    const latencyMs = Date.now() - startMs;

    // Extract text from the response
    rawText = extractText(response.output?.message?.content);
    const usage = response.usage;

    // Split reasoning preamble from JSON
    const { reasoning, jsonStr } = splitReasoningAndJson(rawText);

    // Log the call details
    logCall({
      stepName,
      modelId,
      attempt: attempt + 1,
      maxAttempts: maxRetries + 1,
      latencyMs,
      usage,
      reasoning,
      rawText,
    });

    // Try to parse JSON from the response
    try {
      const parsed = JSON.parse(jsonStr);
      const data = validate(parsed);
      return { data, modelId, rawText, reasoning };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      console.error(
        `[${stepName}] JSON parse/validation failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`,
      );

      if (attempt < maxRetries) {
        // Add the model's failed response and a correction request
        messages.push(
          {
            role: 'assistant',
            content: [{ text: rawText }],
          },
          {
            role: 'user',
            content: [
              {
                text: `Your previous response was not valid JSON or failed validation. Error: ${lastError.message}\n\nPlease try again. Think through the fix briefly, then provide the corrected JSON.`,
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

interface LogCallParams {
  stepName: GenerationStep;
  modelId: string;
  attempt: number;
  maxAttempts: number;
  latencyMs: number;
  usage?: TokenUsage;
  reasoning: string;
  rawText: string;
}

function logCall(params: LogCallParams): void {
  const { stepName, modelId, attempt, maxAttempts, latencyMs, usage, reasoning, rawText } = params;

  // Structured summary line
  console.log(
    JSON.stringify({
      event: 'bedrock_call',
      step: stepName,
      model: modelId,
      attempt: `${attempt}/${maxAttempts}`,
      latencyMs,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    }),
  );

  // Reasoning preamble (the interesting part — the model's creative thinking)
  if (reasoning) {
    console.log(`[${stepName}] --- Model reasoning ---`);
    console.log(reasoning);
    console.log(`[${stepName}] --- End reasoning ---`);
  }

  // Full raw response (truncated for very long outputs)
  const maxRawLogLength = 5000;
  if (rawText.length > maxRawLogLength) {
    console.log(`[${stepName}] --- Raw response (truncated to ${maxRawLogLength} chars) ---`);
    console.log(rawText.slice(0, maxRawLogLength) + '...');
  } else {
    console.log(`[${stepName}] --- Raw response ---`);
    console.log(rawText);
  }
  console.log(`[${stepName}] --- End raw response ---`);
}

// ============================================
// Helpers
// ============================================

/** Extract text content from Bedrock Converse response content blocks */
function extractText(content?: ContentBlock[]): string {
  if (!content) return '';
  return content
    .map((block) => {
      if ('text' in block && typeof block.text === 'string') return block.text;
      return '';
    })
    .join('');
}

/**
 * Split a model response into reasoning preamble and JSON content.
 *
 * The model is encouraged to think before producing JSON. This function
 * finds the JSON portion and returns everything before it as reasoning.
 */
function splitReasoningAndJson(text: string): { reasoning: string; jsonStr: string } {
  // Try markdown-fenced JSON block — everything before the fence is reasoning
  const fenceMatch = text.match(/^([\s\S]*?)```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return {
      reasoning: fenceMatch[1].trim(),
      jsonStr: fenceMatch[2].trim(),
    };
  }

  // Try to find the first { or [ that starts the JSON
  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');

  let jsonStart = -1;
  if (objectStart >= 0 && arrayStart >= 0) {
    jsonStart = Math.min(objectStart, arrayStart);
  } else if (objectStart >= 0) {
    jsonStart = objectStart;
  } else if (arrayStart >= 0) {
    jsonStart = arrayStart;
  }

  if (jsonStart > 0) {
    const reasoning = text.slice(0, jsonStart).trim();
    const jsonStr = text.slice(jsonStart).trim();
    return { reasoning, jsonStr };
  }

  // No preamble found — the whole thing is (hopefully) JSON
  return { reasoning: '', jsonStr: text.trim() };
}
