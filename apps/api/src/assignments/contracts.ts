import { IdentifierSchema } from '@cybernexus/shared';
import { z } from 'zod';

export const AssignmentScenarioSchema = z
  .object({
    newIncidents: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            requiredSkills: z
              .array(z.string().trim().min(1).max(80))
              .max(20)
              .nullable(),
            priority: z.enum([
              'critical',
              'high',
              'medium',
              'low',
              'unclassified',
            ]),
            deadlineAt: z.string().datetime({ offset: false }).nullable(),
            createdAt: z.string().datetime({ offset: false }),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    analystChanges: z
      .array(
        z
          .object({
            analystId: IdentifierSchema,
            availability: z.enum(['available', 'unavailable']).optional(),
            maxConcurrentAssignments: z
              .number()
              .int()
              .min(1)
              .max(1000)
              .optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    incidentChanges: z
      .array(
        z
          .object({
            incidentId: IdentifierSchema,
            requiredSkills: z
              .array(z.string().trim().min(1).max(80))
              .max(20)
              .optional(),
            priority: z
              .enum(['critical', 'high', 'medium', 'low', 'unclassified'])
              .optional(),
            deadlineAt: z.string().datetime({ offset: false }).optional(),
          })
          .strict(),
      )
      .max(500)
      .default([]),
  })
  .strict()
  .superRefine((scenario, context) => {
    const fields = [
      [
        'analystChanges',
        scenario.analystChanges.map(({ analystId }) => analystId),
      ],
      [
        'incidentChanges',
        scenario.incidentChanges.map(({ incidentId }) => incidentId),
      ],
      ['newIncidents', scenario.newIncidents.map(({ id }) => id)],
    ] as const;
    for (const [field, ids] of fields) {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Scenario identifiers must be unique.',
        });
      }
    }
  });
export type AssignmentScenario = z.infer<typeof AssignmentScenarioSchema>;

export const ManualAssignmentSchema = z
  .object({
    analystId: IdentifierSchema,
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

export const AssignmentRecommendationRequestSchema = z
  .object({
    incidentIds: z.array(IdentifierSchema).min(1).max(500).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.incidentIds &&
      new Set(request.incidentIds).size !== request.incidentIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['incidentIds'],
        message: 'Incident IDs must be unique.',
      });
    }
  });
