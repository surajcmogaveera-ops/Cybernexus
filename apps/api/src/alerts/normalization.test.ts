import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  normalizeAlertIngress,
  AlertInputValidationError,
} from './normalization.js';

const dataset = JSON.parse(
  readFileSync(
    new URL('../../../../data/synthetic/alerts-v1.json', import.meta.url),
    'utf8',
  ),
) as {
  datasetVersion: string;
  records: { caseId: string; record: Record<string, unknown> }[];
};

const invalidCases = JSON.parse(
  readFileSync(
    new URL(
      '../../../../data/synthetic/invalid-records-v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { caseId: string; record: Record<string, unknown> }[];

describe('synthetic alert dataset and normalization', () => {
  it('loads deterministic source fixtures with separate ground-truth cases', () => {
    expect(dataset.datasetVersion).toBe('cybernexus-synthetic-alerts-v1');
    expect(dataset.records.length).toBeGreaterThanOrEqual(8);
    for (const fixture of dataset.records) {
      expect(normalizeAlertIngress(fixture.record).source).toBe(
        fixture.record.source,
      );
    }
  });

  it('normalizes documented severity aliases and converts offsets to UTC', () => {
    const identity = dataset.records.find(
      ({ caseId }) => caseId === 'identity-sequence-start',
    )!.record;
    const normalized = normalizeAlertIngress(identity);
    expect(normalized.severity).toBe('medium');
    expect(normalized.observedAt.toISOString()).toBe(
      '2026-10-29T08:15:00.000Z',
    );
    expect(normalized.source).toBe('demo-idp');
    expect(normalized.normalizedAttributes).toEqual({
      userId: 'demo-user-17',
      deviceId: 'demo-workstation-17',
    });
  });

  it('preserves raw payload text and omits unavailable source IDs', () => {
    const untrusted = dataset.records.find(
      ({ caseId }) => caseId === 'untrusted-instruction-like-payload',
    )!.record;
    expect(normalizeAlertIngress(untrusted).payload).toEqual(untrusted.payload);

    const unidentified = dataset.records.find(
      ({ caseId }) => caseId === 'unidentified-source-event',
    )!.record;
    const normalized = normalizeAlertIngress(unidentified);
    expect(normalized).not.toHaveProperty('externalId');
    expect(normalized.normalizedAttributes).toEqual({
      userId: 'operator-demo@example.test',
    });
    expect(normalized.sourceMetadata.externalIdProvided).toBe(false);
  });

  it('rejects malformed records and enforces the per-record byte bound', () => {
    for (const fixture of invalidCases) {
      expect(
        () => normalizeAlertIngress(fixture.record),
        fixture.caseId,
      ).toThrow(AlertInputValidationError);
    }

    expect(() =>
      normalizeAlertIngress({
        source: 'demo-edr',
        externalId: 'too-large',
        observedAt: '2026-10-29T08:00:00Z',
        title: 'Synthetic large payload',
        severity: 'high',
        payload: { text: 'x'.repeat(33_000) },
      }),
    ).toThrow(/32768-byte limit/);
  });
});
