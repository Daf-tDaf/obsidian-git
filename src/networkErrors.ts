export class NetworkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "NetworkError";
    }
}

export function isNetworkError(err: unknown): err is NetworkError {
    return err instanceof NetworkError;
}

export type ErrorClassification =
    | "dns"
    | "connection-refused"
    | "connection-reset"
    | "timeout"
    | "unreachable"
    | "tls"
    | "auth"
    | "not-found"
    | "server-error"
    | "unknown";

/**
 * Classify an error from an HTTP request or isomorphic-git operation
 * into a standard category. Use this to provide user-friendly messages
 * and to decide whether to enter "offline mode".
 */
export function classifyHttpError(err: unknown): ErrorClassification {
    const message = getErrorMessage(err).toLowerCase();

    if (
        message.includes("enotfound") ||
        message.includes("could not resolve host") ||
        message.includes("unable to resolve host") ||
        message.includes("dns")
    ) {
        return "dns";
    }

    if (
        message.includes("econnrefused") ||
        message.includes("connection refused") ||
        message.includes("unable to open connection")
    ) {
        return "connection-refused";
    }

    if (
        message.includes("econnreset") ||
        message.includes("connection reset") ||
        message.includes("socket hang up")
    ) {
        return "connection-reset";
    }

    if (
        message.includes("etimedout") ||
        message.includes("timeout") ||
        message.includes("timed out")
    ) {
        return "timeout";
    }

    if (
        message.includes("ehostunreach") ||
        message.includes("no route to host") ||
        message.includes("unreachable")
    ) {
        return "unreachable";
    }

    if (
        message.includes("self signed certificate") ||
        message.includes("certificate has expired") ||
        message.includes("unable to verify the first certificate") ||
        message.includes("unable_to_verify_leaf_signature") ||
        message.includes("ssl") ||
        message.includes("tls")
    ) {
        return "tls";
    }

    if (
        message.includes("http error: 401") ||
        message.includes("http 401") ||
        message.includes("http error: 403") ||
        message.includes("http 403")
    ) {
        return "auth";
    }

    if (
        message.includes("http error: 404") ||
        message.includes("http 404")
    ) {
        return "not-found";
    }

    if (
        /http (error: )?5\d\d/.test(message) ||
        message.includes("server error")
    ) {
        return "server-error";
    }

    return "unknown";
}

/**
 * Returns true if the error classification indicates a transient network
 * failure (not auth, not found, not server errors which are permanent).
 */
export function isTransientError(classification: ErrorClassification): boolean {
    return (
        classification === "dns" ||
        classification === "connection-refused" ||
        classification === "connection-reset" ||
        classification === "timeout" ||
        classification === "unreachable" ||
        classification === "tls"
    );
}

/**
 * Returns a short message for a classification, used when building
 * NetworkError messages in the HTTP client.
 */
export function isTransientMessage(classification: ErrorClassification): string {
    switch (classification) {
        case "dns":
            return "unable to resolve host";
        case "connection-refused":
            return "connection refused";
        case "connection-reset":
            return "connection reset";
        case "timeout":
            return "request timed out";
        case "unreachable":
            return "host unreachable";
        case "tls":
            return "TLS/SSL error";
        default:
            return "network error";
    }
}

/**
 * Returns a user-friendly message for a given error classification.
 */
export function userFriendlyMessage(classification: ErrorClassification): string {
    switch (classification) {
        case "dns":
            return "No network connection — unable to resolve host.";
        case "connection-refused":
            return "Connection refused by the server. Check that the remote URL is correct.";
        case "connection-reset":
            return "Connection was reset. This may be a network interruption.";
        case "timeout":
            return "Network request timed out. Check your connection and try again.";
        case "unreachable":
            return "Host is unreachable. Check your network connection.";
        case "tls":
            return "SSL/TLS certificate error. The server's certificate may be invalid.";
        case "auth":
            return "Authentication failed. Check your username and password/token.";
        case "not-found":
            return "Remote repository not found. Check the URL.";
        case "server-error":
            return "The remote server encountered an error. Try again later.";
        case "unknown":
            return "An unexpected network error occurred.";
    }
}

function getErrorMessage(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err ?? "");
}

export class ResponseTooLargeError extends Error {
    readonly actualSize: number;
    readonly maxSize: number;

    constructor(actualSize: number, maxSize: number) {
        super(
            `Response size (${formatBytes(actualSize)}) exceeds maximum allowed size (${formatBytes(maxSize)}). ` +
                "Try using a shallow clone (specify depth) or syncing fewer files."
        );
        this.name = "ResponseTooLargeError";
        this.actualSize = actualSize;
        this.maxSize = maxSize;
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
