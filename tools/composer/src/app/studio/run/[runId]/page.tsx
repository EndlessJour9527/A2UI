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
import {useMemo, use} from 'react';
import {ArrowLeft, ArrowRight, Layers3} from 'lucide-react';
import {useStudio} from '@/contexts/studio-context';
import {Button} from '@/components/ui/button';

export default function StudioRunPage({params}: {params: Promise<{runId: string}>}) {
  const resolvedParams = use(params);
  const runId = resolvedParams.runId;
  const {runs, groups, cases} = useStudio();
  const run = runs.find(item => item.run_id === runId);
  const runGroups = useMemo(() => groups.filter(group => group.runId === runId), [groups, runId]);
  const runCases = useMemo(() => cases.filter(item => item.runId === runId), [cases, runId]);

  if (!run) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="rounded-2xl border bg-white/80 px-6 py-5 text-sm text-muted-foreground shadow-sm">
          Run not found.
        </div>
      </div>
    );
  }

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

        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Groups" value={runGroups.length} />
          <MetricCard label="Cases" value={run.total_cases} />
          <MetricCard label="Completed" value={run.completed_cases} />
          <MetricCard label="Failed" value={run.failed_cases} tone={run.failed_cases > 0 ? 'danger' : 'default'} />
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">Groups in this run</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {runGroups.map(group => {
              const groupCases = runCases.filter(item => item.groupId === group.groupId);
              const firstCase = groupCases[0];
              return (
                <div
                  key={group.groupId}
                  className="rounded-2xl border border-border/60 bg-background/70 p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-foreground">{group.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {group.caseCount} cases in this group
                      </div>
                    </div>
                    {firstCase ? (
                      <Link
                        href={`/studio/run/${runId}/group/${group.groupId}/case/${firstCase.caseId}`}
                        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                      >
                        Review first case
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {groupCases.map(caseItem => (
                      <Link
                        key={caseItem.caseId}
                        href={`/studio/run/${runId}/group/${group.groupId}/case/${caseItem.caseId}`}
                        className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                      >
                        {caseItem.caseId}
                      </Link>
                    ))}
                  </div>
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
