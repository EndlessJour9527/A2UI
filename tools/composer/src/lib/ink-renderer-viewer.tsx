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

import {useEffect, useRef, useState} from 'react';
import {createInkView, type InkView} from '@yodaos-pkg/ink';

export interface InkRendererViewerProps {
  root?: string;
  components?: any[];
  data?: Record<string, any>;
  onAction?: (action: any) => void;
  // Raw messages list containing the A2UI v0.9 command stream
  messages?: any[];
}

export function InkRendererViewer({messages = []}: InkRendererViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<InkView | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Map incoming messages to surface ID 'launcher-a2ui' so that it matches
  // the A2UI component in Ink's launchers/pages/a2ui/index.ink
  const mappedMessages = useEffectEvent(() => {
    return messages.map(msg => {
      if (!msg) return msg;
      if (msg.createSurface) {
        return {
          ...msg,
          createSurface: {
            ...msg.createSurface,
            surfaceId: 'launcher-a2ui',
          },
        };
      }
      if (msg.updateComponents) {
        return {
          ...msg,
          updateComponents: {
            ...msg.updateComponents,
            surfaceId: 'launcher-a2ui',
          },
        };
      }
      if (msg.updateDataModel) {
        return {
          ...msg,
          updateDataModel: {
            ...msg.updateDataModel,
            surfaceId: 'launcher-a2ui',
          },
        };
      }
      if (msg.deleteSurface) {
        return {
          ...msg,
          deleteSurface: {
            ...msg.deleteSurface,
            surfaceId: 'launcher-a2ui',
          },
        };
      }
      return msg;
    });
  });

  // Initialize view
  useEffect(() => {
    let disposed = false;
    let viewInstance: InkView | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      try {
        setLoading(true);
        setInitError(null);

        // Create the InkView instance
        viewInstance = await createInkView({
          width: container.clientWidth || 375,
          height: container.clientHeight || 500,
          scaleFactor: window.devicePixelRatio || 1,
          canvas,
          wasm: {
            wasmUrl: '/ink_web_bg.wasm',
          },
        });

        if (disposed) {
          viewInstance.destroy();
          return;
        }

        viewRef.current = viewInstance;

        // Bind keyboard, pointer and focus event listeners
        viewInstance.bindDomEvents();

        // Listen for close requested
        viewInstance.setOnCloseRequested(() => {
          if (viewInstance?.isCloseRequested()) {
            viewInstance.destroy();
          }
          return true;
        });

        // Open the builtin A2UI receiver app
        viewInstance.open('ink://launchers', 'pages/a2ui/index');

        // Start render frame loop
        viewInstance.startRendering();

        // Set up ResizeObserver to handle container layout changes
        let lastWidth = 0;
        let lastHeight = 0;
        let lastScale = 0;

        resizeObserver = new ResizeObserver(entries => {
          if (entries[0] && viewInstance) {
            const {width, height} = entries[0].contentRect;
            const scale = window.devicePixelRatio || 1;
            if (width !== lastWidth || height !== lastHeight || scale !== lastScale) {
              lastWidth = width;
              lastHeight = height;
              lastScale = scale;
              viewInstance.setViewport(
                width || 375,
                height || 500,
                scale,
              );
            }
          }
        });
        resizeObserver.observe(container);

        setLoading(false);

        // Dispatch initial messages if any are already present
        const currentMessages = mappedMessages();
        if (currentMessages.length > 0) {
          viewInstance.dispatchMessageEvent(currentMessages, 'browser-host');
        }
      } catch (err) {
        console.error('[InkRendererViewer] Init error:', err);
        if (!disposed) {
          setInitError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }

    void init();

    return () => {
      disposed = true;
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (viewInstance) {
        viewInstance.destroy();
        viewRef.current = null;
      }
    };
  }, []);

  // Update messages when they change
  useEffect(() => {
    const view = viewRef.current;
    if (view && !loading && !initError) {
      const currentMessages = mappedMessages();
      try {
        view.dispatchMessageEvent(currentMessages, 'browser-host');
      } catch (err) {
        console.error('[InkRendererViewer] Failed to dispatch messages:', err);
      }
    }
  }, [messages, loading, initError]);

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[360px] w-full overflow-hidden rounded-2xl bg-neutral-900 border border-neutral-800"
    >
      <style>{`
        .ink-canvas-override {
          width: 100% !important;
          height: 100% !important;
          position: absolute !important;
          inset: 0 !important;
        }
      `}</style>
      <canvas
        ref={canvasRef}
        className="ink-canvas-override block"
        style={{outline: 'none', WebkitTapHighlightColor: 'transparent'}}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/80 text-sm text-neutral-400 backdrop-blur-sm">
          Loading Ink WebAssembly runtime…
        </div>
      )}
      {initError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rose-950/90 p-4 text-center text-sm text-rose-200 backdrop-blur-sm">
          <div className="font-semibold">Failed to initialize Ink Renderer</div>
          <div className="text-xs text-rose-300 max-w-md break-all">{initError}</div>
        </div>
      )}
    </div>
  );
}

// React 19 polyfill or helper for stable callback patterns
function useEffectEvent<T extends (...args: any[]) => any>(callback: T): T {
  const ref = useRef<T>(callback);
  useEffect(() => {
    ref.current = callback;
  });
  const stableRef = useRef<T | null>(null);
  if (!stableRef.current) {
    stableRef.current = ((...args: Parameters<T>): ReturnType<T> => {
      return ref.current(...args);
    }) as any;
  }
  return stableRef.current as any;
}
