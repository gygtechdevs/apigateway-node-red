import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi';

export function createSwaggerRouter(): Router {
  const router = Router();

  router.use('/api/docs', swaggerUi.serve);
  router.get('/api/docs', swaggerUi.setup(openApiSpec));

  return router;
}
