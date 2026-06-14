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
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileJson,
  PanelRight,
  RefreshCw,
  ShieldCheck,
  CheckCircle,
  HelpCircle,
  MessageSquare,
  FileCode,
  Info,
  Layers
} from 'lucide-react';
import {ResizableHandle, ResizablePanel, ResizablePanelGroup} from '@/components/ui/resizable';
import {Button} from '@/components/ui/button';
import {A2UIViewer} from '@/lib/a2ui';
import {useA2UISurface} from '@/components/theater/useA2UISurface';
import {fetchStudioCaseReview} from '@/lib/studio-api';
import type {StudioCaseReviewData, StudioAnnotation} from '@/types/studio';

export default function StudioCasePage({
  params,
  searchParams,
}: {
  params: Promise<{runId: string; groupId: string; caseId: string}>;
  searchParams: Promise<{executionId?: string}>;
}) {
  const resolvedParams = use(params);
  const resolvedSearchParams = use(searchParams);
  const runId = resolvedParams.runId;
  const groupId = resolvedParams.groupId;
  const caseId = resolvedParams.caseId;
  const executionId = resolvedSearchParams.executionId;

  const [data, setData] = useState<StudioCaseReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Interactive Replay Step index
  const [activeStepIndex, setActiveStepIndex] = useState<number>(-1);

  // Tab State for right panel
  const [activeTab, setActiveTab] = useState<'timeline' | 'trace' | 'catalog' | 'metadata'>('timeline');

  // Annotation states
  const [annotations, setAnnotations] = useState<{labels: StudioAnnotation[]; notes: StudioAnnotation[]}>({labels: [], notes: []});
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [noteText, setNoteText] = useState<string>('');
  const [savingAnno, setSavingAnno] = useState(false);

  // Load case review data
  useEffect(() => {
    let disposed = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const reviewData = await fetchStudioCaseReview(runId, groupId, caseId, executionId);
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
  }, [caseId, groupId, runId, executionId]);

  // Load annotations
  useEffect(() => {
    async function loadAnnos() {
      try {
        const res = await fetch(`/api/studio/annotations?runId=${runId}&groupId=${groupId}&caseId=${caseId}`);
        if (res.ok) {
          const annData = await res.json();
          setAnnotations(annData);
          // Set initial dropdown value if manual label exists
          const myLabel = annData.labels.find((l: any) => l.author === 'manual_reviewer');
          if (myLabel) {
            setSelectedLabel(myLabel.value);
          }
        }
      } catch (err) {
        console.error('Failed to load annotations:', err);
      }
    }
    void loadAnnos();
  }, [runId, groupId, caseId]);

  const protocolId = String(data?.result?.protocol_id ?? data?.protocol?.protocolId ?? data?.caseRecord['protocol_id'] ?? 'a2ui');
  const protocolVersion = String(
    data?.result?.protocol_version
      ?? data?.protocol?.protocolVersion
      ?? data?.caseRecord['protocol_version']
      ?? data?.result?.spec_version
      ?? '0.9',
  );
  const protocolProfileId = data?.result?.protocol_profile_id
    ?? data?.protocol?.protocolProfileId
    ?? data?.caseRecord['protocol_profile_id'];
  const catalogProfileId = data?.result?.catalog_profile_id ?? data?.caseRecord['catalog_profile_id'];
  const isA2UI = protocolId === 'a2ui';
  const messages = useMemo(() => data?.result?.normalized_messages ?? [], [data]);
  const specVersion = isA2UI && protocolVersion === '0.8' ? '0.8' : '0.9';

  // Sliced messages based on interactive replay index
  useEffect(() => {
    if (messages.length > 0) {
      setActiveStepIndex(messages.length - 1);
    } else {
      setActiveStepIndex(-1);
    }
  }, [messages]);

  const activeMessages = useMemo(() => {
    if (activeStepIndex === -1 || activeStepIndex >= messages.length) return messages;
    return messages.slice(0, activeStepIndex + 1);
  }, [messages, activeStepIndex]);

  const surface = useA2UISurface(isA2UI ? activeMessages : [], specVersion);

  const steps = useMemo(() => {
    return messages.map((msg: any, idx: number) => {
      const type = Object.keys(msg).find(k => k !== 'version') || 'unknown';
      return {
        index: idx,
        type,
        payload: msg[type],
      };
    });
  }, [messages]);

  // Save manual label annotation
  const handleSaveLabel = async (label: string) => {
    if (!label) return;
    setSelectedLabel(label);
    setSavingAnno(true);
    try {
      const res = await fetch('/api/studio/annotations', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          runId,
          groupId,
          caseId,
          type: 'label',
          value: label,
          author: 'manual_reviewer',
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setAnnotations(result.annotations);
      }
    } catch (err) {
      console.error('Failed to save label annotation:', err);
    } finally {
      setSavingAnno(false);
    }
  };

  // Save manual note annotation
  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    setSavingAnno(true);
    try {
      const res = await fetch('/api/studio/annotations', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          runId,
          groupId,
          caseId,
          type: 'note',
          value: noteText.trim(),
          author: 'manual_reviewer',
        }),
      });
      if (res.ok) {
        const result = await res.json();
        setAnnotations(result.annotations);
        setNoteText('');
      }
    } catch (err) {
      console.error('Failed to save note annotation:', err);
    } finally {
      setSavingAnno(false);
    }
  };

  if (loading) {
    return <PageState message="Loading case review…" />;
  }

  if (error || !data) {
    return <PageState message={error ?? 'Case review data is unavailable'} />;
  }

  // Parse categorized issues
  const issues = (data.result?.validation?.issues as any[]) || (data.result?.validation?.errors || []).map((err: string) => ({
    message: err,
    category: 'schema_component',
  }));

  const groupedIssues: Record<string, any[]> = issues.reduce((acc: Record<string, any[]>, issue: any) => {
    const cat = issue.category || 'schema_component';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(issue);
    return acc;
  }, {});

  const catalogId = (data.result?.metadata?.catalogId ?? data.caseRecord['catalog_id']) as string | undefined;

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4 md:p-6">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Link
              href={`/studio/run/${runId}${executionId ? `?executionId=${executionId}` : ''}`}
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

        {/* Resizable Layout */}
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1 rounded-3xl border border-white/70 bg-white/70 shadow-sm backdrop-blur-sm">
          {/* LEFT PANEL: Metadata & Diagnostics & Annotations */}
          <ResizablePanel defaultSize={26} minSize={20} className="min-h-0">
            <aside className="flex h-full flex-col gap-6 overflow-auto p-5 border-r border-border/40">
              {/* Metadata */}
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Case metadata</h2>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-border/40 bg-background/50 p-2">
                    <dt className="text-[10px] uppercase text-muted-foreground">Status</dt>
                    <dd className="font-medium mt-0.5 capitalize">{data.status.status.replace(/_/g, ' ')}</dd>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-background/50 p-2">
                    <dt className="text-[10px] uppercase text-muted-foreground">Protocol</dt>
                    <dd className="font-medium mt-0.5">
                      <ProtocolBadge protocolId={protocolId} protocolVersion={protocolVersion} />
                    </dd>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-background/50 p-2 col-span-2">
                    <dt className="text-[10px] uppercase text-muted-foreground">Renderer</dt>
                    <dd className="font-medium mt-0.5 capitalize">{String(data.result?.renderer ?? data.caseRecord['renderer'] ?? 'react')}</dd>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-background/50 p-2 col-span-2">
                    <dt className="text-[10px] uppercase text-muted-foreground">Protocol Profile</dt>
                    <dd className="font-medium mt-0.5 truncate">{String(protocolProfileId ?? 'default')}</dd>
                  </div>
                  {isA2UI && (
                    <div className="rounded-xl border border-border/40 bg-background/50 p-2 col-span-2">
                    <dt className="text-[10px] uppercase text-muted-foreground">Catalog Profile</dt>
                    <dd className="font-medium mt-0.5 truncate">{String(catalogProfileId ?? 'default')}</dd>
                    </div>
                  )}
                </dl>
              </section>

              {/* Validation Diagnostics */}
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Validation diagnostics
                </h2>
                <div className="space-y-2">
                  {data.result?.validation?.pass ? (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs font-medium text-emerald-800">
                      Protocol validation passed.
                    </div>
                  ) : Object.keys(groupedIssues).length > 0 ? (
                    Object.entries(groupedIssues).map(([cat, catIssues]) => (
                      <div key={cat} className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-rose-700 capitalize">
                          {cat.replace(/_/g, ' ')} ({catIssues.length})
                        </div>
                        <div className="space-y-3">
                          {catIssues.map((issue, idx) => {
                            const severity = issue.severity || 'error';
                            const isWarning = severity === 'warning';
                            const badgeColor = isWarning
                              ? 'bg-amber-100/70 text-amber-800 border-amber-300/50'
                              : 'bg-rose-100/70 text-rose-800 border-rose-300/50';

                            return (
                              <div key={idx} className="space-y-1 text-xs">
                                <div className="flex items-start gap-2">
                                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${badgeColor} shrink-0 mt-0.5`}>
                                    {severity}
                                  </span>
                                  <span className="font-medium text-rose-950 break-all leading-normal flex-1">
                                    {issue.message}
                                  </span>
                                </div>
                                {issue.suggestedFix && (
                                  <div className="ml-10 text-[10px] text-muted-foreground font-medium leading-relaxed italic bg-black/5 rounded-lg p-1.5 mt-1 border border-border/10">
                                    <span className="font-semibold text-foreground not-italic">Fix suggestion:</span> {issue.suggestedFix}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-border/60 bg-background/40 p-4 text-xs text-muted-foreground">
                      No validation details available.
                    </div>
                  )}
                </div>
              </section>

              {/* Annotation Panel */}
              <section className="space-y-4 pt-4 border-t border-border/40">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  Reviewer Annotations
                </h2>

                {/* Select Label */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Annotation Label</label>
                  <select
                    value={selectedLabel}
                    onChange={e => handleSaveLabel(e.target.value)}
                    disabled={savingAnno}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">-- Mark case status --</option>
                    <option value="correct">Correct (Pass)</option>
                    <option value="partial">Partial Credit</option>
                    <option value="incorrect">Incorrect (Fail)</option>
                    <option value="hallucination">Schema Hallucination</option>
                    <option value="rendering_issue">Rendering Issue</option>
                    <option value="prompt_issue">Prompt/Context Issue</option>
                    <option value="needs_review">Needs Review</option>
                  </select>
                </div>

                {/* Add Note */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Reviewer Note</label>
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    placeholder="Enter review findings or comments..."
                    disabled={savingAnno}
                    className="w-full min-h-[70px] rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                  />
                  <Button
                    onClick={handleSaveNote}
                    disabled={savingAnno || !noteText.trim()}
                    className="w-full text-xs py-1.5 h-auto rounded-xl"
                  >
                    Add note
                  </Button>
                </div>

                {/* Notes History */}
                {annotations.notes.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Notes history</label>
                    <div className="space-y-2">
                      {annotations.notes.map((n: any, idx) => (
                        <div key={idx} className="rounded-xl border border-border bg-background/30 p-3 text-xs space-y-1">
                          <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                            <span className="font-semibold">{n.author}</span>
                            <span>{new Date(n.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-foreground text-xs leading-relaxed whitespace-pre-wrap">{n.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </aside>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* CENTER PANEL: Interactive Canvas Replay */}
          <ResizablePanel defaultSize={44} minSize={30} className="min-h-0">
            <div className="flex h-full flex-col overflow-hidden p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <PanelRight className="h-4 w-4 text-primary" />
                  Render preview
                </div>
              </div>

              {/* Interactive Replay Timeline Scrubber */}
              {steps.length > 0 && (
                <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-border/40 bg-background/30 p-3 shadow-sm select-none">
                  <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>Replay Timeline Scrubber</span>
                    <span className="text-primary font-semibold">
                      Step {activeStepIndex + 1} of {steps.length}: <span className="capitalize">{steps[activeStepIndex]?.type.replace(/([A-Z])/g, ' $1')}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-1">
                    <button
                      onClick={() => setActiveStepIndex(Math.max(0, activeStepIndex - 1))}
                      disabled={activeStepIndex <= 0}
                      className="rounded-lg p-1.5 hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-all"
                      title="Previous Step"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>

                    <div className="relative flex flex-1 items-center h-6">
                      {/* Track Background */}
                      <div className="absolute left-1 right-1 h-1 rounded-full bg-secondary" />

                      {/* Filled Track Progress */}
                      <div
                        className="absolute left-1 h-1 rounded-full bg-primary/60 transition-all duration-200"
                        style={{ width: `${(activeStepIndex / Math.max(1, steps.length - 1)) * 100}%` }}
                      />

                      {/* Markers */}
                      <div className="absolute left-1 right-1 flex justify-between items-center">
                        {steps.map((step) => {
                          const isActive = activeStepIndex === step.index;
                          const isPassed = step.index < activeStepIndex;

                          let markerStyle = "bg-background border-muted-foreground/50 hover:border-primary";
                          if (isActive) {
                            markerStyle = "bg-primary border-primary ring-4 ring-primary/20 scale-125";
                          } else if (isPassed) {
                            markerStyle = "bg-primary/80 border-primary/80 hover:bg-primary";
                          }

                          return (
                            <button
                              key={step.index}
                              onClick={() => setActiveStepIndex(step.index)}
                              className={`h-3 w-3 rounded-full border cursor-pointer transition-all duration-200 ${markerStyle} flex items-center justify-center`}
                              title={`Step ${step.index + 1}: ${step.type}`}
                            />
                          );
                        })}
                      </div>
                    </div>

                    <button
                      onClick={() => setActiveStepIndex(Math.min(steps.length - 1, activeStepIndex + 1))}
                      disabled={activeStepIndex >= steps.length - 1}
                      className="rounded-lg p-1.5 hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-all"
                      title="Next Step"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Render Window */}
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-2xl border border-border/60 bg-muted/20 p-4">
                {isA2UI && activeMessages.length > 0 ? (
                  <div className="min-h-[300px] w-full max-w-3xl rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
                    <A2UIViewer
                      root={surface.root}
                      components={surface.components}
                      data={surface.data}
                      specVersion={specVersion}
                      catalogId={catalogId}
                      messages={activeMessages}
                    />
                  </div>
                ) : !isA2UI && activeMessages.length > 0 ? (
                  <div className="w-full max-w-3xl rounded-2xl border border-border/50 bg-white p-6 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ProtocolBadge protocolId={protocolId} protocolVersion={protocolVersion} />
                      Normalized protocol payload
                    </div>
                    <pre className="max-h-[520px] overflow-auto rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
                      {JSON.stringify(activeMessages, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No rendering output for this step.</div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT PANEL: Evidence Tabbed View */}
          <ResizablePanel defaultSize={30} minSize={20} className="min-h-0">
            <div className="flex h-full flex-col overflow-hidden">
              {/* Tab Navigation */}
              <div className="flex border-b border-border/40 bg-background/50 px-2 pt-2">
                <TabButton label="Timeline" active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} />
                <TabButton label="Trace" active={activeTab === 'trace'} onClick={() => setActiveTab('trace')} />
                <TabButton label="Catalog" active={activeTab === 'catalog'} onClick={() => setActiveTab('catalog')} />
                <TabButton label="Metadata" active={activeTab === 'metadata'} onClick={() => setActiveTab('metadata')} />
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-auto p-5">
                {activeTab === 'timeline' && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-primary" />
                      Replay Timeline Steps
                    </h3>
                    <div className="space-y-2">
                      {steps.map(step => (
                        <div
                          key={step.index}
                          onClick={() => setActiveStepIndex(step.index)}
                          className={`cursor-pointer rounded-2xl border p-4 text-xs transition-all ${
                            activeStepIndex === step.index
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border/60 bg-background/50 hover:bg-background/80'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-foreground capitalize">
                              Step {step.index + 1}: {step.type.replace(/([A-Z])/g, ' $1')}
                            </span>
                            {activeStepIndex === step.index && (
                              <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-semibold">
                                Active Step
                              </span>
                            )}
                          </div>
                          <pre className="overflow-x-auto text-[10px] bg-muted/40 p-2 rounded-xl text-muted-foreground">
                            {JSON.stringify(step.payload, null, 2)}
                          </pre>
                        </div>
                      ))}
                      {steps.length === 0 && (
                        <div className="text-xs text-muted-foreground text-center py-6">
                          No messages received in this case.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'trace' && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileCode className="h-4 w-4 text-primary" />
                      Reasoning Trace & Raw Completion
                    </h3>
                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground leading-relaxed font-mono">
                        {data.result?.raw_completion || 'No raw completion trace stored for this case.'}
                      </pre>
                    </div>
                  </div>
                )}

                {activeTab === 'catalog' && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileJson className="h-4 w-4 text-primary" />
                      {isA2UI ? 'Catalog components schema' : 'Protocol metadata'}
                    </h3>
                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                      <pre className="overflow-x-auto text-[11px] text-muted-foreground">
                        {JSON.stringify(isA2UI ? data.catalog || {info: 'Catalog schema details not resolved on server'} : data.protocol || {info: 'Protocol metadata not resolved on server'}, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {activeTab === 'metadata' && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Info className="h-4 w-4 text-primary" />
                      Additional Case metadata
                    </h3>
                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4 space-y-3 text-xs">
                      <div>
                        <div className="font-semibold text-muted-foreground mb-1">Target component description:</div>
                        <p className="text-foreground bg-muted/40 p-3 rounded-xl">{String(data.caseRecord.target ?? 'No target details available.')}</p>
                      </div>
                      <div>
                        <div className="font-semibold text-muted-foreground mb-1">Run JSON definition:</div>
                        <pre className="overflow-x-auto bg-muted/40 p-3 rounded-xl text-[10px] text-muted-foreground">
                          {JSON.stringify(data.caseRecord, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-4 py-2 text-xs font-medium transition-colors focus:outline-none ${
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
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
    <span className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
      {id}@{version}
    </span>
  );
}
