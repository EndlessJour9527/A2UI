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
import {useMemo, use, useState} from 'react';
import {ArrowLeft, ArrowRight, Play, Loader2, MessageSquare, ShieldCheck, Tag, X} from 'lucide-react';
import {useStudio} from '@/contexts/studio-context';
import {Button} from '@/components/ui/button';
import {useRouter} from 'next/navigation';

export default function StudioGroupDetailPage({
  params,
}: {
  params: Promise<{runId: string; groupId: string}>;
}) {
  const resolvedParams = use(params);
  const runId = resolvedParams.runId;
  const groupId = resolvedParams.groupId;
  const router = useRouter();

  const {runs, groups, cases, refresh: refreshStudioIndex} = useStudio();

  const run = runs.find(item => item.run_id === runId);
  const group = groups.find(g => g.runId === runId && g.groupId === groupId);
  const groupCases = useMemo(() => cases.filter(c => c.runId === runId && c.groupId === groupId), [cases, runId, groupId]);

  // Filters state
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [labelFilter, setLabelFilter] = useState<string>('all');

  // Rerun execution state
  const [isRerunning, setIsRerunning] = useState(false);

  // Group metrics
  const metrics = useMemo(() => {
    const total = groupCases.length;
    let completed = 0;
    let failed = 0;
    const labelCounts: Record<string, number> = {};

    groupCases.forEach(c => {
      if (c.status === 'completed') {
        completed++;
      } else if (c.status) {
        failed++;
      }
      
      if (c.annotationLabels) {
        c.annotationLabels.forEach(lbl => {
          labelCounts[lbl] = (labelCounts[lbl] || 0) + 1;
        });
      }
    });

    return {total, completed, failed, labelCounts};
  }, [groupCases]);

  // Filtered cases
  const filteredCases = useMemo(() => {
    return groupCases.filter(c => {
      // 1. Status Filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'completed' && c.status !== 'completed') return false;
        if (statusFilter === 'failed' && (!c.status || c.status === 'completed')) return false;
        if (statusFilter === 'queued' && c.status) return false;
      }

      // 2. Annotation Label Filter
      if (labelFilter !== 'all') {
        if (!c.annotationLabels || !c.annotationLabels.includes(labelFilter)) return false;
      }

      return true;
    });
  }, [groupCases, statusFilter, labelFilter]);

  const handleRerunFailed = async () => {
    try {
      setIsRerunning(true);
      const res = await fetch('/api/studio/runs/rerun', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          runId,
          groupId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create rerun');
      }

      const result = await res.json();
      await refreshStudioIndex();
      router.push(`/studio/run/${result.runId}`);
    } catch (err: any) {
      alert(err.message);
      setIsRerunning(false);
    }
  };

  if (!run || !group) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="rounded-2xl border bg-white/80 px-6 py-5 text-sm text-muted-foreground shadow-sm">
          Run or Group not found.
        </div>
      </div>
    );
  }

  const hasFailedCases = metrics.total > metrics.completed;

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {/* Breadcrumbs & Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Link
              href={`/studio/run/${runId}`}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to run: {run.name}
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Group: {group.label}
            </h1>
            <p className="text-sm text-muted-foreground">
              Run: {run.name} ({run.model})
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              onClick={handleRerunFailed}
              disabled={isRerunning || !hasFailedCases}
              className="gap-2"
            >
              {isRerunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating rerun...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  Rerun Failed Cases
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Metrics Section */}
        <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <MetricCard label="Total Cases" value={metrics.total} />
          <MetricCard label="Passed (Completed)" value={metrics.completed} tone="success" />
          <MetricCard label="Failed / Incomplete" value={metrics.failed} tone={metrics.failed > 0 ? 'danger' : 'default'} />
          <MetricCard label="Total Annotations" value={groupCases.reduce((sum, c) => sum + (c.annotationCount || 0), 0)} tone="info" />
        </section>

        {/* Annotations Summary Card */}
        {Object.keys(metrics.labelCounts).length > 0 && (
          <section className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold">Annotation Label Summary</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(metrics.labelCounts).map(([label, count]) => {
                let colorClasses = 'bg-slate-100 text-slate-800 border-slate-200';
                if (label === 'correct') colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-500/20';
                else if (label === 'incorrect') colorClasses = 'bg-rose-50 text-rose-700 border-rose-500/20';
                else if (label === 'partial') colorClasses = 'bg-amber-50 text-amber-700 border-amber-500/20';
                else if (label === 'needs_review') colorClasses = 'bg-indigo-50 text-indigo-700 border-indigo-500/20';
                else if (label === 'hallucination') colorClasses = 'bg-purple-50 text-purple-700 border-purple-500/20';
                else if (label === 'rendering_issue') colorClasses = 'bg-pink-50 text-pink-700 border-pink-500/20';
                else if (label === 'prompt_issue') colorClasses = 'bg-sky-50 text-sky-700 border-sky-500/20';

                return (
                  <div
                    key={label}
                    onClick={() => setLabelFilter(label)}
                    className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider cursor-pointer shadow-sm hover:scale-[1.02] transition-transform ${colorClasses}`}
                    title={`Click to filter by ${label}`}
                  >
                    <span>{label.replace(/_/g, ' ')}</span>
                    <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-bold">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Case List section */}
        <section className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Case List ({filteredCases.length})
            </h2>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Status:</span>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed/Error</option>
                  <option value="queued">Queued</option>
                </select>
              </div>

              {/* Annotation Label Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Annotation:</span>
                <select
                  value={labelFilter}
                  onChange={e => setLabelFilter(e.target.value)}
                  className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="all">All Labels</option>
                  <option value="correct">Correct</option>
                  <option value="partial">Partial</option>
                  <option value="incorrect">Incorrect</option>
                  <option value="hallucination">Hallucination</option>
                  <option value="rendering_issue">Rendering Issue</option>
                  <option value="prompt_issue">Prompt Issue</option>
                  <option value="needs_review">Needs Review</option>
                </select>
              </div>

              {/* Clear Filters */}
              {(statusFilter !== 'all' || labelFilter !== 'all') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatusFilter('all');
                    setLabelFilter('all');
                  }}
                  className="gap-1 text-xs h-8 rounded-xl px-2.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear Filters
                </Button>
              )}
            </div>
          </div>

          {/* Cases Table list */}
          <div className="overflow-hidden rounded-2xl border border-border/40 bg-background/50 divide-y divide-border/20">
            {filteredCases.map(caseItem => {
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
                    <span className="font-semibold text-xs text-foreground md:w-56 truncate" title={caseItem.caseId}>
                      <Link
                        href={`/studio/run/${runId}/group/${groupId}/case/${caseItem.caseId}`}
                        className="hover:text-primary transition-colors"
                      >
                        {caseItem.caseId}
                      </Link>
                    </span>
                    <span className="text-xs text-muted-foreground truncate flex-1" title={caseItem.prompt}>
                      {caseItem.prompt}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {/* Render specific annotation labels if present */}
                    {caseItem.annotationLabels && caseItem.annotationLabels.map((lbl, i) => {
                      let colorClasses = 'bg-slate-50 text-slate-600 border-slate-500/10';
                      if (lbl === 'correct') colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-500/10';
                      else if (lbl === 'incorrect') colorClasses = 'bg-rose-50 text-rose-700 border-rose-500/10';
                      else if (lbl === 'partial') colorClasses = 'bg-amber-50 text-amber-700 border-amber-500/10';
                      
                      return (
                        <span key={i} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider shrink-0 ${colorClasses}`}>
                          {lbl.replace(/_/g, ' ')}
                        </span>
                      );
                    })}

                    {/* Annotation Note count */}
                    {caseItem.annotationCount !== undefined && caseItem.annotationCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-500/20 px-2 py-0.5 text-[9px] font-medium text-indigo-700 shrink-0">
                        <MessageSquare className="h-3 w-3" />
                        {caseItem.annotationCount}
                      </span>
                    )}

                    {/* Status Badge */}
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider shrink-0 ${statusColor}`}>
                      {caseItem.status?.replace(/_/g, ' ') || 'queued'}
                    </span>

                    {/* Review Link */}
                    <Button variant="ghost" size="sm" asChild className="rounded-xl h-8 px-3">
                      <Link
                        href={`/studio/run/${runId}/group/${groupId}/case/${caseItem.caseId}`}
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

            {filteredCases.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No cases matching the selected filters were found.
              </div>
            )}
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
  tone?: 'default' | 'success' | 'danger' | 'info';
}) {
  let valueColor = 'text-foreground';
  if (tone === 'danger') valueColor = 'text-rose-700';
  else if (tone === 'success') valueColor = 'text-emerald-700';
  else if (tone === 'info') valueColor = 'text-indigo-700';

  return (
    <div className="rounded-3xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-2 text-3xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}
