import { z } from 'zod';

export const idSchema = z.string().min(1);
export const errorCodeSchema = z.string().startsWith('E_');
export const errorInfoSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  userMessageKey: z.string(),
  details: z.record(z.unknown()).optional(),
  recoverable: z.boolean(),
  at: z.string().datetime(),
});

export const envelopeSchema = z.object({
  v: z.literal(1),
  type: z.string().min(1),
  id: idSchema,
  payload: z.unknown(),
  from: z.enum(['sw', 'cs', 'offscreen', 'ui', 'external']).optional(),
});

export const replySchema = z.union([
  z.object({ v: z.literal(1), type: z.string().min(1), id: idSchema, ok: z.literal(true), payload: z.unknown() }),
  z.object({ v: z.literal(1), type: z.string().min(1), id: idSchema, ok: z.literal(false), error: errorInfoSchema }),
]);
