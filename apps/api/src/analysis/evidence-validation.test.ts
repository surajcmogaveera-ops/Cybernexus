import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IncidentAnalysisRequestSchema,
  IncidentAnalysisResultSchema,
} from '@cybernexus/shared';
import { validateIncidentAnalysisEvidence } from './evidence-validation.js';
import { InvalidAnalysisEvidenceError } from './contracts.js';

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../packages/shared/fixtures/incident-analysis-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { request: unknown; result: unknown };

describe('incident analysis evidence validation', () => {
  it('accepts only incident-scoped source references and leaves claims unverified', () => {
    const request = IncidentAnalysisRequestSchema.parse(fixture.request);
    const result = IncidentAnalysisResultSchema.parse(fixture.result);
    const validated = validateIncidentAnalysisEvidence(request, result);
    expect(validated.validationStatus).toBe('reported_conflicts');
    expect(validated.findingStatuses).toEqual([
      'references_validated',
      'reported_conflicts',
    ]);
    expect(validated.evidenceReferences).toHaveLength(3);
    expect(
      validated.result.findings.every(
        ({ verificationStatus }) => verificationStatus === 'unverified',
      ),
    ).toBe(true);
  });

  it('accepts Gemini method values but independently rejects its invalid references', () => {
    const request = IncidentAnalysisRequestSchema.parse(fixture.request);
    const raw = JSON.parse(JSON.stringify(fixture.result)) as Record<
      string,
      unknown
    >;
    raw.analysisMethod = 'gemini';
    const result = IncidentAnalysisResultSchema.parse(raw);
    expect(
      validateIncidentAnalysisEvidence(request, result).result.analysisMethod,
    ).toBe('gemini');

    const invalid = JSON.parse(JSON.stringify(raw)) as {
      findings: { evidence: { id: string }[] }[];
    };
    invalid.findings[0]!.evidence[0]!.id =
      '10000000-0000-4000-8000-000000000099';
    expect(() =>
      validateIncidentAnalysisEvidence(
        request,
        IncidentAnalysisResultSchema.parse(invalid),
      ),
    ).toThrow(InvalidAnalysisEvidenceError);
  });

  it('flags findings without references as insufficient instead of promoting them', () => {
    const request = IncidentAnalysisRequestSchema.parse(fixture.request);
    const original = IncidentAnalysisResultSchema.parse(fixture.result);
    const result = IncidentAnalysisResultSchema.parse({
      ...original,
      reportedConflicts: [],
      findings: [{ ...original.findings[0]!, evidence: [] }],
    });
    const validated = validateIncidentAnalysisEvidence(request, result);
    expect(validated.validationStatus).toBe('insufficient_evidence');
    expect(validated.findingStatuses).toEqual(['insufficient_evidence']);
    expect(validated.evidenceReferences).toEqual([]);
  });

  it.each([
    {
      kind: 'alert' as const,
      id: '10000000-0000-4000-8000-000000000001',
      fieldPaths: ['severity'],
    },
    {
      kind: 'relationship' as const,
      id: '10000000-0000-4000-8000-000000000002',
      fieldPaths: ['status'],
    },
    {
      kind: 'alert' as const,
      id: '15a3a4d2-59ba-4170-a25b-5b7ef3f71cb6',
      fieldPaths: ['payload.adminIdentity'],
    },
  ])(
    'rejects fabricated, out-of-scope, or unprovided evidence %#',
    (reference) => {
      const request = IncidentAnalysisRequestSchema.parse(fixture.request);
      const original = IncidentAnalysisResultSchema.parse(fixture.result);
      const result = IncidentAnalysisResultSchema.parse({
        ...original,
        reportedConflicts: [],
        findings: [{ ...original.findings[0]!, evidence: [reference] }],
      });
      expect(() => validateIncidentAnalysisEvidence(request, result)).toThrow(
        InvalidAnalysisEvidenceError,
      );
    },
  );

  it('rejects service attempts to provide application validation metadata', () => {
    const request = IncidentAnalysisRequestSchema.parse(fixture.request);
    const result = {
      ...(fixture.result as Record<string, unknown>),
      validationStatus: 'references_validated',
    };
    expect(() =>
      validateIncidentAnalysisEvidence(
        request,
        IncidentAnalysisResultSchema.parse(result),
      ),
    ).toThrow();
  });
});
