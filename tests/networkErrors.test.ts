import { describe, expect, test } from "vitest";
import {
    classifyHttpError,
    isNetworkError,
    NetworkError,
} from "../src/networkErrors";

// ── NetworkError class ───────────────────────────────────────────

describe("NetworkError", () => {
    test("has name 'NetworkError'", () => {
        const err = new NetworkError("test message");
        expect(err.name).toBe("NetworkError");
    });

    test("message is preserved", () => {
        const err = new NetworkError("No connection available");
        expect(err.message).toBe("No connection available");
    });

    test("is instance of Error", () => {
        const err = new NetworkError("test");
        expect(err).toBeInstanceOf(Error);
    });
});

// ── isNetworkError type guard ────────────────────────────────────

describe("isNetworkError", () => {
    test("returns true for NetworkError instances", () => {
        const err = new NetworkError("no network");
        expect(isNetworkError(err)).toBe(true);
    });

    test("returns false for regular Error", () => {
        expect(isNetworkError(new Error("boom"))).toBe(false);
    });

    test("returns false for non-Error values", () => {
        expect(isNetworkError("string error")).toBe(false);
        expect(isNetworkError(42)).toBe(false);
        expect(isNetworkError(null)).toBe(false);
        expect(isNetworkError(undefined)).toBe(false);
    });
});

// ── classifyHttpError ────────────────────────────────────────────

describe("classifyHttpError", () => {
    test("detects DNS resolution failure", () => {
        const err = new Error("ENOTFOUND github.com");
        const result = classifyHttpError(err);
        expect(result).toBe("dns");
    });

    test("detects connection refused", () => {
        const err = new Error("connect ECONNREFUSED 10.0.0.1:443");
        const result = classifyHttpError(err);
        expect(result).toBe("connection-refused");
    });

    test("detects timeout", () => {
        const err = new Error("ETIMEDOUT connecting to github.com:443");
        const result = classifyHttpError(err);
        expect(result).toBe("timeout");
    });

    test("detects connection reset", () => {
        const err = new Error("read ECONNRESET");
        const result = classifyHttpError(err);
        expect(result).toBe("connection-reset");
    });

    test("detects unreachable host", () => {
        const err = new Error("EHOSTUNREACH");
        const result = classifyHttpError(err);
        expect(result).toBe("unreachable");
    });

    test("detects TLS/SSL errors", () => {
        const sslErrors = [
            "self signed certificate",
            "certificate has expired",
            "unable to verify the first certificate",
            "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        ];
        for (const msg of sslErrors) {
            const result = classifyHttpError(new Error(msg));
            expect(result).toBe("tls");
        }
    });

    test("detects HTTP 401 as auth error", () => {
        const err = new Error("HTTP Error: 401 Unauthorized");
        const result = classifyHttpError(err);
        expect(result).toBe("auth");
    });

    test("detects HTTP 403 as auth error", () => {
        const err = new Error("HTTP Error: 403 Forbidden");
        const result = classifyHttpError(err);
        expect(result).toBe("auth");
    });

    test("detects HTTP 404 as not-found", () => {
        const err = new Error("HTTP Error: 404 Not Found");
        const result = classifyHttpError(err);
        expect(result).toBe("not-found");
    });

    test("detects HTTP 5xx as server error", () => {
        for (const code of [500, 502, 503, 504]) {
            const err = new Error(`HTTP Error: ${code} Server Error`);
            const result = classifyHttpError(err);
            expect(result).toBe("server-error");
        }
    });

    test("returns 'unknown' for unrecognized errors", () => {
        const err = new Error("Something completely unexpected happened");
        const result = classifyHttpError(err);
        expect(result).toBe("unknown");
    });

    test("returns 'unknown' for non-Error inputs", () => {
        expect(classifyHttpError("just a string")).toBe("unknown");
        expect(classifyHttpError(null)).toBe("unknown");
    });

    test("case insensitive matching", () => {
        expect(classifyHttpError(new Error("enotfound host"))).toBe("dns");
        expect(classifyHttpError(new Error("Econnrefused"))).toBe(
            "connection-refused"
        );
        expect(classifyHttpError(new Error("Etimedout"))).toBe("timeout");
    });
});

// ── User-friendly messages ───────────────────────────────────────

describe("NetworkError user-friendly messages", () => {
    test("dns error produces clear message", () => {
        const err = new NetworkError("No network connection — unable to resolve host.");
        expect(err.message).toContain("network");
    });

    test("timeout suggests checking connection", () => {
        const err = new NetworkError("Network request timed out. Check your connection and try again.");
        expect(err.message).toContain("time");
    });

    test("auth error does not use NetworkError", () => {
        // Auth errors should NOT be classified as network errors
        const classified = classifyHttpError(new Error("HTTP 401"));
        expect(classified).toBe("auth");

        const authError = new Error("HTTP 401");
        expect(isNetworkError(authError)).toBe(false);
    });
});

// ── Response size limiting ───────────────────────────────────────

describe("HTTP response size limiting", () => {
    // TDD: These tests define the behavior for limiting HTTP response sizes
    // to prevent OOM on memory-constrained mobile devices.

    test.todo(
        "throws ResponseTooLargeError when response exceeds max size"
    );

    test.todo(
        "allows response within size limit to pass through"
    );

    test.todo(
        "max size is configurable (default 100MB for mobile)"
    );

    test.todo(
        "reports actual size and limit in error message"
    );
});
