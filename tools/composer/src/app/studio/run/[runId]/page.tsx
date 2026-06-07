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
import {useMemo, use, useState, useEffect} from 'react';
import {ArrowLeft, ArrowRight, Layers3, Play, Loader2, ChevronDown, MessageSquare} from 'lucide-react';
import {useStudio} from '@/contexts/studio-context';
import {Button} from '@/components/ui/button';

export default function StudioRunPage({params}: {params: Promise<{runId: string}>}) {
  const resolvedParams = use(params);
  const runId = resolvedParams.runId;
  const {runs, groups, cases, refresh: refreshStudioIndex} = useStudio();
  const run = runs.find(item => item.run_id === runId);
  const runGroups = useMemo(() => groups.filter(group => group.runId === runId), [groups, runId]);
  const runCases = useMemo(() => cases.filter(item => item.runId === runId), [cases, runId]);

  // Execution states
  const [isRunning, setIsRunning] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [provider, setProvider] = useState('mock');
  const [completedCount, setCompletedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null);

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
      setCompletedCount(run.completed_cases);
      setFailedCount(run.failed_cases);
      setCurrentStatus(run.status);
    }
  }, [run]);

  // Polling loop for active runs
  useEffect(() => {
    let active = true;
    let timerId: NodeJS.Timeout;

    async function pollStatus() {
      try {
        const res = await fetch(`/api/studio/runs/${runId}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;

        setIsRunning(data.isRunning);
        setCurrentStatus(data.summary.status);
        setCompletedCount(data.summary.completed_cases);
        setFailedCount(data.summary.failed_cases);

        // Parse recent events to identify active case
        const caseStartedEvents = data.recentEvents.filter(
          (e: any) => e.event_type === 'case.started'
        );
        const caseCompletedEvents = data.recentEvents.filter(
          (e: any) => e.event_type === 'case.completed'
        );

        if (caseStartedEvents.length > caseCompletedEvents.length) {
          const activeEvent = caseStartedEvents[caseStartedEvents.length - 1];
          setCurrentCaseId(activeEvent.payload.caseId);
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

    // Start polling if run state indicates running, or if local isRunning is triggered
    if (run && (isRunning || ['queued', 'preparing', 'running_protocol', 'running_render', 'collecting_device'].includes(run.status))) {
      void pollStatus();
    }

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [runId, isRunning, run, refreshStudioIndex]);

  const startExecution = async () => {
    try {
      setIsRunning(true);
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
        throw new Error(err.error || 'Failed to start execution');
      }
    } catch (err: any) {
      alert(err.message);
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
  const progressPercent = totalCases > 0 ? (completedCount / totalCases) * 100 : 0;

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Link href="/studio" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to runs
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{run.name}</h1>
            <p className="text-sm text-muted-foreground">
              {run.model} · {run.spec_version} · {run.renderer} · {run.execution_mode}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/studio">Open runs index</Link>
          </Button>
        </div>

        {/* Execution Dashboard Panel */}
        <section className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
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
              <p className="text-sm text-muted-foreground">
                {isRunning
                  ? currentCaseId
                    ? `Currently running case: ${currentCaseId}`
                    : `Status: ${currentStatus}...`
                  : 'Configure the LLM completion provider and execute this run.'}
              </p>
            </div>

            {!isRunning && (
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="mock">Mock Completion</option>
                  <option value="static">Static Completion (Target)</option>
                  <option value="llm:gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="llm:gemini-2.0-flash">Gemini 2.0 Flash</option>
                  <option value="llm:gemini-1.5-flash">Gemini 1.5 Flash</option>
                </select>
                <Button onClick={startExecution} className="gap-2">
                  <Play className="h-4 w-4 fill-current" />
                  Run Evaluator
                </Button>
              </div>
            )}
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
                  </div>

                  {/* Expanded Cases List */}
                  {isExpanded && (
                    <div className="border-t border-border/30 bg-background/25 divide-y divide-border/20">
                      {groupCases.map(caseItem => {
                        let statusColor = 'bg-secondary text-muted-foreground border-border/40';
                        if (caseItem.status === 'completed') {
                          statusColor = 'bg-emerald-50 text-emerald-700 border-emerald-500/20';
                        } else if (caseItem.status && caseItem.status.startsWith('failed')) {
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
                              {/* Annotation Badge */}
                              {caseItem.annotationCount !== undefined && caseItem.annotationCount > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                                  <MessageSquare className="h-3 w-3" />
                                  {caseItem.annotationCount}
                                </span>
                              )}
                              
                              {/* Status Badge */}
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusColor}`}>
                                {caseItem.status?.replace(/_/g, ' ') || 'queued'}
                              </span>
                              
                              {/* Link Button */}
                              <Button variant="ghost" size="sm" asChild className="rounded-xl h-8 px-3">
                                <Link
                                  href={`/studio/run/${runId}/group/${group.groupId}/case/${caseItem.caseId}`}
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
