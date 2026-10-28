import { describe, expect, it } from 'vitest';
import {
  AlertInputSchema,
  AnalystSchema,
  ApiErrorResponseSchema,
  AssignmentSchema,
  HealthResponseSchema,
  IncidentSchema,
  SecurityAlertSchema,
} from './index.js';

const id = '6d6f6c7b-4833-4c92-8a3e-0f51e4a576d0';
const otherId = '90a6dff2-2b81-4ed0-8b7d-c458d3cd7b3c';
const timestamp = '2026-10-28T08:15:00Z';

const validAlert = {
  source: 'demo-idp',
  externalId: 'demo-alert-001',
  observedAt: timestamp,
  title: 'Repeated failed sign-ins',
  severity: 'high',
  payload: { sourceIp: '198.51.100.44', providerDetail: { attempt: 8 } },
};

const validIncident = {
  id,
  title: 'Unusual account access',
  alertIds: [otherId],
  status: 'triaged',
  severity: 'high',
  createdAt: timestamp,
  updatedAt: timestamp,
};

const validAssignment = {
  id: otherId,
  incidentId: id,
  analystId: otherId,
  status: 'active',
  assignedAt: timestamp,
  explanation: 'Matches the incident identity and endpoint skills.',
};

describe('AlertInputSchema and SecurityAlertSchema', () => {
  it('accepts an alert and preserves arbitrary raw payload fields', () => {
    expect(AlertInputSchema.parse(validAlert).payload).toEqual(
      validAlert.payload,
    );
    expect(
      AlertInputSchema.parse(JSON.parse(JSON.stringify(validAlert))).payload,
    ).toEqual(validAlert.payload);
    expect(
      SecurityAlertSchema.safeParse({
        ...validAlert,
        id,
        ingestedAt: timestamp,
      }).success,
    ).toBe(true);
  });

  it('rejects missing required fields, invalid severity, and invalid identifiers', () => {
    const { source: _source, ...missingSource } = validAlert;
    expect(AlertInputSchema.safeParse(missingSource).success).toBe(false);
    expect(
      AlertInputSchema.safeParse({ ...validAlert, severity: 'urgent' }).success,
    ).toBe(false);
    expect(
      SecurityAlertSchema.safeParse({
        ...validAlert,
        id: 'alert-1',
        ingestedAt: timestamp,
      }).success,
    ).toBe(false);
  });

  it('requires UTC timestamps and rejects unexpected top-level fields', () => {
    expect(
      AlertInputSchema.safeParse({
        ...validAlert,
        observedAt: '2026-10-28T13:45:00+05:30',
      }).success,
    ).toBe(false);
    expect(
      AlertInputSchema.safeParse({ ...validAlert, extra: true }).success,
    ).toBe(false);
  });
});

describe('IncidentSchema', () => {
  it('accepts an incident with analysis fields kept separate and optional', () => {
    expect(IncidentSchema.safeParse(validIncident).success).toBe(true);
    expect(
      IncidentSchema.parse(JSON.parse(JSON.stringify(validIncident))),
    ).toEqual(validIncident);
    expect(
      IncidentSchema.safeParse({
        ...validIncident,
        riskScore: 82,
        confidence: 0.91,
        needsHumanReview: true,
      }).success,
    ).toBe(true);
  });

  it('rejects invalid incident status, timestamp, and risk/confidence bounds', () => {
    expect(
      IncidentSchema.safeParse({ ...validIncident, status: 'pending' }).success,
    ).toBe(false);
    expect(
      IncidentSchema.safeParse({ ...validIncident, updatedAt: 'yesterday' })
        .success,
    ).toBe(false);
    expect(
      IncidentSchema.safeParse({ ...validIncident, riskScore: 101 }).success,
    ).toBe(false);
    expect(
      IncidentSchema.safeParse({ ...validIncident, confidence: -0.1 }).success,
    ).toBe(false);
  });
});

describe('AnalystSchema and AssignmentSchema', () => {
  it('accepts an analyst and assignment with qualified identifiers', () => {
    expect(
      AnalystSchema.safeParse({
        id,
        displayName: 'Demo Analyst',
        skills: ['identity', 'endpoint'],
        availability: 'available',
      }).success,
    ).toBe(true);
    expect(
      AssignmentSchema.safeParse({
        ...validAssignment,
      }).success,
    ).toBe(true);
    expect(
      AssignmentSchema.parse(JSON.parse(JSON.stringify(validAssignment))),
    ).toEqual(validAssignment);
  });

  it('rejects invalid availability, assignment status, and identifiers', () => {
    expect(
      AnalystSchema.safeParse({
        id,
        displayName: 'Demo Analyst',
        skills: [],
        availability: 'on-call',
      }).success,
    ).toBe(false);
    expect(
      AssignmentSchema.safeParse({ ...validAssignment, status: 'queued' })
        .success,
    ).toBe(false);
    expect(
      AssignmentSchema.safeParse({ ...validAssignment, analystId: 'analyst-1' })
        .success,
    ).toBe(false);
  });
});

describe('API response contracts', () => {
  it('validates health and error responses after JSON serialization', () => {
    const health = { status: 'ok', service: 'cybernexus-ai' };
    const error = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request body did not match the expected format.',
        details: [{ path: ['severity'], message: 'Invalid option.' }],
      },
    };

    expect(
      HealthResponseSchema.parse(JSON.parse(JSON.stringify(health))),
    ).toEqual(health);
    expect(
      ApiErrorResponseSchema.parse(JSON.parse(JSON.stringify(error))),
    ).toEqual(error);
    expect(
      ApiErrorResponseSchema.safeParse({
        error: { ...error.error, stack: 'private' },
      }).success,
    ).toBe(false);
  });
});
