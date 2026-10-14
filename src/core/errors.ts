export type ScalpelErrorCode =
  | "ATOMIC_FAILURE"
  | "BINARY_FILE_NOT_SUPPORTED"
  | "CONCURRENCY_CONFLICT"
  | "CROSS_DEVICE_MOVE_NOT_SUPPORTED"
  | "FILE_EXISTS"
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "HIDDEN_PATH_NOT_ALLOWED"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "INVALID_LINE_RANGE"
  | "INVALID_PATTERN"
  | "IO_ERROR"
  | "LOCK_TIMEOUT"
  | "MARKER_NOT_FOUND"
  | "MARKER_NOT_ALLOWED_IN_REPLACEMENT"
  | "PATH_OUTSIDE_ROOT"
  | "PERMISSION_DENIED"
  | "STRING_NOT_FOUND"
  | "STRING_NOT_UNIQUE"
  | "SYMLINK_NOT_ALLOWED"
  | "UNSUPPORTED_ENCODING";

export type ScalpelError = {
  code: ScalpelErrorCode;
  message: string;
  path?: string;
  details?: Record<string, unknown>;
};

export type SuccessResult<T> = {
  ok: true;
  data: T;
};

export type FailureResult = {
  ok: false;
  error: ScalpelError;
};

export type DomainResult<T> = SuccessResult<T> | FailureResult;

export function success<T>(data: T): SuccessResult<T> {
  return { ok: true, data };
}

export function failure(
  code: ScalpelErrorCode,
  message: string,
  path?: string,
  details?: Record<string, unknown>
): FailureResult {
  const error: ScalpelError = { code, message };
  if (path !== undefined) {
    error.path = path;
  }
  if (details !== undefined) {
    error.details = details;
  }

  return {
    ok: false,
    error
  };
}

// Maps an unexpected thrown error (usually a Node fs error) onto the Scalpel
// error contract so callers still get a code instead of a bare message.
export function failureFromError(error: unknown): FailureResult {
  const code = errorField(error, "code");
  const path = errorField(error, "path");
  const message = error instanceof Error ? error.message : String(error);
  const details = code === undefined ? undefined : { cause_code: code };

  if (code === "ENOENT") {
    return failure("FILE_NOT_FOUND", message, path, details);
  }
  if (code === "EACCES" || code === "EPERM") {
    return failure("PERMISSION_DENIED", message, path, details);
  }
  if (code === "EISDIR" || code === "ENOTDIR") {
    return failure("INVALID_INPUT", message, path, details);
  }

  return failure(code === undefined ? "INTERNAL_ERROR" : "IO_ERROR", message, path, details);
}

function errorField(error: unknown, field: "code" | "path"): string | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return undefined;
  }
  const value: unknown = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}
