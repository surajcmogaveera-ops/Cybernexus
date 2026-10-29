import { describe, expect, it } from 'vitest';
import {
  demoDashboardData,
  filterIncidents,
  getAlertSeverityCounts,
  getDashboardMetrics,
  getSeverityCounts,
} from './dashboard-data.js';

describe('synthetic dashboard dataset', () => {
  it('keeps overview counts consistent with the incident and alert records', () => {
    const metrics = getDashboardMetrics(
      demoDashboardData,
      Date.parse('2026-10-29T08:00:00Z'),
    );
    const severityCounts = getSeverityCounts(demoDashboardData);
    const alertCounts = getAlertSeverityCounts(demoDashboardData);

    expect(metrics).toEqual({
      openIncidents: 4,
      criticalIncidents: 2,
      totalAlerts: demoDashboardData.alerts.length,
      deadlineRisk: 1,
      overdue: 0,
    });
    expect(severityCounts.reduce((sum, item) => sum + item.count, 0)).toBe(
      demoDashboardData.incidents.length,
    );
    expect(alertCounts.reduce((sum, item) => sum + item.count, 0)).toBe(
      demoDashboardData.alerts.length,
    );
  });

  it('filters incidents by case-insensitive text, severity, and status', () => {
    expect(
      filterIncidents(demoDashboardData.incidents, {
        query: 'CLOUD',
        severity: 'high',
        status: 'triaged',
      }).map((incident) => incident.title),
    ).toEqual(['Cloud storage exposure policy change']);

    expect(
      filterIncidents(demoDashboardData.incidents, {
        query: 'not present',
        severity: 'all',
        status: 'all',
      }),
    ).toEqual([]);
  });

  it('keeps every incident alert reference and timeline record traceable', () => {
    for (const incident of demoDashboardData.incidents) {
      expect(incident.alertIds.length).toBeGreaterThan(0);
      expect(
        incident.alertIds.every((alertId) =>
          demoDashboardData.alerts.some((alert) => alert.id === alertId),
        ),
      ).toBe(true);
      expect(incident.timeline.length).toBeGreaterThan(0);
      expect(incident.timeline.map((event) => Date.parse(event.at))).toEqual(
        [...incident.timeline.map((event) => Date.parse(event.at))].sort(
          (left, right) => left - right,
        ),
      );
    }
  });
});
