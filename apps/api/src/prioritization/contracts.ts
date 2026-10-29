import {
  IncidentPriorityOverrideSchema,
  IdentifierSchema,
} from '@cybernexus/shared';
import { z } from 'zod';

export const IncidentPriorityOverrideRequestSchema = z
  .object({
    priority: IncidentPriorityOverrideSchema,
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

export const EmptyPrioritizationRequestSchema = z
  .object({})
  .strict()
  .default({});

export const IncidentAuditQuerySchema = z
  .object({
    page: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .default('1')
      .transform(Number)
      .pipe(z.number().int().min(1).max(100)),
    pageSize: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .default('25')
      .transform(Number)
      .pipe(z.number().int().min(1).max(100)),
  })
  .strict();

export const IncidentIdParamsSchema = z
  .object({ incidentId: IdentifierSchema })
  .strict();
