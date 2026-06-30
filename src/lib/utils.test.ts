import { describe, expect, test } from "bun:test";
import { quoteIdent } from "./utils.js";

describe("quoteIdent", () => {
	test("wraps a plain name in double quotes", () => {
		expect(quoteIdent("users")).toBe('"users"');
	});

	test("doubles an embedded double quote", () => {
		expect(quoteIdent('a"b')).toBe('"a""b"');
	});

	test("wraps an empty string", () => {
		expect(quoteIdent("")).toBe('""');
	});
});
