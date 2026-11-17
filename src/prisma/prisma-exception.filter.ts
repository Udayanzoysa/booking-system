import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    let statusCode: number;
    let message: string;
    switch (error.code) {
      case 'P2002':
        statusCode = HttpStatus.CONFLICT;
        message = 'A record with those values already exists';
        break;
      case 'P2003':
        statusCode = HttpStatus.CONFLICT;
        message = 'The operation conflicts with a related record';
        break;
      case 'P2004':
        statusCode = HttpStatus.BAD_REQUEST;
        message = 'The operation violates a data constraint';
        break;
      case 'P2025':
        statusCode = HttpStatus.NOT_FOUND;
        message = 'Record not found';
        break;
      case 'P2034':
        statusCode = HttpStatus.CONFLICT;
        message = 'A concurrent update conflicted with this request. Retry the request';
        break;
      default:
        this.logger.error(`Prisma request failed with code ${error.code}`);
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        message = 'Database operation failed';
    }
    this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), { statusCode, message }, statusCode);
  }
}
