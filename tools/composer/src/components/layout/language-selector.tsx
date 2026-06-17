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

import {useTranslation} from '@/contexts/language-context';

export function LanguageSelector() {
  const {t, locale, setLocale, isLoaded} = useTranslation();

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 px-3 py-1">
        <span className="text-xs font-medium text-muted-foreground">Lang</span>
        <div className="flex flex-1 rounded-md bg-white/50 p-0.5 h-6 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <span className="text-xs font-medium text-muted-foreground">
        {t('sidebar.lang', 'Lang')}
      </span>
      <div className="flex flex-1 rounded-md bg-white/50 p-0.5">
        <button
          onClick={() => setLocale('en')}
          className={`flex-1 rounded px-1.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
            locale === 'en'
              ? 'bg-white text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          EN
        </button>
        <button
          onClick={() => setLocale('zh')}
          className={`flex-1 rounded px-1.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
            locale === 'zh'
              ? 'bg-white text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          中文
        </button>
      </div>
    </div>
  );
}
