import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Invalid request', details?: unknown) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHENTICATED') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'Not allowed', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message = 'Conflict', code = 'CONFLICT') {
    return new ApiError(409, code, message);
  }
  static locked(message = 'Session locked') {
    return new ApiError(423, 'SESSION_LOCKED', message);
  }
  static tooMany(message = 'Too many requests') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
}

/** Wraps async route handlers so rejected promises reach the error middleware. */
export function ah<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some fields are invalid',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof ApiError) {
    // Surfaced so the abuse watcher can tell a CSRF/origin attack apart from an
    // ordinary permission error once the response has finished.
    res.locals.errorCode = err.code;
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  // body-parser rejections: an oversized or malformed payload is the client's
  // fault, and answering 500 would both mislead and hide a flood attempt.
  // Matched on several fields because the shape differs between raw-body and
  // body-parser versions.
  const parseErr = err as {
    type?: string;
    name?: string;
    status?: number;
    statusCode?: number;
    message?: string;
  };
  const parseStatus = parseErr?.status ?? parseErr?.statusCode;
  if (
    parseErr?.type === 'entity.too.large' ||
    parseErr?.name === 'PayloadTooLargeError' ||
    parseStatus === 413
  ) {
    res.locals.errorCode = 'PAYLOAD_TOO_LARGE';
    res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'That request body is too large.' },
    });
    return;
  }
  if (
    parseErr?.type === 'entity.parse.failed' ||
    parseErr?.type === 'encoding.unsupported' ||
    parseErr?.name === 'SyntaxError' ||
    parseStatus === 400
  ) {
    res.locals.errorCode = 'BAD_REQUEST';
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed request body.' } });
    return;
  }

  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === 'P2025') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
    return;
  }
  if (anyErr?.code === 'P2002') {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'That already exists' } });
    return;
  }

  // eslint-disable-next-line no-console
  console.error('[tarangos] unhandled error:', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
