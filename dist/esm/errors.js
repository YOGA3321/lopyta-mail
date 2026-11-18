export class LopytaGatewayError extends Error {
    statusCode;
    code;
    retryable;
    constructor(message, opts = {}) {
        super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
        this.name = new.target.name;
        this.statusCode = opts.statusCode;
        this.code = opts.code;
        this.retryable = opts.retryable ?? false;
    }
}
/**
 * Error sementara (network putus, timeout, HTTP 408 / 429 / 5xx saat gateway maintenance/lag).
 * Aman dan disarankan untuk di-retry oleh LopytaMailQueue hingga 24 jam.
 */
export class LopytaTransientError extends LopytaGatewayError {
    constructor(message, opts = {}) {
        super(message, { ...opts, retryable: true });
    }
}
/**
 * Error permanen dari sisi client (payload salah, Client Secret salah, client nonaktif/kedaluwarsa).
 * Tidak di-retry otomatis karena hasilnya akan tetap ditolak.
 */
export class LopytaClientError extends LopytaGatewayError {
    constructor(message, opts = {}) {
        super(message, { ...opts, retryable: false });
    }
}
export function isRetryableGatewayError(err) {
    if (err instanceof LopytaGatewayError) {
        return err.retryable;
    }
    return false;
}
