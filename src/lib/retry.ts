function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return String(error);
}

export interface RetryOptions {
	retries: number;
	baseDelayMs: number;
}

export class RetryError extends Error {
	constructor(
		message: string,
		public cause: unknown,
	) {
		super(message);
		this.name = "RetryError";
	}
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions,
): Promise<T> {
	const retries = Math.max(0, options.retries);
	const baseDelayMs = Math.max(0, options.baseDelayMs);

	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (error: unknown) {
			lastError = error;
			if (attempt >= retries) break;

			const delayMs = baseDelayMs * 2 ** attempt;
			if (delayMs > 0) {
				await sleep(delayMs);
			}
		}
	}

	const attempts = retries + 1;
	throw new RetryError(
		`Operation failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${errorMessage(lastError)}`,
		lastError,
	);
}

