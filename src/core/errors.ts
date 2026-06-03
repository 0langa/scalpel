export type ScalpelErrorCode =
  | "ATOMIC_FAILURE"
  | "CONCURRENCY_CONFLICT"
  | "FILE_EXISTS"
  | "FILE_NOT_FOUND"
  | "HIDDEN_PATH_NOT_ALLOWED"
  | "INVALID_LINE_RANGE"
  | "INVALID_PATTERN"
  | "MARKER_NOT_FOUND"
  | "MARKER_NOT_ALLOWED_IN_REPLACEMENT"
  | "PATH_OUTSIDE_ROOT"
  | "PERMISSION_DENIED"
  | "STRING_NOT_FOUND"
  | "STRING_NOT_UNIQUE"
  | "SYMLINK_NOT_ALLOWED";

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
