import { badRequest } from '../utils/errors.js';

/**
 * Turns zod's built-in English ("String must contain at least 1 character(s)") into messages a
 * receptionist understands. Messages written in a schema (e.g. 'Enter a valid phone number') are kept.
 */
export function friendlyMessage(issue) {
  const m = issue.message || '';
  const isDefault = /^(Required|Invalid|Expected|String must|Number must|Array must|Unrecognized key)/.test(m);
  if (!isDefault) return m;
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null' ? 'This field is required.' : 'Please enter a valid value.';
    case 'too_small':
      if (issue.type === 'string') return Number(issue.minimum) <= 1 ? 'This field is required.' : `Enter at least ${issue.minimum} characters.`;
      if (issue.type === 'number') return issue.inclusive ? `Must be ${issue.minimum} or more.` : `Must be more than ${issue.minimum}.`;
      if (issue.type === 'array') return Number(issue.minimum) <= 1 ? 'Select at least one item.' : `Select at least ${issue.minimum} items.`;
      return 'Value is too small.';
    case 'too_big':
      if (issue.type === 'string') return `Keep it under ${Number(issue.maximum) + 1} characters.`;
      if (issue.type === 'number') return `Must be ${issue.maximum} or less.`;
      if (issue.type === 'array') return `Select at most ${issue.maximum} items.`;
      return 'Value is too large.';
    case 'invalid_string':
      if (issue.validation === 'email') return 'Enter a valid e-mail address, e.g. name@hospital.com.';
      if (issue.validation === 'url') return 'Enter a valid web address.';
      return 'Please check the format of this field.';
    case 'invalid_enum_value': return 'Please choose one of the options.';
    case 'invalid_date': return 'Enter a valid date.';
    case 'unrecognized_keys': return `Unexpected field(s): ${(issue.keys || []).join(', ')}.`;
    default: return 'Please check this field.';
  }
}

/**
 * Validates req[source] against a zod schema and replaces it with the parsed value.
 * Schemas are `.strict()` for bodies, so a client-supplied TenantId (or any unknown field) is rejected.
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: friendlyMessage(i) }));
    const formLevel = details.find((d) => !d.path);
    return next(badRequest(formLevel ? formLevel.message : 'Please correct the highlighted fields.', details));
  }
  if (source === 'query') req.validQuery = result.data;
  else req[source] = result.data;
  return next();
};
