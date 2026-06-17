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
import {FlaskConical, FolderTree, RefreshCw, ArrowRight, FilePlus2, Trash2} from 'lucide-react';
import {useStudio} from '@/contexts/studio-context';
import {Button} from '@/components/ui/button';
import {useTranslation} from '@/contexts/language-context';

export default function StudioPage() {
  const {loading, runs, groups, cases, refresh} = useStudio();
  const {t} = useTranslation();

  const handleDeleteRun = async (runId: string) => {
    if (
      !confirm(
        t('studio.confirm_delete_run', 'Are you sure you want to delete this run? All execution data, results, and logs for this run will be permanently deleted.')
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/studio/runs/${runId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to delete run: ${res.statusText}`);
      }
      void refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete run');
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <FlaskConical className="h-3.5 w-3.5" />
              Eval Studio MVP
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{t('studio.runs_overview', 'Runs overview')}</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t('studio.description', 'First implementation of the local GenUI Eval Studio control plane. It reads the filesystem-backed run/index skeleton produced under .genui-eval-studio/ and provides a review-first UI for runs, groups, and cases.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 self-start md:self-auto">
            <Button variant="outline" onClick={() => void refresh()} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t('studio.refresh', 'Refresh')}
            </Button>
            <Button asChild className="gap-2">
              <Link href="/studio/create">
                <FilePlus2 className="h-4 w-4" />
                {t('studio.create_run', 'Create run')}
              </Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <SummaryCard label={t('studio.runs_card', 'Runs')} value={runs.length} helpText={t('studio.runs_card_help', 'Materialized run summaries')} />
          <SummaryCard label={t('studio.groups_card', 'Groups')} value={groups.length} helpText={t('studio.groups_card_help', 'Indexed test-set groups')} />
          <SummaryCard label={t('studio.cases_card', 'Cases')} value={cases.length} helpText={t('studio.cases_card_help', 'Selectable review items')} />
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t('studio.recent_runs', 'Recent runs')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('studio.recent_runs_desc', 'Create a run from Excel, open it here, then start execution from the run controls.')}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-sm text-muted-foreground">{t('studio.loading_studio', 'Loading studio indexes…')}</div>
          ) : runs.length === 0 ? (
            <EmptyState t={t} />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/60">
              <div className="grid grid-cols-[1.8fr_0.9fr_0.8fr_0.8fr_0.7fr_0.9fr] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>{t('studio.th_run', 'Run')}</span>
                <span>{t('studio.th_status', 'Status')}</span>
                <span>{t('studio.th_groups', 'Groups')}</span>
                <span>{t('studio.th_cases', 'Cases')}</span>
                <span>{t('studio.th_failed', 'Failed')}</span>
                <span />
              </div>
              {runs.map(run => (
                <div
                  key={run.run_id}
                  className="grid grid-cols-[1.8fr_0.9fr_0.8fr_0.8fr_0.7fr_0.9fr] items-center gap-3 border-b border-border/50 px-4 py-4 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{run.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {run.model} · {formatProtocol(run.protocol_id, run.protocol_version)}
                      {run.protocol_profile_id ? ` · ${run.protocol_profile_id}` : ''} · {run.renderer}
                    </div>
                  </div>
                  <StatusPill status={run.status} t={t} />
                  <span className="text-muted-foreground">{run.group_ids.length}</span>
                  <span className="text-muted-foreground">{run.completed_cases}/{run.total_cases}</span>
                  <span className="text-muted-foreground">{run.failed_cases}</span>
                  <div className="flex justify-end items-center gap-4">
                    <Link
                      href={`/studio/run/${run.run_id}`}
                      className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                    >
                      {t('studio.btn_open', 'Open')}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRun(run.run_id)}
                      className="inline-flex items-center text-muted-foreground hover:text-rose-600 transition-colors"
                      title={t('studio.btn_delete_title', 'Delete run')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helpText,
}: {
  label: string;
  value: number;
  helpText: string;
}) {
  return (
    <div className="rounded-3xl border border-white/70 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{helpText}</div>
    </div>
  );
}

function EmptyState({t}: {t: (key: string, def?: string) => string}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center">
      <FolderTree className="h-10 w-10 text-muted-foreground" />
      <div>
        <div className="font-medium text-foreground">{t('studio.no_local_runs', 'No local Eval Studio runs yet')}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {t('studio.no_local_runs_desc', 'Create a run from an Excel test set to initialize the local filesystem workspace.')}
        </div>
        <Button asChild className="mt-2 gap-2">
          <Link href="/studio/create">
            <FilePlus2 className="h-4 w-4" />
            {t('studio.create_run', 'Create run')}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function StatusPill({status, t}: {status: string; t: (key: string, def?: string) => string}) {
  const tone =
    status === 'completed'
      ? 'bg-emerald-500/10 text-emerald-700'
      : status.startsWith('failed')
        ? 'bg-rose-500/10 text-rose-700'
        : 'bg-amber-500/10 text-amber-700';

  const localizedStatus =
    status === 'completed'
      ? t('studio.status.completed', 'completed')
      : status.startsWith('failed')
        ? t('studio.status.failed', 'failed')
        : t('studio.status.running', 'running');

  return (
    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {localizedStatus}
    </span>
  );
}

function formatProtocol(protocolId?: string | null, protocolVersion?: string | null) {
  const id = protocolId || 'a2ui';
  const version = protocolVersion || '0.9';
  return `${id}@${version}`;
}
