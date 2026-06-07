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

import {describe, it, expect} from 'vitest';
import {transpileToV0_8} from './transcoder';

describe('transpileToV0_8', () => {
  it('passes through v0.8 messages as-is', () => {
    const msg = {
      surfaceUpdate: {
        surfaceId: 'main',
        components: [
          {
            id: 'root',
            component: {Text: {text: {stringValue: 'Hello'}}},
          },
        ],
      },
    };
    expect(transpileToV0_8(msg)).toEqual(msg);
  });

  it('transpiles v0.9 type/props updateComponents message to v0.8', () => {
    const msg = {
      updateComponents: {
        surfaceId: 'main',
        components: [
          {
            id: 'root',
            type: 'Text',
            props: {
              text: 'Hello',
              variant: 'body',
              children: ['child1', 'child2'],
            },
          },
        ],
      },
    };
    expect(transpileToV0_8(msg)).toEqual({
      surfaceUpdate: {
        surfaceId: 'main',
        components: [
          {
            id: 'root',
            component: {
              Text: {
                text: {stringValue: 'Hello'},
                usageHint: 'body',
                children: {explicitList: ['child1', 'child2']},
              },
            },
          },
        ],
      },
    });
  });

  it('transpiles standard v0.9 flat component updateComponents message to v0.8', () => {
    const msg = {
      updateComponents: {
        surfaceId: 'main',
        components: [
          {
            id: 'root',
            component: 'Text',
            text: 'Hello from Eval Studio MVP',
            variant: 'body',
          },
        ],
      },
    };
    expect(transpileToV0_8(msg)).toEqual({
      surfaceUpdate: {
        surfaceId: 'main',
        components: [
          {
            id: 'root',
            component: {
              Text: {
                text: {stringValue: 'Hello from Eval Studio MVP'},
                usageHint: 'body',
              },
            },
          },
        ],
      },
    });
  });
});
