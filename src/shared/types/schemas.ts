import { z } from 'zod';

export const idSchema = z.string().min(1);
export const errorCodeSchema = z.string().startsWith('E_');
export const captureModeSchema = z.enum(['fullPage', 'visible', 'selection', 'element', 'selector', 'scrollContainer', 'iframe', 'infinite', 'allTabs', 'browserWindow']);
export const captureTriggerSchema = z.enum(['popup', 'shortcut', 'contextMenu', 'sidePanel', 'batch', 'recapture', 'api', 'monitor']);
export const captureRequestSchema = z.object({
  id: idSchema.optional(),
  mode: captureModeSchema,
  target: z.object({
    tabId: z.number().int().positive().optional(),
    windowId: z.number().int().optional(),
    frameId: z.number().int().nonnegative().optional(),
    selector: z.string().min(1).optional(),
    selectorIndex: z.number().int().nonnegative().optional(),
    rect: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }).optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    tabIds: z.array(z.number().int().positive()).optional(),
  }),
  options: z.object({
    backend: z.enum(['auto', 'visibleTab', 'debugger']),
    delayMs: z.number().nonnegative(),
    countdownOverlay: z.boolean(),
    hideFixedElements: z.enum(['auto', 'always', 'never']),
    hideScrollbars: z.boolean(),
  }).passthrough(),
  export: z.object({
    targets: z.array(z.string()),
    format: z.string(),
  }).passthrough(),
  presetId: idSchema.optional(),
  trigger: captureTriggerSchema,
  meta: z.object({
    batchId: idSchema.optional(),
    batchItemId: idSchema.optional(),
    recaptureOf: idSchema.optional(),
    monitorRuleId: idSchema.optional(),
  }).optional(),
});
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
