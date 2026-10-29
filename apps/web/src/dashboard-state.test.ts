import { describe, expect, it } from 'vitest';
import {
  dashboardViewReducer,
  type DashboardViewState,
} from './dashboard-state.js';

describe('dashboard navigation and selection', () => {
  const initial: DashboardViewState = {
    page: 'overview',
    selectedIncidentId: 'initial-incident',
  };

  it('opens the investigation view for the selected incident', () => {
    expect(
      dashboardViewReducer(initial, {
        type: 'select-incident',
        incidentId: 'selected-incident',
      }),
    ).toEqual({
      page: 'investigation',
      selectedIncidentId: 'selected-incident',
    });
  });

  it('changes navigation while retaining the current selection', () => {
    expect(
      dashboardViewReducer(initial, {
        type: 'navigate',
        page: 'alerts',
      }),
    ).toEqual({ page: 'alerts', selectedIncidentId: 'initial-incident' });
  });
});
