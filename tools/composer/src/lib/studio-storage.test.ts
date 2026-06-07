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

import {describe, it, expect, vi, beforeEach} from 'vitest';
import localforage from 'localforage';
import {getStudioBootstrap, saveStudioBootstrap} from './studio-storage';
import type {StudioBootstrapData} from '@/types/studio';

vi.mock('localforage', () => {
  const createInstance = vi.fn(() => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
  }));
  return {
    default: {
      createInstance,
    },
  };
});

describe('studio-storage', () => {
  const instance = vi.mocked(localforage.createInstance).mock.results[0]?.value ?? {
    getItem: vi.fn(),
    setItem: vi.fn(),
  };

  const bootstrap: StudioBootstrapData = {
    studioRoot: '/tmp/.a2ui-eval-studio',
    runs: [],
    groups: [],
    cases: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no bootstrap is stored', async () => {
    vi.mocked(instance.getItem).mockResolvedValue(null);
    await expect(getStudioBootstrap()).resolves.toBeNull();
  });

  it('returns stored bootstrap payload', async () => {
    vi.mocked(instance.getItem).mockResolvedValue(bootstrap);
    await expect(getStudioBootstrap()).resolves.toEqual(bootstrap);
  });

  it('persists studio bootstrap payload', async () => {
    await saveStudioBootstrap(bootstrap);
    expect(instance.setItem).toHaveBeenCalledWith('studio-bootstrap', bootstrap);
  });
});
