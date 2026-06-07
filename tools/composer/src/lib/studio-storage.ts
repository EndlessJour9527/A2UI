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

import localforage from 'localforage';
import {StudioBootstrapData} from '@/types/studio';

const STUDIO_BOOTSTRAP_KEY = 'studio-bootstrap';

const studioStorage = localforage.createInstance({
  name: 'widget-builder',
  storeName: 'studio',
});

export async function getStudioBootstrap(): Promise<StudioBootstrapData | null> {
  return (await studioStorage.getItem<StudioBootstrapData>(STUDIO_BOOTSTRAP_KEY)) ?? null;
}

export async function saveStudioBootstrap(data: StudioBootstrapData): Promise<void> {
  await studioStorage.setItem(STUDIO_BOOTSTRAP_KEY, data);
}
