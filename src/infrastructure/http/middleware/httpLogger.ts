import morgan from 'morgan';
import type { Express, Request, Response } from 'express';
import { resolveConversationId, resolveSessionUserId } from '../../../domain/bodyNormalizer';

export function setupHttpLogger(app: Express): void {
  morgan.token('request-id', (req) => (req as Request).requestId || '-');
  morgan.token('conversation-id', (req) =>
    resolveConversationId((req as Request).body),
  );
  morgan.token('session-user-id', (req) =>
    resolveSessionUserId((req as Request).body),
  );
  morgan.token('intent', (_req, res) => ((res as Response).locals.intent as string) || '-');
  morgan.token(
    'routed-step',
    (_req, res) => ((res as Response).locals.routedStep as string) || '-',
  );

  const format = [
    'ts=:date[iso]',
    'requestId=:request-id',
    'ip=:remote-addr',
    'method=:method',
    'url=":url"',
    'status=:status',
    'length=:res[content-length]',
    'responseTime=:response-time ms',
    'ua=":user-agent"',
    'conversationId=:conversation-id',
    'sessionUserId=:session-user-id',
    'intent=:intent',
    'step=":routed-step"',
  ].join(' ');

  app.use(morgan(format, { skip: (req) => req.path === '/health' }));
}
