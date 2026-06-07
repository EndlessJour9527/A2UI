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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  StudioBootstrapData,
  StudioCaseIndexEntry,
  StudioGroupIndexEntry,
  StudioRunIndexEntry,
} from '@/types/studio';
import {getStudioBootstrap, saveStudioBootstrap} from '@/lib/studio-storage';

interface StudioContextValue {
  bootstrap: StudioBootstrapData | null;
  loading: boolean;
  refresh: () => Promise<void>;
  runs: StudioRunIndexEntry[];
  groups: StudioGroupIndexEntry[];
  cases: StudioCaseIndexEntry[];
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({children}: {children: ReactNode}) {
  const [bootstrap, setBootstrap] = useState<StudioBootstrapData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/studio/bootstrap', {cache: 'no-store'});
      if (!response.ok) {
        throw new Error(`Failed to load studio bootstrap: ${response.status}`);
      }
      const data = (await response.json()) as StudioBootstrapData;
      setBootstrap(data);
      await saveStudioBootstrap(data);
    } catch {
      const cached = await getStudioBootstrap();
      setBootstrap(cached);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<StudioContextValue>(
    () => ({
      bootstrap,
      loading,
      refresh,
      runs: bootstrap?.runs ?? [],
      groups: bootstrap?.groups ?? [],
      cases: bootstrap?.cases ?? [],
    }),
    [bootstrap, loading, refresh],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) {
    throw new Error('useStudio must be used within a StudioProvider');
  }
  return context;
}
