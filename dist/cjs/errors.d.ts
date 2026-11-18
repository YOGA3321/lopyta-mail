export declare class LopytaGatewayError extends Error {
    readonly statusCode?: number;
    readonly code?: string;
    readonly retryable: boolean;
    constructor(message: string, opts?: {
        statusCode?: number;
        code?: string;
        retryable?: boolean;
        cause?: unknown;
    });
}
/**
 * Error sementara (network putus, timeout, HTTP 408 / 429 / 5xx saat gateway maintenance/lag).
 * Aman dan disarankan untuk di-retry oleh LopytaMailQueue hingga 24 jam.
 */
export declare class LopytaTransientError extends LopytaGatewayError {
    constructor(message: string, opts?: {
        statusCode?: number;
        code?: string;
        cause?: unknown;
    });
}
/**
 * Error permanen dari sisi client (payload salah, Client Secret salah, client nonaktif/kedaluwarsa).
 * Tidak di-retry otomatis karena hasilnya akan tetap ditolak.
 */
export declare class LopytaClientError extends LopytaGatewayError {
    constructor(message: string, opts?: {
        statusCode?: number;
        code?: string;
        cause?: unknown;
    });
}
export declare function isRetryableGatewayError(err: unknown): boolean;
