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

import {useState, useRef} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {
  ArrowLeft,
  FileUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  Layers,
  FileSpreadsheet,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useStudio} from '@/contexts/studio-context';

export default function CreateRunPage() {
  const router = useRouter();
  const {refresh, bootstrap} = useStudio();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [modelType, setModelType] = useState('google/gemini-2.5-flash');
  const [customModel, setCustomModel] = useState('');
  const [gradingModelType, setGradingModelType] = useState('google/gemini-2.5-flash');
  const [customGradingModel, setCustomGradingModel] = useState('');
  const [catalogProfileId, setCatalogProfileId] = useState('a2ui-basic-v0_9');
  const [executionMode, setExecutionMode] = useState<'serial' | 'parallel'>('serial');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdRun, setCreatedRun] = useState<any | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (
        droppedFile.name.endsWith('.xlsx') ||
        droppedFile.name.endsWith('.json') ||
        droppedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        droppedFile.type === 'application/json'
      ) {
        setFile(droppedFile);
        if (!name) {
          setName(droppedFile.name.replace(/\.(xlsx|json)$/, '') + ' - Run');
        }
      } else {
        setError('Only Excel (.xlsx) or JSON (.json) files are supported.');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!name) {
        setName(selectedFile.name.replace(/\.(xlsx|json)$/, '') + ' - Run');
      }
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetModel = modelType === 'custom' ? customModel : modelType;
    const targetGradingModel = gradingModelType === 'custom' ? customGradingModel : gradingModelType;

    if (!file || !targetModel || !name) {
      setError('Please fill in all required fields and select an Excel/JSON file.');
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('model', targetModel);
    formData.append('gradingModel', targetGradingModel);
    formData.append('catalogProfileId', catalogProfileId);
    formData.append('executionMode', executionMode);

    try {
      const response = await fetch('/api/studio/runs/create', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Upload failed with status ${response.status}`);
      }

      const result = await response.json();
      setCreatedRun(result);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during run creation.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6 md:p-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="space-y-2">
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to runs
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Phase 2 Creator
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Create run from Excel or JSON
          </h1>
          <p className="text-sm text-muted-foreground">
            Import an Excel spreadsheet (`.xlsx`) or JSON file (`.json`) to dynamically parse prompts, resolve catalog
            profiles, and initialize a new test execution run.
          </p>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <span className="font-semibold">Creation failed:</span> {error}
            </div>
          </div>
        )}

        {!createdRun ? (
          <form onSubmit={handleSubmit} className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-6 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
              <h2 className="text-lg font-semibold">1. Select Test Set Spreadsheet or JSON</h2>

              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={triggerFileInput}
                className={`flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-all cursor-pointer ${
                  dragActive
                    ? 'border-primary bg-primary/5'
                    : file
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-border/80 hover:border-primary/50 hover:bg-muted/10'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.json"
                  className="hidden"
                  onChange={handleFileChange}
                />

                {file ? (
                  <>
                    <div className="rounded-2xl bg-emerald-500/10 p-4 text-emerald-700">
                      <FileSpreadsheet className="h-10 w-10" />
                    </div>
                    <div>
                      <div className="font-semibold text-foreground truncate max-w-md">
                        {file.name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB · File ready
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-2xl bg-muted p-4 text-muted-foreground">
                      <FileUp className="h-10 w-10" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">
                        Drag and drop your Excel or JSON file here
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Supports standard .xlsx test sheets or .json files
                      </div>
                    </div>
                  </>
                )}
                <Button type="button" variant="outline" size="sm" className="pointer-events-none">
                  {file ? 'Change file' : 'Browse files'}
                </Button>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Run metadata</h3>
                <div className="grid gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Run Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Flight Booking Prompts V1"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-background px-4 py-2.5 text-sm outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm">
              <h2 className="text-lg font-semibold">2. Configuration</h2>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Target Model <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={modelType}
                    onChange={e => setModelType(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-background px-4 py-2 text-sm outline-none focus:border-primary"
                  >
                    {bootstrap?.providers
                      ?.filter(p => p.id !== 'mock' && p.id !== 'static')
                      ?.map(p => (
                        <optgroup key={p.id} label={p.name}>
                          {p.models.map(m => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    <optgroup label="Other">
                      <option value="custom">Other / Custom Model...</option>
                    </optgroup>
                  </select>
                  {modelType === 'custom' && (
                    <input
                      type="text"
                      required
                      placeholder="Enter custom model (e.g. google/gemini-2.5-flash)"
                      value={customModel}
                      onChange={e => setCustomModel(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-background px-4 py-2 text-sm outline-none focus:border-primary mt-2"
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Grading Model
                  </label>
                  <select
                    value={gradingModelType}
                    onChange={e => setGradingModelType(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-background px-4 py-2 text-sm outline-none focus:border-primary"
                  >
                    {bootstrap?.providers
                      ?.filter(p => p.id !== 'mock' && p.id !== 'static')
                      ?.map(p => (
                        <optgroup key={p.id} label={p.name}>
                          {p.models.map(m => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    <optgroup label="Other">
                      <option value="custom">Other / Custom Model...</option>
                    </optgroup>
                  </select>
                  {gradingModelType === 'custom' && (
                    <input
                      type="text"
                      required
                      placeholder="Enter custom grading model"
                      value={customGradingModel}
                      onChange={e => setCustomGradingModel(e.target.value)}
                      className="w-full rounded-xl border border-border/80 bg-background px-4 py-2 text-sm outline-none focus:border-primary mt-2"
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Catalog Profile
                  </label>
                  <select
                    value={catalogProfileId}
                    onChange={e => setCatalogProfileId(e.target.value)}
                    className="w-full rounded-xl border border-border/80 bg-background px-4 py-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="a2ui-basic-v0_9">A2UI Basic Catalog v0.9 (React)</option>
                    <option value="ink-a2ui-v0_9">Ink Custom Catalog v0.9 (Canvas)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Execution Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setExecutionMode('serial')}
                      className={`rounded-xl border py-2 text-xs font-medium transition-all ${
                        executionMode === 'serial'
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/10'
                      }`}
                    >
                      Serial (Serial)
                    </button>
                    <button
                      type="button"
                      onClick={() => setExecutionMode('parallel')}
                      className={`rounded-xl border py-2 text-xs font-medium transition-all ${
                        executionMode === 'parallel'
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/10'
                      }`}
                    >
                      Parallel (MVP Serial)
                    </button>
                  </div>
                </div>

                <Button type="submit" disabled={loading} className="w-full gap-2 mt-4">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Initializing run…
                    </>
                  ) : (
                    'Parse Excel & Create Run'
                  )}
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <section className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-sm space-y-6">
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 className="h-6 w-6" />
              <div>
                <h2 className="text-xl font-semibold">Run successfully initialized!</h2>
                <p className="text-sm text-emerald-700/80">
                  Spreadsheet parsed and filesystem layout created.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4 rounded-2xl border bg-background/50 p-4 text-sm">
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Run ID</span>
                <div className="font-semibold truncate">{createdRun.runId}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Groups</span>
                <div className="font-semibold">{createdRun.groupsCount} groups</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Cases</span>
                <div className="font-semibold">{createdRun.totalCases} cases total</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Profile</span>
                <div className="font-semibold">{createdRun.catalogProfileId}</div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-primary" />
                Parsed Case Attempts
              </h3>
              <div className="overflow-hidden rounded-2xl border border-border/60">
                <div className="grid grid-cols-[1.5fr_1fr_3fr] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Case ID</span>
                  <span>Group</span>
                  <span>Parameters / Spec</span>
                </div>
                {createdRun.plan.case_attempts.map((attempt: any, idx: number) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1.5fr_1fr_3fr] items-center gap-3 border-b border-border/50 px-4 py-3 text-xs last:border-b-0"
                  >
                    <span className="font-medium text-foreground">{attempt.caseId}</span>
                    <span className="text-muted-foreground">{attempt.groupId}</span>
                    <span className="text-muted-foreground truncate">
                      {attempt.renderer} · spec {attempt.specVersion} · profile{' '}
                      {attempt.catalogProfileId}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setCreatedRun(null)}>
                Upload another
              </Button>
              <Button asChild>
                <Link href={`/studio/run/${createdRun.runId}`}>
                  Go to Run Details
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
