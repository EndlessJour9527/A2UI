import {describe, expect, it} from 'vitest';
import {eventsForLatestExecution, findLatestExecutionStartIndex} from './studio-run-events';

describe('studio run event boundaries', () => {
  it('prefers the most recent execution_started event', () => {
    const events = [
      {event_type: 'run.created', payload: {completionProvider: 'mock'}},
      {event_type: 'case.started', payload: {caseId: 'case-1'}},
      {
        event_type: 'run.execution_started',
        payload: {completionProvider: 'nvidia:deepseek-ai/deepseek-v4-flash', executionId: 'exec-old'},
      },
      {event_type: 'group.started', payload: {groupId: 'group-1'}},
      {
        event_type: 'run.execution_started',
        payload: {completionProvider: 'nvidia:z-ai/glm-5.1', executionId: 'exec-new'},
      },
      {event_type: 'case.started', payload: {caseId: 'case-2'}},
    ];

    expect(findLatestExecutionStartIndex(events)).toBe(4);
    expect(eventsForLatestExecution(events)).toEqual(events.slice(5));
  });

  it('falls back to the last run.created event for older artifacts', () => {
    const events = [
      {event_type: 'run.created', payload: {completionProvider: 'mock'}},
      {event_type: 'case.started', payload: {caseId: 'case-1'}},
      {event_type: 'run.created', payload: {completionProvider: 'mock'}},
      {event_type: 'group.started', payload: {groupId: 'group-1'}},
    ];

    expect(findLatestExecutionStartIndex(events)).toBe(2);
    expect(eventsForLatestExecution(events)).toEqual(events.slice(3));
  });
});
