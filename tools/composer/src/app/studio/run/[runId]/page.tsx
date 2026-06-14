/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use client';

import Link from 'next/link';
import {useMemo, use, useState, useEffect, useRef} from 'react';
import {ArrowLeft, ArrowRight, Layers3, Play, Loader2, ChevronDown, MessageSquare, AlertCircle} from 'lucide-react';
import {useStudio} from '@/contexts/studio-context';
import {Button} from '@/components/ui/button';
import {eventsForLatestExecution} from '@/lib/studio-run-events';

type CompletionProviderMode = 'mock' | 'static' | 'llm' | 'local-openai' | 'nvidia';

const RUNNING_STATUSES = [
  'preparing',
  'running_protocol',
  'running_render',
  'collecting_device',
];

export default function StudioRunPage({params}: {params: Promise<{runId: string}>}) {
  const resolvedParams = use(params);
  const runId = resolvedParams.runId;
  const {runs, groups, cases, bootstrap, refresh: refreshStudioIndex} = useStudio();
  const run = runs.find(item => item.run_id === runId);
  const runGroups = useMemo(() => groups.filter(group => group.runId === runId), [groups, runId]);
  const runCases = useMemo(() => cases.filter(item => item.runId === runId), [cases, runId]);

  const runHistory = useMemo(() => {
    if (!run) return [];
    const rawHistory = run.history && run.history.length > 0
      ? run.history
      : run.metadata?.latest_execution_id
        ? [{
            execution_id: run.metadata.latest_execution_id as string,
            version: 'v1',
            model: (() => {
              const provider = run.metadata?.completion_provider as string;
              if (!provider) return run.model;
              const parsed = parseProviderValue(provider, run.model);
              return parsed.model || parsed.mode;
            })(),
            provider: (run.metadata.completion_provider as string) || 'unknown',
            started_at: (run.metadata.latest_execution_started_at as string) || run.created_at,
            status: run.status,
            completed_cases: run.completed_cases,
            failed_cases: run.failed_cases,
            group_names: runGroups.map(g => g.groupId),
          }]
        : [];

    // Deduplicate history entries by execution_id to be extremely robust against duplicate key errors
    const seen = new Set<string>();
    return rawHistory.filter(entry => {
      if (!entry.execution_id) return true;
      if (seen.has(entry.execution_id)) return false;
      seen.add(entry.execution_id);
      return true;
    });
  }, [run, runGroups]);

  // Execution states
  const [isRunning, setIsRunning] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [providerMode, setProviderMode] = useState<CompletionProviderMode>('mock');
  const [providerModel, setProviderModel] = useState('');
  const [completedCount, setCompletedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionLog, setExecutionLog] = useState<string | null>(null);
  const [isLogPanelCollapsed, setIsLogPanelCollapsed] = useState(true);
  const submittedProviderRef = useRef<string | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [historyCaseStatuses, setHistoryCaseStatuses] = useState<Record<string, string>>({});

  // Collapsible groups state
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // Initialize expanded groups state when groups load
  useEffect(() => {
    if (runGroups.length > 0) {
      const initial: Record<string, boolean> = {};
      runGroups.forEach(g => {
        initial[g.groupId] = true;
      });
      setExpandedGroups(initial);
    }
  }, [runGroups]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  // Initialize count states when run loads
  useEffect(() => {
    if (run) {
      if (!selectedExecutionId && run.metadata?.latest_execution_id) {
        setSelectedExecutionId(run.metadata.latest_execution_id as string);
      }

      const historyEntry = runHistory.find(entry => entry.execution_id === selectedExecutionId);

      if (historyEntry) {
        setCompletedCount(historyEntry.completed_cases);
        setFailedCount(historyEntry.failed_cases);
        setCurrentStatus(historyEntry.status);
      } else {
        setCompletedCount(run.completed_cases);
        setFailedCount(run.failed_cases);
        setCurrentStatus(run.status);
      }
      
      const providerSelection = parseProviderValue(
        submittedProviderRef.current ?? (run.metadata?.completion_provider as string | undefined) ?? run.model,
        run.model,
      );
      setProviderMode(providerSelection.mode);
      setProviderModel(providerSelection.model);

      if (!RUNNING_STATUSES.includes(run.status)) {
        submittedProviderRef.current = null;
      }

      if (run.status === 'error_infrastructure' || run.latest_error) {
        setExecutionError(run.latest_error || 'An infrastructure or configuration error occurred.');
      } else {
        setExecutionError(null);
      }
    }
  }, [run, runHistory, selectedExecutionId]);

  // Load status once on mount or when runId changes to capture execution logs & initial error state
  useEffect(() => {
    let active = true;
    async function loadInitialStatus() {
      try {
        const url = selectedExecutionId 
          ? `/api/studio/runs/${runId}/status?executionId=${selectedExecutionId}` 
          : `/api/studio/runs/${runId}/status`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setExecutionLog(typeof data.executionLog === 'string' ? data.executionLog : null);

        const latestExecutionId = data.summary.metadata?.latest_execution_id;
        const historyEntry = data.summary.history?.find((e: any) => e.execution_id === (selectedExecutionId || latestExecutionId));

        if (data.summary.status === 'error_infrastructure' || data.summary.latest_error) {
          setExecutionError(data.summary.latest_error || 'An infrastructure or configuration error occurred.');
        } else {
          setExecutionError(null);
        }

        // Parse recent events to identify case statuses for the selected execution
        const startIdx = data.latestExecutionStartIndex ?? 0;
        let endIdx = (data.recentEvents ?? []).length;
        for (let i = startIdx + 1; i < (data.recentEvents ?? []).length; i++) {
          if (data.recentEvents[i].event_type === 'run.execution_started') {
            endIdx = i;
            break;
          }
        }
        const executionEvents = (data.recentEvents ?? []).slice(startIdx, endIdx);

        const caseStatuses: Record<string, string> = {};
        executionEvents.forEach((e: any) => {
          if (e.event_type === 'case.started' && e.payload?.caseId) {
            caseStatuses[e.payload.caseId] = 'running_protocol';
          }
          if (e.event_type === 'case.completed' && e.payload?.caseId) {
            caseStatuses[e.payload.caseId] = e.payload.status;
          }
        });
        setHistoryCaseStatuses(caseStatuses);
      } catch (err) {
        console.error('Failed to load initial status:', err);
      }
    }
    void loadInitialStatus();
    return () => {
      active = false;
    };
  }, [runId, selectedExecutionId]);

  // Polling loop for active runs
  useEffect(() => {
    if (!isRunning && !(run && RUNNING_STATUSES.includes(run.status))) {
      return;
    }

    let active = true;
    let timerId: NodeJS.Timeout;

    async function pollStatus() {
      try {
        const url = selectedExecutionId 
          ? `/api/studio/runs/${runId}/status?executionId=${selectedExecutionId}` 
          : `/api/studio/runs/${runId}/status`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;

        const latestExecutionId = data.summary.metadata?.latest_execution_id;
        const historyEntry = data.summary.history?.find((e: any) => e.execution_id === (selectedExecutionId || latestExecutionId));

        setIsRunning(data.isRunning);
        setCurrentStatus(historyEntry ? historyEntry.status : data.summary.status);
        setExecutionLog(typeof data.executionLog === 'string' ? data.executionLog : null);
        if (data.summary.status === 'error_infrastructure' || data.summary.latest_error) {
          setExecutionError(data.summary.latest_error || 'An infrastructure or configuration error occurred.');
        } else if (data.summary.status === 'completed' || data.summary.status === 'failed') {
          setExecutionError(null);
        }

        const startIdx = data.latestExecutionStartIndex ?? 0;
        let endIdx = (data.recentEvents ?? []).length;
        for (let i = startIdx + 1; i < (data.recentEvents ?? []).length; i++) {
          if (data.recentEvents[i].event_type === 'run.execution_started') {
            endIdx = i;
            break;
          }
        }
        const executionEvents = (data.recentEvents ?? []).slice(startIdx, endIdx);
        
        // Count unique case completions to prevent duplicate counts from concurrent/rerun processes
        const caseStatuses: Record<string, string> = {};
        executionEvents.forEach((e: any) => {
          if (e.event_type === 'case.started' && e.payload?.caseId) {
            caseStatuses[e.payload.caseId] = 'running_protocol';
          }
          if (e.event_type === 'case.completed' && e.payload?.caseId) {
            caseStatuses[e.payload.caseId] = e.payload.status;
          }
        });
        setHistoryCaseStatuses(caseStatuses);
        
        const eventCompletedCount = Object.keys(caseStatuses).filter(id => caseStatuses[id] === 'completed').length;
        const eventFailedCount = Object.values(caseStatuses).filter(
          status => status !== 'completed' && status !== 'running_protocol' && status !== 'queued'
        ).length;

        const baseCompleted = historyEntry ? historyEntry.completed_cases : data.summary.completed_cases;
        const baseFailed = historyEntry ? historyEntry.failed_cases : data.summary.failed_cases;

        if (data.isRunning) {
          setCompletedCount(Math.max(baseCompleted, eventCompletedCount));
          setFailedCount(Math.max(baseFailed, eventFailedCount));
        } else {
          setCompletedCount(baseCompleted);
          setFailedCount(baseFailed);
        }

        // Parse recent events to identify active case
        const caseStartedEvents = executionEvents.filter(
          (e: any) => e.event_type === 'case.started'
        );
        const caseCompletedEvents = executionEvents.filter(
          (e: any) => e.event_type === 'case.completed'
        );

        if (caseStartedEvents.length > caseCompletedEvents.length) {
          const activeEvent = caseStartedEvents.at(-1);
          if (activeEvent?.payload?.caseId) {
            setCurrentCaseId(activeEvent.payload.caseId);
          }
        } else {
          setCurrentCaseId(null);
        }

        if (data.isRunning) {
          timerId = setTimeout(pollStatus, 1000);
        } else {
          void refreshStudioIndex();
        }
      } catch (err) {
        console.error('Error polling run status:', err);
        if (active) {
          timerId = setTimeout(pollStatus, 2000);
        }
      }
    }

    void pollStatus();

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [runId, isRunning, run, selectedExecutionId, refreshStudioIndex]);

  const startExecution = async () => {
    const provider = buildProviderValue(providerMode, providerModel);
    if (!provider) {
      setExecutionError('Select a provider model before starting this run.');
      return;
    }
    const providerSelection = parseProviderValue(provider, providerModel);
    console.log(
      `[StudioRunPage] startExecution: provider="${provider}", mode="${providerSelection.mode}", model="${providerSelection.model}"`
    );

    try {
      submittedProviderRef.current = provider;
      setProviderMode(providerSelection.mode);
      setProviderModel(providerSelection.model);
      setValidationErrors(null);
      setExecutionError(null);
      setExecutionLog(null);
      setIsLogPanelCollapsed(false);
      setIsRunning(true);
      setCurrentStatus('preparing');
      const res = await fetch('/api/studio/runs/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          runId,
          provider,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 409) {
          setExecutionError(err.error || 'This run is already executing.');
          setCurrentStatus(err.status || 'running_protocol');
          setIsRunning(true);
          if (err.executionId) {
            setSelectedExecutionId(err.executionId);
          }
          await refreshStudioIndex();
          return;
        }
        submittedProviderRef.current = null;
        if (err.details && Array.isArray(err.details)) {
          setValidationErrors(err.details);
        } else {
          setExecutionError(err.error || 'Failed to start execution');
        }
        setIsRunning(false);
        return;
      }
      const data = await res.json();
      if (data.executionId) {
        setSelectedExecutionId(data.executionId);
      }
      await refreshStudioIndex();
    } catch (err: any) {
      submittedProviderRef.current = null;
      setExecutionError(err.message || 'An unexpected error occurred');
      setIsRunning(false);
    }
  };

  if (!run) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="rounded-2xl border bg-white/80 px-6 py-5 text-sm text-muted-foreground shadow-sm">
          Run not found.
        </div>
      </div>
    );
  }

  const totalCases = run.total_cases;
  const progressPercent = totalCases > 0 ? Math.min((completedCount / totalCases) * 100, 100) : 0;
  const shouldShowLogPanel = isRunning || !!executionLog || !!executionError || !!validationErrors;

  return (
    <div className={`flex flex-1 flex-col overflow-auto p-6 md:p-8 ${shouldShowLogPanel ? 'pb-24 md:pb-28' : ''}`}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Link href="/studio" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to runs
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{run.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{run.model}</span>
              <ProtocolBadge protocolId={run.protocol_id} protocolVersion={run.protocol_version} />
              {run.protocol_profile_id && <span>{run.protocol_profile_id}</span>}
              {run.catalog_profile_id && run.protocol_id === 'a2ui' && <span>{run.catalog_profile_id}</span>}
              <span>{run.renderer}</span>
              <span>{run.execution_mode}</span>
              {typeof run.metadata?.completion_provider === 'string' && (
                <span>{run.metadata.completion_provider}</span>
              )}
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href="/studio">Open runs index</Link>
          </Button>
        </div>

        {/* Execution Dashboard Panel */}
        <section className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  {isRunning ? (
                    <span className="flex items-center gap-2 text-primary">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Executing Evaluation Run
                    </span>
                  ) : (
                    'Run Controls'
                  )}
                </h2>

                {runHistory && runHistory.length > 0 && (
                  <div className="flex items-center gap-1.5 ml-2">
                    <span className="text-xs font-medium text-muted-foreground">Version:</span>
                    <select
                      value={selectedExecutionId || ''}
                      onChange={e => {
                        setSelectedExecutionId(e.target.value || null);
                      }}
                      className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {runHistory.map((entry, index) => {
                        const groupStr = entry.group_names && entry.group_names.length > 0
                          ? ` - ${entry.group_names.join(', ')}`
                          : '';
                        return (
                          <option key={`${entry.execution_id}-${index}`} value={entry.execution_id}>
                            {`${entry.version} (${entry.model}${groupStr})`}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {isRunning
                  ? currentCaseId
                    ? `Currently running case: ${currentCaseId}`
                    : `Status: ${currentStatus}...`
                  : 'Configure the LLM completion provider and execute this run.'}
              </p>
            </div>

            <div className="flex flex-col gap-3 md:min-w-[460px]">
              <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
                <select
                  value={providerMode}
                  onChange={e => {
                    const newMode = e.target.value as CompletionProviderMode;
                    setProviderMode(newMode);
                    if (newMode === 'mock' || newMode === 'static') {
                      setProviderModel('');
                    } else {
                      const providerObj = bootstrap?.providers?.find(p => p.id === newMode);
                      setProviderModel(providerObj?.models[0] || '');
                    }
                  }}
                  disabled={isRunning}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Completion provider"
                >
                  {bootstrap?.providers?.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                
                {providerMode === 'mock' || providerMode === 'static' ? (
                  <input
                    type="text"
                    disabled={true}
                    value=""
                    placeholder="No model needed"
                    className="min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                  />
                ) : (
                  <select
                    value={
                      providerModel === '' || 
                      !(bootstrap?.providers?.find(p => p.id === providerMode)?.models.includes(providerModel))
                        ? 'custom' 
                        : providerModel
                    }
                    onChange={e => {
                      if (e.target.value === 'custom') {
                        setProviderModel('');
                      } else {
                        setProviderModel(e.target.value);
                      }
                    }}
                    disabled={isRunning}
                    className="min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Provider model select"
                  >
                    <optgroup label={`${bootstrap?.providers?.find(p => p.id === providerMode)?.name} Models`}>
                      {bootstrap?.providers?.find(p => p.id === providerMode)?.models.map(m => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Other">
                      <option value="custom">Other / Custom Model...</option>
                    </optgroup>
                  </select>
                )}
                
                <Button
                  onClick={startExecution}
                  disabled={isRunning}
                  className="gap-2 whitespace-nowrap"
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                  Run
                </Button>
              </div>

              {providerMode !== 'mock' && providerMode !== 'static' && (
                (providerModel === '' || 
                !(bootstrap?.providers?.find(p => p.id === providerMode)?.models.includes(providerModel)))
              ) && (
                <input
                  type="text"
                  value={providerModel}
                  onChange={e => setProviderModel(e.target.value)}
                  disabled={isRunning}
                  placeholder={`Enter custom ${bootstrap?.providers?.find(p => p.id === providerMode)?.name || providerMode} model`}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60 mt-1"
                />
              )}

              {!isRunning && (
                <div className="text-xs text-muted-foreground">
                  Provider payload: <code>{buildProviderValue(providerMode, providerModel) || 'missing model'}</code>
                </div>
              )}
            </div>
          </div>

          {isRunning && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Progress: {completedCount} / {totalCases} cases</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{width: `${progressPercent}%`}}
                />
              </div>
            </div>
          )}
        </section>

        {executionError && (
          <div className="flex flex-col gap-3 rounded-3xl border border-rose-200/80 bg-rose-50/60 p-5 text-sm text-rose-700 shadow-sm backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <span className="font-semibold">Execution failed:</span> {executionError}
              </div>
            </div>
          </div>
        )}

        {validationErrors && (
          <div className="rounded-3xl border border-rose-200/80 bg-rose-50/50 p-6 text-sm backdrop-blur-sm shadow-sm flex flex-col gap-3">
            <h3 className="font-semibold text-rose-800 text-base flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping" />
              Pre-Execution Compatibility Errors
            </h3>
            <ul className="list-disc pl-5 space-y-1.5 text-rose-700/90 font-medium">
              {validationErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
            <p className="text-xs text-rose-500/70 mt-1">
              These compatibility criteria must be resolved in the test set or catalog configuration before execution can proceed.
            </p>
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Groups" value={runGroups.length} />
          <MetricCard label="Cases" value={totalCases} />
          <MetricCard label="Completed" value={completedCount} />
          <MetricCard label="Failed" value={failedCount} tone={failedCount > 0 ? 'danger' : 'default'} />
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">Groups in this run</h2>
          </div>
          <div className="flex flex-col gap-4">
            {runGroups.map(group => {
              const groupCases = runCases.filter(item => item.groupId === group.groupId);
              const isExpanded = !!expandedGroups[group.groupId];
              return (
                <div
                  key={group.groupId}
                  className="rounded-3xl border border-border/40 bg-background/50 shadow-sm overflow-hidden transition-all duration-300"
                >
                  {/* Group Header */}
                  <div
                    onClick={() => toggleGroup(group.groupId)}
                    className="flex cursor-pointer items-center justify-between gap-4 p-5 hover:bg-background/40 select-none"
                  >
                    <div className="flex items-center gap-3">
                      <div className="transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-semibold text-foreground text-base">{group.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {group.caseCount} cases in this group
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" asChild className="rounded-xl h-8 px-3 text-xs text-primary">
                        <Link href={`/studio/run/${runId}/group/${group.groupId}`}>
                          View Group Details
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {/* Expanded Cases List */}
                  {isExpanded && (
                    <div className="border-t border-border/30 bg-background/25 divide-y divide-border/20">
                      {groupCases.map(caseItem => {
                        const resolvedStatus = selectedExecutionId && historyCaseStatuses[caseItem.caseId] !== undefined
                          ? historyCaseStatuses[caseItem.caseId]
                          : caseItem.status;
                        let statusColor = 'bg-secondary text-muted-foreground border-border/40';
                        if (resolvedStatus === 'completed') {
                          statusColor = 'bg-emerald-50 text-emerald-700 border-emerald-500/20';
                        } else if (resolvedStatus && resolvedStatus.startsWith('failed')) {
                          statusColor = 'bg-rose-50 text-rose-700 border-rose-500/20';
                        }
                        
                        return (
                          <div
                            key={caseItem.caseId}
                            className="flex items-center justify-between gap-4 p-4 hover:bg-background/45 transition-colors"
                          >
                            <div className="flex flex-1 min-w-0 flex-col md:flex-row md:items-center md:gap-6">
                              <span className="font-medium text-xs text-foreground md:w-48 truncate" title={caseItem.caseId}>
                                {caseItem.caseId}
                              </span>
                              <span className="text-xs text-muted-foreground truncate flex-1" title={caseItem.prompt}>
                                {caseItem.prompt}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-4 shrink-0">
                              <ProtocolBadge
                                protocolId={caseItem.protocolId || run.protocol_id}
                                protocolVersion={caseItem.protocolVersion || run.protocol_version}
                              />

                              {/* Annotation Badge */}
                              {caseItem.annotationCount !== undefined && caseItem.annotationCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                                  <MessageSquare className="h-3 w-3" />
                                  {caseItem.annotationCount}
                                </span>
                              )}
                              
                              {/* Status Badge */}
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusColor}`}>
                                {resolvedStatus?.replace(/_/g, ' ') || 'queued'}
                              </span>
                              
                              {/* Link Button */}
                              <Button variant="ghost" size="sm" asChild className="rounded-xl h-8 px-3">
                                <Link
                                  href={`/studio/run/${runId}/group/${group.groupId}/case/${caseItem.caseId}${selectedExecutionId ? `?executionId=${selectedExecutionId}` : ''}`}
                                  className="inline-flex items-center gap-1.5 text-xs text-primary"
                                >
                                  Review
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      {groupCases.length === 0 && (
                        <div className="p-5 text-center text-xs text-muted-foreground">
                          No cases in this group.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
      {shouldShowLogPanel && (
        <ExecutionLogPanel
          collapsed={isLogPanelCollapsed}
          isRunning={isRunning}
          log={executionLog}
          error={executionError}
          validationErrors={validationErrors}
          onToggle={() => setIsLogPanelCollapsed(value => !value)}
        />
      )}
    </div>
  );
}

function ExecutionLogPanel({
  collapsed,
  isRunning,
  log,
  error,
  validationErrors,
  onToggle,
}: {
  collapsed: boolean;
  isRunning: boolean;
  log: string | null;
  error: string | null;
  validationErrors: string[] | null;
  onToggle: () => void;
}) {
  const statusText = isRunning
    ? 'Running'
    : error || validationErrors
      ? 'Needs attention'
      : 'Idle';
  const displayLog = log && log.trim().length > 0
    ? log
    : isRunning
      ? 'Waiting for runner output...'
      : 'No execution log has been written yet.';

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col px-4 md:px-8">
        <button
          type="button"
          onClick={onToggle}
          className="flex h-12 w-full items-center justify-between gap-4 text-left text-sm"
          aria-expanded={!collapsed}
        >
          <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
            {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            Execution Log
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              {statusText}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>

        {!collapsed && (
          <div className="pb-4">
            {(error || validationErrors) && (
              <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error || validationErrors?.[0]}
              </div>
            )}
            <pre className="h-64 overflow-auto rounded-md bg-stone-950 p-4 font-mono text-xs leading-relaxed text-stone-100 shadow-inner whitespace-pre-wrap">
              {displayLog}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tracking-tight ${tone === 'danger' ? 'text-rose-700' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

function ProtocolBadge({
  protocolId,
  protocolVersion,
}: {
  protocolId?: string | null;
  protocolVersion?: string | null;
}) {
  const id = protocolId || 'a2ui';
  const version = protocolVersion || '0.9';
  const tone =
    id === 'openui'
      ? 'border-sky-500/20 bg-sky-50 text-sky-700'
      : 'border-indigo-500/20 bg-indigo-50 text-indigo-700';

  return (
    <span className={`inline-flex w-fit rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
      {id}@{version}
    </span>
  );
}

function buildProviderValue(mode: CompletionProviderMode, model: string) {
  const trimmedModel = model.trim();
  if (mode === 'mock' || mode === 'static') {
    return mode;
  }
  if (!trimmedModel) {
    return '';
  }
  return `${mode}:${trimmedModel}`;
}

function parseProviderValue(
  provider: string | undefined | null,
  fallbackModel = '',
): {mode: CompletionProviderMode; model: string} {
  const value = provider?.trim() || fallbackModel.trim();
  if (!value) {
    return {mode: 'mock', model: ''};
  }
  if (value === 'mock' || value === 'static') {
    return {mode: value, model: ''};
  }
  if (value.startsWith('llm:')) {
    return {mode: 'llm', model: value.slice(4)};
  }
  if (value.startsWith('local-openai:')) {
    return {mode: 'local-openai', model: value.slice(13)};
  }
  if (value.startsWith('nvidia:')) {
    return {mode: 'nvidia', model: value.slice(7)};
  }
  const mode = inferProviderMode(value);
  return {mode, model: value};
}

function inferProviderMode(model: string): CompletionProviderMode {
  if (!model) return 'mock';
  if (model === 'mock') return 'mock';
  if (model === 'static') return 'static';
  if (model.startsWith('local-openai:') || model.includes('local-openai') || model.startsWith('proxy_')) return 'local-openai';
  if (model.startsWith('nvidia:') || model.includes('nvidia') || model.startsWith('deepseek') || model.startsWith('z-ai/') || model.includes('glm')) return 'nvidia';
  if (model.startsWith('google/') || model.includes('gemini')) return 'llm';
  return 'llm';
}
