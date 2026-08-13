// ============================================
// Retry helper for OCR provider calls (RSK-13 / task #18).
//
// OCR providers (Mistral, Pixtral, Claude) occasionally fail with
// transient errors — rate limits during bursty upload, 5xx blips,
// network hiccups. Without retry, a single transient failure kicks
// the whole invoice down to the next tier (or to human review) and
// costs either paid API credit or reviewer time. Retrying with
// exponential backoff absorbs those blips.
//
// Design:
//   • withRetry() is generic — caller supplies isRetryable(result)
//     so we can share the retry loop across providers with different
//     result shapes.
//   • isTransientOcrFailure() encodes the shared regex for 429 / 5xx /
//     network patterns embedded in provider error strings.
//   • Default: 3 attempts, exponential backoff (1s → 2s → 4s).
//   • Never retries on genuine bad input (4xx that isn't 429, JSON
//     parse failures, malformed PDF) — those aren't transient.
// ============================================

export interface RetryOptions<T> {
  /** Should we retry after seeing this result? */
  isRetryable: (result: T) => boolean;
  /** Total attempts including the first (default 3). */
  maxAttempts?: number;
  /** Base delay between attempts; doubles each retry (default 1000ms). */
  baseDelayMs?: number;
  /** Called before each retry, useful for logging. */
  onRetry?: (attempt: number, waitMs: number, result: T) => void;
}

/**
 * Run `fn` up to `maxAttempts` times, waiting with exponential backoff
 * between attempts. Returns the last result (successful or not).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions<T>,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let lastResult: T;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await fn();
    if (!opts.isRetryable(lastResult) || attempt === maxAttempts) {
      return lastResult;
    }
    const waitMs = baseDelayMs * Math.pow(2, attempt - 1);
    opts.onRetry?.(attempt, waitMs, lastResult);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  // Unreachable — the loop always returns — but TypeScript can't see that.
  return lastResult!;
}

/**
 * Standard "is this a transient OCR provider failure" detector.
 *
 * True when the extractor returned an error string that matches
 * common transient signals: HTTP 429 (rate limit), 5xx, timeouts,
 * connection resets, generic network failures.
 *
 * Returns false for successes, and for permanent 4xx errors like
 * "invalid API key" or "unsupported file format" — those won't
 * improve with a retry.
 */
export function isTransientOcrFailure(result: {
  success: boolean;
  error?: string;
}): boolean {
  if (result.success) return false;
  if (!result.error) return false;
  return /\b(429|5\d\d|timeout|timed out|ECONNRESET|ETIMEDOUT|network|connection reset|socket|fetch failed|rate.?limit|too many requests)\b/i.test(
    result.error,
  );
}
