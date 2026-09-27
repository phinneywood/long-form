/** Bounded retries for idempotent feed reads; never relax URL/security checks. */
export class PublicHttpError extends Error {
  constructor(public status: number, public retryAfterMs = 0) {
    super(`The publisher returned HTTP ${status}.`);
    this.name = "PublicHttpError";
  }
}

export function retryAfterMillis(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

export function transientFeedError(error: unknown): boolean {
  if (error instanceof PublicHttpError) return [408, 429, 500, 502, 503, 504].includes(error.status);
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" || error.message === "The publisher took too long to respond.");
}

export async function retryFeedRead<T>(operation: () => Promise<T>, options: {
  deadline: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: () => void;
}): Promise<T> {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  try { return await operation(); }
  catch (error) {
    if (!transientFeedError(error)) throw error;
    const delay = Math.max(300, error instanceof PublicHttpError ? error.retryAfterMs : 0);
    // Do not shorten a publisher's Retry-After. Skip a retry that cannot fit.
    if (delay > 2000 || now() + delay + 1000 >= options.deadline) throw error;
    await sleep(delay);
    if (now() + 1000 >= options.deadline) throw error;
    options.onRetry?.();
    return await operation(); // Exactly one retry; no recursive/unbounded loop.
  }
}
