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

export type StudioExecutionMode = 'serial' | 'parallel';

export type StudioRunStatus =
  | 'queued'
  | 'preparing'
  | 'running_protocol'
  | 'running_render'
  | 'collecting_device'
  | 'completed'
  | 'failed_protocol'
  | 'failed_semantic'
  | 'failed_render'
  | 'failed_device_capture'
  | 'error_infrastructure'
  | 'canceled';

export interface StudioRunIndexEntry {
  run_id: string;
  name: string;
  created_at: string;
  status: StudioRunStatus;
  model: string;
  grading_model: string;
  execution_mode: StudioExecutionMode;
  total_cases: number;
  completed_cases: number;
  failed_cases: number;
  group_ids: string[];
  renderer: string;
  protocol_id: string;
  protocol_version: string;
  protocol_profile_id?: string | null;
  protocol_options?: Record<string, unknown>;
  spec_version: string;
  catalog_profile_id?: string | null;
  latest_error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StudioGroupIndexEntry {
  runId: string;
  groupId: string;
  label: string;
  caseCount: number;
}

export interface StudioCaseIndexEntry {
  runId: string;
  groupId: string;
  caseId: string;
  prompt: string;
  status: StudioRunStatus | null;
  renderer?: string;
  protocolId?: string;
  protocolVersion?: string;
  protocolProfileId?: string | null;
  specVersion?: string;
  catalogProfileId?: string | null;
  annotationCount?: number;
  annotationLabels?: string[];
}

export interface StudioManifest {
  artifacts: Record<string, string>;
}

export interface StudioCaseStatus {
  runId: string;
  groupId: string;
  caseId: string;
  status: StudioRunStatus;
  updatedAt: string;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StudioCaseResult {
  run_id: string;
  group_id: string;
  case_id: string;
  status: StudioRunStatus;
  prompt: string;
  raw_completion?: string | null;
  parsed_messages: unknown[];
  normalized_messages: unknown[];
  validation: {
    pass?: boolean;
    errors?: string[];
    explanation?: string;
    [key: string]: unknown;
  };
  semantic_evaluation: Record<string, unknown>;
  artifacts?: Record<string, string>;
  renderer: string;
  protocol_id: string;
  protocol_version: string;
  protocol_profile_id?: string | null;
  protocol_options?: Record<string, unknown>;
  spec_version: string;
  catalog_profile_id?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StudioCaseReviewData {
  caseRecord: Record<string, unknown>;
  status: StudioCaseStatus;
  result?: StudioCaseResult;
  manifest: StudioManifest;
  protocol?: Record<string, unknown> | null;
  catalog?: Record<string, unknown> | null;
  timeline?: {
    events: Array<{
      event: string;
      timestamp: string;
      payload: Record<string, any>;
    }>;
  } | null;
}

export interface StudioProviderInfo {
  id: string;
  name: string;
  models: string[];
}

export interface StudioBootstrapData {
  studioRoot: string;
  runs: StudioRunIndexEntry[];
  groups: StudioGroupIndexEntry[];
  cases: StudioCaseIndexEntry[];
  proxy?: {
    model: string;
    port: string;
    formatted: string;
  };
  providers?: StudioProviderInfo[];
}

export type StudioAnnotationType = 'label' | 'note' | 'disposition' | 'score';

export type StudioLabel =
  | 'correct'
  | 'incorrect'
  | 'partial'
  | 'hallucination'
  | 'rendering_issue'
  | 'prompt_issue'
  | 'needs_review';

export interface StudioAnnotation {
  annotation_id: string;
  created_at: string;
  author: string;
  type: StudioAnnotationType;
  value: string;
  confidence?: number;
  source?: string;
  metadata?: Record<string, unknown>;
}
