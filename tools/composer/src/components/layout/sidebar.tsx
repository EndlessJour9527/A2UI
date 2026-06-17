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

import {useState, useEffect} from 'react';
import {Menu, ChevronRight} from 'lucide-react';
import {cn} from '@/lib/utils';
import {SidebarHeader} from './sidebar-header';
import {SidebarNav} from './sidebar-nav';
import {VersionSelector} from './version-selector';
import {LanguageSelector} from './language-selector';
import {SidebarWidgets} from './sidebar-widgets';
import {Button} from '@/components/ui/button';

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsOpen(false);
    }
  }, []);

  return (
    <>
      {/* Universal expand/toggle button */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-4 top-4 z-50 h-9 w-9 md:h-8 md:w-8 rounded-full border border-border bg-white/80 backdrop-blur shadow-sm hover:bg-white cursor-pointer transition-all duration-200 flex items-center justify-center"
          onClick={() => setIsOpen(true)}
        >
          <ChevronRight className="hidden md:block h-4 w-4 text-muted-foreground" />
          <Menu className="block md:hidden h-5 w-5 text-muted-foreground" />
        </Button>
      )}

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed z-40 flex h-full flex-col bg-white/50 transition-all duration-300 ease-in-out rounded-lg overflow-hidden',
          isOpen
            ? 'w-[220px] p-3 border-2 border-white translate-x-0 md:relative'
            : 'w-0 p-0 border-0 -translate-x-full md:translate-x-0 md:relative md:w-0 md:-mr-2'
        )}
      >
        <div
          className={cn(
            'flex flex-col gap-4 w-[192px] transition-opacity duration-200',
            isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
        >
          <SidebarHeader onCollapse={() => setIsOpen(false)} />
          <hr />
          <VersionSelector />
          <hr />
          <LanguageSelector />
          <hr />
          <SidebarNav onNavigate={() => setIsOpen(false)} />
          <hr />
          <SidebarWidgets onNavigate={() => setIsOpen(false)} />
        </div>
      </aside>
    </>
  );
}
