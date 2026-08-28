import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import { DomainError } from './domain-errors';

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
  timestamp: string;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse();
    const request = context.getRequest();
    const requestId = request.headers?.['x-request-id'];
    const { statusCode, body } = this.toErrorBody(exception, typeof requestId === 'string' ? requestId : undefined);

    response.status(statusCode).json(body);
  }

  private toErrorBody(exception: unknown, requestId?: string): { statusCode: number; body: ApiErrorBody } {
    if (exception instanceof DomainError) {
      return {
        statusCode: exception.statusCode,
        body: this.body(exception.code, exception.message, requestId),
      };
    }

    if (exception instanceof ZodError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        body: this.body('VALIDATION_ERROR', 'Request validation failed', requestId, exception.flatten()),
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === 'object' && response !== null && 'message' in response
        ? response.message
        : exception.message;
      return {
        statusCode,
        body: this.body(
          'HTTP_ERROR',
          Array.isArray(message) ? message.join(', ') : String(message),
          requestId,
          response,
        ),
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      body: this.body('INTERNAL_ERROR', 'Internal server error', requestId),
    };
  }

  private body(code: string, message: string, requestId?: string, details?: unknown): ApiErrorBody {
    return {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
      ...(requestId ? { requestId } : {}),
      timestamp: new Date().toISOString(),
    };
  }
}
