import { PublicHttpError, transientFeedError } from "./network-retry.ts";

/** A deterministic content failure: retrying the same document cannot repair it. */
export class ArticleContentError extends Error {
  constructor(message: string) { super(message); this.name = "ArticleContentError"; }
}

/** Add reading-order context without discarding the underlying HTTP/error type. */
export class ArticlePreparationError extends Error {
  constructor(article: number, cause: unknown) {
    super(`Article ${article} could not be prepared: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "ArticlePreparationError";
  }
}

/** Preserve the existing three-attempt limit, but never retry permanent failures.
 * Unknown failures retain the conservative retry policy used for receipt repair.
 * Publisher Retry-After is a lower bound, not a suggestion to shorten the delay.
 */
export function jobRetryDelay(error: unknown, attempt: number): number | null {
  if (attempt >= 3) return null;
  let delay = Math.max(1, attempt) * 10 * 60_000;
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 8 && !seen.has(current); depth++) {
    seen.add(current);
    if (current instanceof ArticleContentError) return null;
    if (current instanceof PublicHttpError) {
      if (!transientFeedError(current)) return null;
      delay = Math.max(delay, current.retryAfterMs);
    }
    current = current.cause;
  }
  return delay;
}
