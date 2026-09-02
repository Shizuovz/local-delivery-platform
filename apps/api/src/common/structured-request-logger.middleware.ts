import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';

type RequestLike = {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
};

type ResponseLike = {
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
  on?: (event: 'finish', listener: () => void) => void;
};

@Injectable()
export class StructuredRequestLoggerMiddleware implements NestMiddleware {
  use(req: RequestLike, res: ResponseLike, next: () => void) {
    const startedAt = Date.now();
    const requestId = this.requestId(req);
    res.setHeader?.('x-request-id', requestId);

    res.on?.('finish', () => {
      this.log({
        level: this.levelForStatus(res.statusCode ?? 0),
        event: 'http.request',
        requestId,
        method: req.method,
        path: req.originalUrl ?? req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        userAgent: this.firstHeader(req.headers?.['user-agent']),
      });
    });

    next();
  }

  private requestId(req: RequestLike) {
    return this.firstHeader(req.headers?.['x-request-id']) ?? randomUUID();
  }

  private firstHeader(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }

  private levelForStatus(statusCode: number) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  private log(payload: Record<string, unknown>) {
    console.log(JSON.stringify({
      service: 'local-delivery-api',
      timestamp: new Date().toISOString(),
      ...payload,
    }));
  }
}
