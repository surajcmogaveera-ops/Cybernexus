import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AnalysisRequestSchema,
  AnalysisFindingSchema,
  AnalysisResultSchema,
  CorrelationRequestSchema,
  CorrelationResultSchema,
  ApiGatewayErrorResponseSchema,
  ApiSessionResponseSchema,
  ApiErrorResponseSchema,
  ContractVersionSchema,
  HealthResponseSchema,
  IdentifierSchema,
  PaginationRequestSchema,
  PaginationResponseSchema,
  UtcTimestampSchema,
} from './index.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/contracts-v1.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const correlationFixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/correlation-v1.json', import.meta.url),
    'utf8',
  ),
) as { request: unknown; result: unknown };

describe('shared v1 contract fixtures', () => {
  it('validates the same TypeScript/Pydantic correlation wire fixtures', () => {
    expect(CorrelationRequestSchema.parse(correlationFixture.request)).toEqual(
      correlationFixture.request,
    );
    expect(CorrelationResultSchema.parse(correlationFixture.result)).toEqual(
      correlationFixture.result,
    );
    const request = correlationFixture.request as Record<string, unknown>;
    expect(
      CorrelationRequestSchema.safeParse({ ...request, contractVersion: 'v2' })
        .success,
    ).toBe(false);
    const result = correlationFixture.result as Record<string, unknown>;
    const [candidate] = result.relationships as Record<string, unknown>[];
    expect(
      CorrelationResultSchema.safeParse({
        ...result,
        relationships: [{ ...candidate, evidence: [] }],
      }).success,
    ).toBe(false);
    expect(
      CorrelationResultSchema.safeParse({
        ...result,
        relationships: [{ ...candidate, confidence: 1.1 }],
      }).success,
    ).toBe(false);
  });

  it('accepts the same deterministic shared examples', () => {
    expect(IdentifierSchema.parse(fixture.identifier)).toBe(fixture.identifier);
    expect(UtcTimestampSchema.parse(fixture.timestamp)).toBe(fixture.timestamp);
    expect(HealthResponseSchema.parse(fixture.health)).toEqual(fixture.health);
    expect(ApiErrorResponseSchema.parse(fixture.error)).toEqual(fixture.error);
    expect(ApiErrorResponseSchema.parse(fixture.conflictError)).toEqual(
      fixture.conflictError,
    );
    expect(PaginationRequestSchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(PaginationRequestSchema.parse(fixture.paginationRequest)).toEqual(
      fixture.paginationRequest,
    );
    expect(
      PaginationResponseSchema.parse(fixture.emptyPaginationResponse),
    ).toEqual(fixture.emptyPaginationResponse);
    expect(AnalysisRequestSchema.parse(fixture.analysisRequest)).toEqual(
      fixture.analysisRequest,
    );
    expect(AnalysisResultSchema.parse(fixture.analysisResult)).toEqual(
      fixture.analysisResult,
    );
  });

  it('keeps optional non-null fields omittable but rejects explicit null', () => {
    const request = fixture.analysisRequest as Record<string, unknown>;
    const requestWithoutContext = { ...request };
    delete requestWithoutContext.context;
    expect(
      AnalysisRequestSchema.parse(requestWithoutContext),
    ).not.toHaveProperty('context');
    expect(
      AnalysisRequestSchema.safeParse({ ...request, context: null }).success,
    ).toBe(false);

    const finding = (fixture.analysisResult as { findings: object[] })
      .findings[0] as Record<string, unknown>;
    const findingWithoutUncertainty = { ...finding };
    delete findingWithoutUncertainty.uncertainty;
    expect(
      AnalysisFindingSchema.parse(findingWithoutUncertainty),
    ).not.toHaveProperty('uncertainty');
    expect(
      AnalysisFindingSchema.safeParse({ ...finding, uncertainty: null })
        .success,
    ).toBe(false);

    const errorWithoutDetails = ApiErrorResponseSchema.parse({
      error: { code: 'NOT_FOUND', message: 'Missing.' },
    });
    expect(JSON.parse(JSON.stringify(errorWithoutDetails))).toEqual({
      error: { code: 'NOT_FOUND', message: 'Missing.' },
    });
    expect(
      ApiErrorResponseSchema.safeParse({
        error: { code: 'NOT_FOUND', message: 'Missing.', details: null },
      }).success,
    ).toBe(false);

    const pageWithoutTotal = {
      items: [],
      page: 1,
      pageSize: 25,
      hasNext: false,
    };
    expect(PaginationResponseSchema.parse(pageWithoutTotal)).not.toHaveProperty(
      'totalItems',
    );
    expect(
      PaginationResponseSchema.safeParse({
        ...pageWithoutTotal,
        totalItems: null,
      }).success,
    ).toBe(false);

    const result = fixture.analysisResult as Record<string, unknown>;
    expect(AnalysisResultSchema.parse(result)).not.toHaveProperty(
      'abstentionReason',
    );
    expect(
      AnalysisResultSchema.safeParse({ ...result, abstentionReason: null })
        .success,
    ).toBe(false);
  });

  it('applies trimmed text limits to content after surrounding whitespace is removed', () => {
    const cases = fixture.trimmedTextCases as {
      maximumLength: number;
      character: string;
      prefix: string;
      suffix: string;
      emptyWhitespace: string;
    };
    const result = fixture.analysisResult as Record<string, unknown>;
    const exact = cases.character.repeat(cases.maximumLength);
    const withWhitespace = `${cases.prefix}${exact}${cases.suffix}`;
    const over = cases.character.repeat(cases.maximumLength + 1);

    expect(
      AnalysisResultSchema.safeParse({
        ...result,
        missingInformation: [withWhitespace],
        recommendedNextSteps: [withWhitespace],
      }).success,
    ).toBe(true);
    expect(
      AnalysisResultSchema.safeParse({
        ...result,
        missingInformation: [over],
        recommendedNextSteps: [over],
      }).success,
    ).toBe(false);
    for (const field of [
      'missingInformation',
      'recommendedNextSteps',
    ] as const) {
      expect(
        AnalysisResultSchema.safeParse({
          ...result,
          [field]: [cases.emptyWhitespace],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects malformed identifiers, dates, and unsupported versions', () => {
    expect(IdentifierSchema.parse('00000000-0000-0000-0000-000000000000')).toBe(
      '00000000-0000-0000-0000-000000000000',
    );
    for (const id of ['not-a-uuid']) {
      expect(IdentifierSchema.safeParse(id).success).toBe(false);
    }
    for (const timestamp of [
      '2026-02-30T08:15:00Z',
      '2026-10-28T08:15:00',
      '2026-10-28T08:15:00+00:00',
      '2026-10-28T13:45:00+05:30',
    ]) {
      expect(UtcTimestampSchema.safeParse(timestamp).success).toBe(false);
    }
    expect(ContractVersionSchema.safeParse('v2').success).toBe(false);
    expect(
      AnalysisRequestSchema.safeParse({
        ...(fixture.analysisRequest as object),
        contractVersion: 'v2',
      }).success,
    ).toBe(false);
  });

  it('enforces strict errors and bounded offset pagination', () => {
    expect(
      ApiErrorResponseSchema.safeParse({ error: { code: '', message: 'x' } })
        .success,
    ).toBe(false);
    expect(
      ApiErrorResponseSchema.safeParse({
        error: { code: 'X', message: 'x', stack: 'secret' },
      }).success,
    ).toBe(false);
    expect(PaginationRequestSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(PaginationRequestSchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
    expect(PaginationRequestSchema.safeParse({ page: '2' }).success).toBe(
      false,
    );
    expect(
      PaginationResponseSchema.safeParse({
        items: [],
        page: 1,
        pageSize: 25,
        hasNext: false,
        totalItems: -1,
      }).success,
    ).toBe(false);
  });

  it('validates Express gateway errors and authenticated session principals', () => {
    expect(
      ApiGatewayErrorResponseSchema.parse({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'A valid bearer token is required.',
        },
      }).error.code,
    ).toBe('AUTHENTICATION_REQUIRED');
    expect(
      ApiGatewayErrorResponseSchema.safeParse({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected.' },
      }).success,
    ).toBe(false);
    expect(
      ApiSessionResponseSchema.parse({
        subject: 'analyst-7',
        scopes: ['api:read'],
      }),
    ).toEqual({ subject: 'analyst-7', scopes: ['api:read'] });
    expect(
      ApiSessionResponseSchema.safeParse({
        subject: 'analyst-7',
        scopes: ['root'],
      }).success,
    ).toBe(false);
  });

  it('bounds analysis data, rejects unknown fields, and keeps findings advisory', () => {
    const request = fixture.analysisRequest as Record<string, unknown>;
    expect(
      AnalysisRequestSchema.safeParse({ ...request, surprise: true }).success,
    ).toBe(false);
    expect(
      AnalysisRequestSchema.safeParse({ ...request, context: 'x'.repeat(4001) })
        .success,
    ).toBe(false);
    expect(
      AnalysisRequestSchema.safeParse({ ...request, alertIds: [] }).success,
    ).toBe(false);
    expect(
      AnalysisRequestSchema.safeParse({
        ...request,
        evidence: [{ kind: 'alert', id: 'bad' }],
      }).success,
    ).toBe(false);

    const result = fixture.analysisResult as Record<string, unknown>;
    const [finding] = result.findings as Record<string, unknown>[];
    expect(
      AnalysisResultSchema.safeParse({
        ...result,
        findings: [{ ...finding, confidence: 1.1 }],
      }).success,
    ).toBe(false);
    expect(
      AnalysisResultSchema.safeParse({
        ...result,
        findings: [{ ...finding, verificationStatus: 'verified' }],
      }).success,
    ).toBe(false);
    expect(
      AnalysisResultSchema.safeParse({ ...result, extra: true }).success,
    ).toBe(false);
  });
});
