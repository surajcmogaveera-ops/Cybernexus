import { useEffect, useState } from 'react';
import { getApiHealth } from './api.js';

export default function App() {
  const [apiStatus, setApiStatus] = useState('Checking API…');

  useEffect(() => {
    let mounted = true;
    void getApiHealth()
      .then((health) => {
        if (mounted) setApiStatus(`${health.service} online`);
      })
      .catch(() => {
        if (mounted) setApiStatus('API unavailable');
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#090d18] text-slate-100">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-20">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
            ✳
          </span>
          <span className="text-sm font-semibold tracking-[0.2em] text-cyan-100">
            CYBERNEXUS
          </span>
        </div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">
          Security Operations, connected
        </p>
        <h1 className="max-w-3xl text-5xl font-semibold leading-tight tracking-tight sm:text-7xl">
          Clarity for every security signal.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-400">
          An AI-assisted SOC workspace for turning alerts into explainable,
          reviewable incident decisions.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <span className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">
            Synthetic demo environment
          </span>
          <span className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">
            Human-reviewed workflows
          </span>
          <span
            aria-live="polite"
            className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300"
          >
            {apiStatus}
          </span>
        </div>
        <p className="mt-16 text-xs text-slate-600">
          CyberNexus · Project scaffold
        </p>
      </section>
    </main>
  );
}
