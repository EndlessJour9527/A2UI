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

import {useEffect, useMemo, useState, use} from 'react';
import Link from 'next/link';
import {ArrowLeft, FileJson, PanelRight, RefreshCw, ShieldCheck} from 'lucide-react';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {Button} from '@/components/ui/button';
import {A2UIViewer} from '@/lib/a2ui';
import {useA2UISurface} from '@/components/theater/useA2UISurface';
import {fetchStudioCaseReview} from '@/lib/studio-api';
import type {StudioCaseReviewData} from '@/types/studio';

export default function StudioCasePage({
  params,
}: {
  params: Promise<{runId: string; groupId: string; caseId: string}>;
}) {
  const resolvedParams = use(params);
  const runId = resolvedParams.runId;
  const groupId = resolvedParams.groupId;
  const caseId = resolvedParams.caseId;

  const [data, setData] = useState<StudioCaseReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const reviewData = await fetchStudioCaseReview(runId, groupId, caseId);
        if (!disposed) {
          setData(reviewData);
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Failed to load case review data');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      disposed = true;
    };
  }, [caseId, groupId, runId]);

  const messages = useMemo(() => data?.result?.normalized_messages ?? [], [data]);
  const specVersion = data?.result?.spec_version === '0.8' ? '0.8' : '0.9';
  const surface = useA2UISurface(messages, specVersion);

  if (loading) {
    return <PageState message="Loading case review…" />;
  }

  if (error || !data) {
    return <PageState message={error ?? 'Case review data is unavailable'} />;
  }

  const validationErrors = data.result?.validation?.errors ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4 md:p-6">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Link
              href={`/studio/run/${runId}`}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to run
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{caseId}</h1>
            <p className="text-sm text-muted-foreground">{String(data.caseRecord.prompt ?? '')}</p>
          </div>
          <Button variant="outline" onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Reload case
          </Button>
        </div>

        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1 rounded-3xl border border-white/70 bg-white/70 shadow-sm backdrop-blur-sm">
          <ResizablePanel defaultSize={24} minSize={18} className="min-h-0">
            <aside className="flex h-full flex-col gap-5 overflow-auto p-5">
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-foreground">Case metadata</h2>
                <dl className="space-y-2 text-sm">
                  <MetaRow label="Run" value={runId} />
                  <MetaRow label="Group" value={groupId} />
                  <MetaRow label="Status" value={data.status.status} />
                  <MetaRow label="Renderer" value={String(data.result?.renderer ?? data.caseRecord['renderer'] ?? 'react')} />
                  <MetaRow label="Spec" value={String(data.result?.spec_version ?? data.caseRecord['spec_version'] ?? '0.9')} />
                  <MetaRow label="Catalog Profile" value={String(data.result?.catalog_profile_id ?? data.result?.metadata?.catalogProfileId ?? data.caseRecord['catalog_profile_id'] ?? 'default')} />
                  <MetaRow label="Catalog ID" value={String(data.result?.metadata?.catalogId ?? data.caseRecord['catalog_id'] ?? 'default')} />
                </dl>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Validation summary
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
                  {data.result?.validation?.pass ? (
                    <span className="text-emerald-700">Protocol validation passed.</span>
                  ) : validationErrors.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {validationErrors.map(errorMessage => (
                        <li key={errorMessage}>{errorMessage}</li>
                      ))}
                    </ul>
                  ) : (
                    'No validation details available.'
                  )}
                </div>
              </section>
            </aside>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={46} minSize={30} className="min-h-0 border-x border-border/50">
            <div className="flex h-full flex-col overflow-hidden p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <PanelRight className="h-4 w-4 text-primary" />
                Render preview
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-2xl border border-border/60 bg-muted/20 p-4">
                {messages.length > 0 ? (
                  <div className="min-h-[280px] w-full max-w-3xl rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
                    <A2UIViewer
                      root={surface.root}
                      components={surface.components}
                      data={surface.data}
                      specVersion={data.result?.spec_version === '0.8' ? '0.8' : '0.9'}
                    />
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No normalized messages available yet.</div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={30} minSize={22} className="min-h-0">
            <div className="flex h-full flex-col overflow-auto p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileJson className="h-4 w-4 text-primary" />
                Evidence
              </div>

              <EvidenceSection title="Manifest" payload={data.manifest} />
              <EvidenceSection title="Result" payload={data.result ?? {}} />
              <EvidenceSection title="Case record" payload={data.caseRecord} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function PageState({message}: {message: string}) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="rounded-2xl border bg-white/80 px-6 py-5 text-sm text-muted-foreground shadow-sm">
        {message}
      </div>
    </div>
  );
}

function MetaRow({label, value}: {label: string; value: string}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-background/70 p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-all text-foreground">{value}</dd>
    </div>
  );
}

function EvidenceSection({title, payload}: {title: string; payload: unknown}) {
  return (
    <section className="mb-4 rounded-2xl border border-border/60 bg-background/70 p-4">
      <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </section>
  );
}
