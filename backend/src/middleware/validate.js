import { badRequest } from '../utils/errors.js';

/**
 * Validates req[source] against a zod schema and replaces it with the parsed value.
 * Schemas are `.strict()` for bodies, so a client-supplied TenantId (or any unknown field) is rejected.
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(badRequest('Validation failed.', details));
  }
  if (source === 'query') req.validQuery = result.data;
  else req[source] = result.data;
  return next();
};
