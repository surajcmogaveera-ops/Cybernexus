import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { IdentifierSchema } from '@cybernexus/shared';

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const AuditEventInputSchema = z
  .object({
    eventType: z.string().trim().min(1).max(120),
    targetType: z.string().trim().min(1).max(120),
    targetId: IdentifierSchema,
    actorId: z.string().trim().min(1).max(120),
    metadata: z.record(z.string(), JsonValueSchema).optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (
      event.metadata &&
      Buffer.byteLength(JSON.stringify(event.metadata), 'utf8') > 8_192
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Audit metadata exceeds the configured size limit.',
      });
    }
  });

type AuditEventTransaction = Pick<Prisma.TransactionClient, 'auditEvent'> & {
  /** Prevent the root PrismaClient (which exposes $transaction) being passed. */
  $transaction?: never;
};

/** Write an audit event through the caller's transaction with the business action. */
export async function writeAuditEvent(
  transaction: AuditEventTransaction,
  input: z.input<typeof AuditEventInputSchema>,
): Promise<{ id: string }> {
  const event = AuditEventInputSchema.parse(input);
  return transaction.auditEvent.create({
    data: {
      id: randomUUID(),
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      actorId: event.actorId,
      occurredAt: new Date(),
      ...(event.metadata
        ? { metadata: event.metadata as Prisma.InputJsonObject }
        : {}),
    },
    select: { id: true },
  });
}
