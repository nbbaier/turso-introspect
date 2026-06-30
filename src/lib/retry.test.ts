import { describe, expect, test } from "bun:test";
import { RetryError, withRetry } from "./retry.js";

describe("withRetry", () => {
	test("resolves immediately on first success", async () => {
		let calls = 0;
		const result = await withRetry(
			async () => {
				calls++;
				return "ok";
			},
			{ retries: 3, baseDelayMs: 0 },
		);

		expect(result).toBe("ok");
		expect(calls).toBe(1);
	});

	test("fails twice then succeeds", async () => {
		let calls = 0;
		const result = await withRetry(
			async () => {
				calls++;
				if (calls < 3) {
					throw new Error("transient");
				}
				return "ok";
			},
			{ retries: 3, baseDelayMs: 0 },
		);

		expect(result).toBe("ok");
		expect(calls).toBe(3);
	});

	test("throws RetryError when all attempts fail", async () => {
		const lastError = new Error("boom");
		let calls = 0;

		await expect(
			withRetry(
				async () => {
					calls++;
					throw lastError;
				},
				{ retries: 2, baseDelayMs: 0 },
			),
		).rejects.toThrow(RetryError);

		expect(calls).toBe(3);

		try {
			await withRetry(
				async () => {
					throw lastError;
				},
				{ retries: 2, baseDelayMs: 0 },
			);
		} catch (error) {
			expect(error).toBeInstanceOf(RetryError);
			expect((error as RetryError).message).toContain("after 3 attempts");
			expect((error as RetryError).cause).toBe(lastError);
		}
	});

	test("retries: 0 makes exactly one attempt", async () => {
		const lastError = new Error("boom");
		let calls = 0;

		try {
			await withRetry(
				async () => {
					calls++;
					throw lastError;
				},
				{ retries: 0, baseDelayMs: 0 },
			);
			throw new Error("should not resolve");
		} catch (error) {
			expect(error).toBeInstanceOf(RetryError);
			expect((error as RetryError).message).toContain("after 1 attempt");
		}

		expect(calls).toBe(1);
	});
});
