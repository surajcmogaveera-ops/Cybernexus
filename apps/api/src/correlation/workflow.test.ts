import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CorrelationRequestSchema,
  CorrelationResultSchema,
} from '@cybernexus/shared';
import {
  InvalidCorrelationServiceResponseError,
  validateServiceEvidence,
} from './workflow.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/shared/fixtures/correlation-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { request: unknown; result: unknown };

describe('correlation service evidence boundary', () => {
  it('accepts candidate evidence only when references match both input alerts', () => {
    const request = CorrelationRequestSchema.parse(fixture.request);
    const result = CorrelationResultSchema.parse(fixture.result);
    expect(() =>
      validateServiceEvidence(request.alerts, result.relationships),
    ).not.toThrow();
  });

  it('rejects fabricated fields, wrong scores, unreviewed IP-only links, and accepted service decisions', () => {
    const request = CorrelationRequestSchema.parse(fixture.request);
    const result = CorrelationResultSchema.parse(fixture.result);
    const candidate = result.relationships[0]!;
    const forgedEvidence = {
      ...candidate,
      evidence: [
        {
          ...candidate.evidence[0]!,
          sourceField: 'payload.adminIdentity',
        },
      ],
    };
    expect(() =>
      validateServiceEvidence(request.alerts, [forgedEvidence]),
    ).toThrow(InvalidCorrelationServiceResponseError);
    expect(() =>
      validateServiceEvidence(request.alerts, [
        { ...candidate, confidence: 0.99 },
      ]),
    ).toThrow(InvalidCorrelationServiceResponseError);
    expect(() =>
      validateServiceEvidence(request.alerts, [
        { ...candidate, status: 'accepted' },
      ]),
    ).toThrow(InvalidCorrelationServiceResponseError);
  });
});
