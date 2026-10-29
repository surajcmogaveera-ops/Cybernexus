export type DashboardPage =
  | 'overview'
  | 'incidents'
  | 'alerts'
  | 'investigation'
  | 'assignment'
  | 'evaluation';

export type DashboardViewState = {
  page: DashboardPage;
  selectedIncidentId: string;
};

export type DashboardViewAction =
  | { type: 'navigate'; page: DashboardPage }
  | { type: 'select-incident'; incidentId: string };

export function dashboardViewReducer(
  state: DashboardViewState,
  action: DashboardViewAction,
): DashboardViewState {
  if (action.type === 'select-incident') {
    return { page: 'investigation', selectedIncidentId: action.incidentId };
  }
  return { ...state, page: action.page };
}
