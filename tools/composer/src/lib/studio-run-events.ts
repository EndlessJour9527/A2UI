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

export interface StudioEventLike {
  event_type?: string;
  payload?: {
    executionId?: string;
    [key: string]: unknown;
  };
}

export function findLatestExecutionStartIndex(events: StudioEventLike[]): number | undefined {
  const lastExecutionStartIndex = events
    .map((event, index) => ({event, index}))
    .filter(item => item.event.event_type === 'run.execution_started')
    .at(-1)?.index;

  if (lastExecutionStartIndex !== undefined) {
    return lastExecutionStartIndex;
  }

  return events
    .map((event, index) => ({event, index}))
    .filter(item => item.event.event_type === 'run.created')
    .at(-1)?.index;
}

export function eventsForLatestExecution<T extends StudioEventLike>(
  events: T[],
  latestExecutionStartIndex?: number,
): T[] {
  if (typeof latestExecutionStartIndex === 'number') {
    return events.slice(latestExecutionStartIndex + 1);
  }

  const boundaryIndex = findLatestExecutionStartIndex(events);
  if (typeof boundaryIndex === 'number') {
    return events.slice(boundaryIndex + 1);
  }
  return events;
}
