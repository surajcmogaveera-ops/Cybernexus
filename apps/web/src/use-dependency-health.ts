import { useEffect, useState } from 'react';
import { getDependencyHealth } from './api.js';

export type DependencyHealthState =
  | { status: 'checking' }
  | { status: 'error' }
  | {
      status: 'ready';
      data: Awaited<ReturnType<typeof getDependencyHealth>>;
    };

export type HealthIndicatorState =
  | 'checking'
  | 'healthy'
  | 'unavailable'
  | 'not_configured'
  | 'disabled'
  | 'configured_unverified'
  | 'unverified'
  | 'unknown';

export type HealthIndicators = {
  api: HealthIndicatorState;
  database: HealthIndicatorState;
  aiService: HealthIndicatorState;
  geminiProvider: HealthIndicatorState;
  geminiConnectivity: HealthIndicatorState;
  checkedAt?: string;
};

export function toHealthIndicators(
  state: DependencyHealthState,
): HealthIndicators {
  if (state.status === 'checking') {
    return {
      api: 'checking',
      database: 'checking',
      aiService: 'checking',
      geminiProvider: 'checking',
      geminiConnectivity: 'unverified',
    };
  }
  if (state.status === 'error') {
    return {
      api: 'unavailable',
      database: 'unknown',
      aiService: 'unknown',
      geminiProvider: 'unknown',
      geminiConnectivity: 'unverified',
    };
  }

  const { data } = state;
  return {
    api: data.api.status,
    database: data.database.status,
    aiService: data.aiService.status,
    geminiProvider: data.aiProvider.geminiConfiguration,
    geminiConnectivity: data.aiProvider.geminiConnectivity,
    checkedAt: data.checkedAt,
  };
}

const REFRESH_INTERVAL_MS = 30_000;

export function useDependencyHealth(): DependencyHealthState {
  const [state, setState] = useState<DependencyHealthState>({
    status: 'checking',
  });

  useEffect(() => {
    let active = true;
    let inFlight = false;

    const check = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await getDependencyHealth();
        if (active) setState({ status: 'ready', data });
      } catch {
        if (active) setState({ status: 'error' });
      } finally {
        inFlight = false;
      }
    };

    void check();
    const interval = window.setInterval(
      () => void check(),
      REFRESH_INTERVAL_MS,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return state;
}
