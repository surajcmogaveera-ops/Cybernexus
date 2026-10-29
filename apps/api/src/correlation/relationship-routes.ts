import type { PrismaClient } from '@prisma/client';
import { ApiErrorResponseSchema } from '@cybernexus/shared';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { writeAuditEvent } from '../audit/write-audit-event.js';
import { requireScopes } from '../security/auth.js';
import { PersistedRelationshipSchema } from './contracts.js';
import { RelationshipStatusUpdateSchema } from '../incidents/contracts.js';

type Principal = { subject: string };

export function createRelationshipRouter(database: PrismaClient): Router {
  const router = Router();
  router.patch(
    '/:relationshipId/status',
    requireScopes('api:write'),
    (request, response, next) =>
      updateRelationship(request, response, next, database),
  );
  return router;
}

async function updateRelationship(
  request: Request,
  response: Response,
  next: NextFunction,
  database: PrismaClient,
): Promise<void> {
  const parsed = RelationshipStatusUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json(
      ApiErrorResponseSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Request did not match the supported relationship API format.',
          details: parsed.error.issues
            .slice(0, 100)
            .map(({ path, message }) => ({ path, message })),
        },
      }),
    );
    return;
  }
  try {
    const relationshipId =
      typeof request.params.relationshipId === 'string'
        ? request.params.relationshipId
        : undefined;
    if (!relationshipId) {
      response.status(404).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'NOT_FOUND',
            message: 'The requested relationship was not found.',
          },
        }),
      );
      return;
    }
    const relationship = await database.$transaction(async (transaction) => {
      const current = await transaction.alertRelationship.findUnique({
        where: { id: relationshipId },
      });
      if (!current) return null;
      const validTransition =
        current.status === 'proposed' || current.status === 'review_required';
      if (!validTransition || parsed.data.status === current.status) {
        throw new InvalidRelationshipTransitionError();
      }
      const result = await transaction.alertRelationship.updateMany({
        where: { id: current.id, status: current.status },
        data: { status: parsed.data.status },
      });
      if (result.count !== 1) throw new InvalidRelationshipTransitionError();
      await writeAuditEvent(transaction, {
        eventType: 'correlation.relationship.status_changed',
        targetType: 'AlertRelationship',
        targetId: current.id,
        actorId: (response.locals.principal as Principal).subject,
        metadata: {
          fromStatus: current.status,
          toStatus: parsed.data.status,
          relationshipType: current.relationshipType,
        },
      });
      return transaction.alertRelationship.findUnique({
        where: { id: current.id },
      });
    });
    if (!relationship) {
      response.status(404).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'NOT_FOUND',
            message: 'The requested relationship was not found.',
          },
        }),
      );
      return;
    }
    response.json(
      PersistedRelationshipSchema.parse({
        id: relationship.id,
        sourceAlertId: relationship.sourceAlertId,
        targetAlertId: relationship.targetAlertId,
        relationshipType: relationship.relationshipType,
        confidence: relationship.confidence,
        rationale: relationship.rationale,
        evidence: relationship.evidence,
        status: relationship.status,
        createdAt: relationship.createdAt.toISOString(),
      }),
    );
  } catch (error) {
    if (error instanceof InvalidRelationshipTransitionError) {
      response.status(409).json(
        ApiErrorResponseSchema.parse({
          error: {
            code: 'CONFLICT',
            message:
              'The requested relationship status transition is not allowed.',
          },
        }),
      );
      return;
    }
    next(error);
  }
}

export class InvalidRelationshipTransitionError extends Error {}
