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

import {createContext, useContext, useState, useEffect, useCallback, type ReactNode} from 'react';

export type Locale = 'en' | 'zh';

const STORAGE_KEY = 'a2ui-language';
const DEFAULT_LOCALE: Locale = 'en';

const TRANSLATIONS = {
  en: {
    // Navigation / Sidebar
    'nav.create': 'Create',
    'nav.theater': 'Theater',
    'nav.theater.subtitle': 'A2UI Playground',
    'nav.studio': 'Studio',
    'nav.studio.subtitle': 'Evaluation Studio',
    'nav.gallery': 'Gallery',
    'nav.components': 'Components',
    'nav.icons': 'Icons',
    'nav.tutorial': 'Tutorial',
    'nav.tutorial.subtitle': 'CopilotKit + A2UI',

    // Sidebar widgets / global
    'sidebar.widgets': 'Widgets',
    'sidebar.loading': 'Loading...',
    'sidebar.no_widgets': 'No widgets yet',
    'sidebar.untitled_widget': 'Untitled widget',
    'sidebar.rename': 'Rename',
    'sidebar.delete': 'Delete',
    'sidebar.delete_title': 'Delete ?',
    'sidebar.delete_desc': 'All widget studio is stored locally on your device so there is no backup. This action cannot be undone.',
    'sidebar.cancel': 'Cancel',
    'sidebar.widget_name_placeholder': 'Widget name',
    'sidebar.spec': 'Spec',
    'sidebar.lang': 'Lang',

    // Create Page
    'create.title': 'What would you like to build?',
    'create.input_placeholder': 'Describe your A2UI widget...',
    'create.powered_by': 'Powered by 🪁 CopilotKit',
    'create.generating': 'Generating widget',
    'create.or': 'or',
    'create.start_blank': 'Start Blank',
    'create.creating': 'Creating:',
    'create.created': 'Created:',

    // Editor Page
    'editor.loading': 'Loading...',
    'editor.widget_not_found': 'Widget not found',
    'editor.copied': 'Copied!',
    'editor.copy_json': 'Copy JSON',
    'editor.download': 'Download',
    'editor.view_details': 'View details',
    'editor.generating_component': 'Generating component...',
    'editor.state_rename_prompt': 'Rename state:',
    'editor.preview_unavailable': 'Preview unavailable',

    // Gallery Page
    'gallery.title': 'Gallery',
    'gallery.widget_copy_suffix': '(Copy)',
    'gallery.reset_preview': 'Reset preview',
    'gallery.open_in_editor': 'Open in widget editor',
    'gallery.components': 'Components',
    'gallery.data': 'Data',

    // Components Page
    'components.usage': 'Usage',
    'components.props': 'Props',
    'components.prop_name': 'Name',
    'components.prop_desc': 'Description',
    'components.prop_default': 'Default',
    'components.preview': 'Preview',
    'components.copy_to_clipboard': 'Copy to clipboard',
    'components.copied': 'Copied!',

    // Icons Page
    'icons.title': 'Icons',
    'icons.subtitle': 'A2UI uses Material Icons. Showing 100 most commonly used icons.',
    'icons.browse_all': 'Browse all icons',
    'icons.copy': 'Copy',
    'icons.copied': 'Copied!',

    // Theater Page
    'theater.events': 'Events',
    'theater.data': 'Data',
    'theater.config': 'Config',
    'theater.waiting_chunks': 'Waiting for next chunk...',
    'theater.waiting_play': 'Press play to stream JSONL chunks...',
    'theater.waiting_events': 'Press play to see events...',
    'theater.jsonl_stream': 'JSONL Stream',
    'theater.lifecycle_events': 'Lifecycle Events',
    'theater.configuration': 'Configuration',
    'theater.scenario': 'Scenario',
    'theater.renderer': 'Renderer',
    'theater.transport': 'Transport',
    'theater.simulated_playback': 'Simulated in-memory playback.',
    'theater.streaming_label': 'Streaming',
    'theater.press_play_start': 'Press play to start streaming',

    // Studio Pages
    'studio.runs_overview': 'Runs overview',
    'studio.description': 'First implementation of the local GenUI Eval Studio control plane. It reads the filesystem-backed run/index skeleton produced under .genui-eval-studio/ and provides a review-first UI for runs, groups, and cases.',
    'studio.refresh': 'Refresh',
    'studio.create_run': 'Create run',
    'studio.runs_card': 'Runs',
    'studio.runs_card_help': 'Materialized run summaries',
    'studio.groups_card': 'Groups',
    'studio.groups_card_help': 'Indexed test-set groups',
    'studio.cases_card': 'Cases',
    'studio.cases_card_help': 'Selectable review items',
    'studio.recent_runs': 'Recent runs',
    'studio.recent_runs_desc': 'Create a run from Excel, open it here, then start execution from the run controls.',
    'studio.loading_studio': 'Loading studio indexes…',
    'studio.no_local_runs': 'No local Eval Studio runs yet',
    'studio.no_local_runs_desc': 'Create a run from an Excel test set to initialize the local filesystem workspace.',
    'studio.th_run': 'Run',
    'studio.th_status': 'Status',
    'studio.th_groups': 'Groups',
    'studio.th_cases': 'Cases',
    'studio.th_failed': 'Failed',
    'studio.btn_open': 'Open',
    'studio.btn_delete_title': 'Delete run',
    'studio.confirm_delete_run': 'Are you sure you want to delete this run? All execution data, results, and logs for this run will be permanently deleted.',

    // Studio Run Details
    'studio.run.back_to_runs': 'Back to runs',
    'studio.run.run_details': 'Run details',
    'studio.run.execution_mode': 'Execution Mode',
    'studio.run.catalog_profile': 'Catalog Profile',
    'studio.run.started_at': 'Started At',
    'studio.run.duration': 'Duration',
    'studio.run.log_panel': 'Execution logs',
    'studio.run.show_logs': 'Show logs',
    'studio.run.hide_logs': 'Hide logs',
    'studio.run.actions': 'Actions',
    'studio.run.start_execution': 'Start Execution',
    'studio.run.running': 'Running',
    'studio.run.completed': 'Completed',
    'studio.run.failed': 'Failed',
    'studio.run.groups_list': 'Groups & Cases',

    // Studio Create Run
    'studio.create.back_to_runs': 'Back to runs',
    'studio.create.title': 'Create run from Excel or JSON',
    'studio.create.desc': 'Import an Excel spreadsheet (.xlsx) or JSON file (.json) to dynamically parse prompts, resolve catalog profiles, and initialize a new test execution run.',
    'studio.create.creation_failed': 'Creation failed:',
    'studio.create.auto_start_failed': 'Run created, but automatic execution did not start:',
    'studio.create.step1_title': '1. Select Test Set Spreadsheet or JSON',
    'studio.create.file_ready': 'File ready',
    'studio.create.drag_drop_placeholder': 'Drag and drop your Excel or JSON file here',
    'studio.create.drag_drop_subtitle': 'Supports standard .xlsx test sheets or .json files',
    'studio.create.change_file': 'Change file',
    'studio.create.browse_files': 'Browse files',
    'studio.create.run_metadata': 'Run metadata',
    'studio.create.run_name': 'Run Name',
    'studio.create.step2_title': '2. Configuration',
    'studio.create.model': 'Model',
    'studio.create.grading_model': 'Grading Model',
    'studio.create.catalog_profile_id': 'Catalog Profile ID',
    'studio.create.execution_mode_label': 'Execution Mode',
    'studio.create.btn_create': 'Create & Execute',
    'studio.create.success_title': 'Run created successfully!',
    'studio.create.success_desc': 'The run skeleton has been initialized and registered on the local control plane.',
    'studio.create.success_groups': 'groups',
    'studio.create.success_cases': 'cases',
    'studio.create.success_active': 'Execution is active in the background.',
    'studio.create.success_inactive': 'Execution is NOT currently active.',
    'studio.create.btn_view_details': 'View run details',
  },
  zh: {
    // Navigation / Sidebar
    'nav.create': '创建',
    'nav.theater': '剧场',
    'nav.theater.subtitle': 'A2UI 操练场',
    'nav.studio': '工作室',
    'nav.studio.subtitle': '评测工作室',
    'nav.gallery': '画廊',
    'nav.components': '组件库',
    'nav.icons': '图标库',
    'nav.tutorial': '教程',
    'nav.tutorial.subtitle': 'CopilotKit + A2UI',

    // Sidebar widgets / global
    'sidebar.widgets': '微件列表',
    'sidebar.loading': '加载中...',
    'sidebar.no_widgets': '暂无微件',
    'sidebar.untitled_widget': '未命名微件',
    'sidebar.rename': '重命名',
    'sidebar.delete': '删除',
    'sidebar.delete_title': '确认删除？',
    'sidebar.delete_desc': '所有的微件数据均保存在本地设备上，没有备份。此操作无法撤销。',
    'sidebar.cancel': '取消',
    'sidebar.widget_name_placeholder': '微件名称',
    'sidebar.spec': '规范版本',
    'sidebar.lang': '语言',

    // Create Page
    'create.title': '你想构建什么？',
    'create.input_placeholder': '描述你的 A2UI 微件...',
    'create.powered_by': '由 🪁 CopilotKit 提供支持',
    'create.generating': '正在生成微件',
    'create.or': '或',
    'create.start_blank': '从空白模板开始',
    'create.creating': '正在创建：',
    'create.created': '已创建：',

    // Editor Page
    'editor.loading': '加载中...',
    'editor.widget_not_found': '未找到微件',
    'editor.copied': '已复制！',
    'editor.copy_json': '复制 JSON',
    'editor.download': '下载',
    'editor.view_details': '查看详情',
    'editor.generating_component': '正在生成组件...',
    'editor.state_rename_prompt': '重命名状态：',
    'editor.preview_unavailable': '预览不可用',

    // Gallery Page
    'gallery.title': '画廊',
    'gallery.widget_copy_suffix': '(副本)',
    'gallery.reset_preview': '重置预览',
    'gallery.open_in_editor': '在微件编辑器中打开',
    'gallery.components': '组件',
    'gallery.data': '数据',

    // Components Page
    'components.usage': '用法',
    'components.props': '属性列表',
    'components.prop_name': '属性名',
    'components.prop_desc': '描述',
    'components.prop_default': '默认值',
    'components.preview': '预览',
    'components.copy_to_clipboard': '复制到剪贴板',
    'components.copied': '已复制！',

    // Icons Page
    'icons.title': '图标库',
    'icons.subtitle': 'A2UI 使用 Material 图标。这里显示了 100 个最常用的图标。',
    'icons.browse_all': '浏览所有图标',
    'icons.copy': '复制',
    'icons.copied': '已复制！',

    // Theater Page
    'theater.events': '事件流',
    'theater.data': '数据流',
    'theater.config': '配置',
    'theater.waiting_chunks': '等待下一个数据块...',
    'theater.waiting_play': '点击播放以流式传输 JSONL 块...',
    'theater.waiting_events': '点击播放以查看生命周期事件...',
    'theater.jsonl_stream': 'JSONL 实时流',
    'theater.lifecycle_events': '生命周期事件',
    'theater.configuration': '模拟配置',
    'theater.scenario': '测试场景',
    'theater.renderer': '渲染器',
    'theater.transport': '传输协议',
    'theater.simulated_playback': '模拟内存数据包播放。',
    'theater.streaming_label': '流式传输中',
    'theater.press_play_start': '点击播放开始流式传输',

    // Studio Pages
    'studio.runs_overview': '评测运行概览',
    'studio.description': '本地 GenUI 评测工作室控制面板的初版实现。它读取在 .genui-eval-studio/ 下生成的基于文件系统的运行/索引骨架，并为运行、组 and 测试用例提供了一个评审优先的 UI。',
    'studio.refresh': '刷新',
    'studio.create_run': '创建运行',
    'studio.runs_card': '运行次数',
    'studio.runs_card_help': '已实现的运行摘要',
    'studio.groups_card': '分组数',
    'studio.groups_card_help': '已索引的测试集分组',
    'studio.cases_card': '用例数',
    'studio.cases_card_help': '可选的评审用例',
    'studio.recent_runs': '最近运行',
    'studio.recent_runs_desc': '从 Excel 创建一个运行，在此处打开它，然后从运行控制中开始执行。',
    'studio.loading_studio': '正在加载工作室索引...',
    'studio.no_local_runs': '本地还没有 Eval Studio 运行记录',
    'studio.no_local_runs_desc': '从 Excel 测试集创建一个运行以初始化本地文件系统工作区。',
    'studio.th_run': '运行项目',
    'studio.th_status': '状态',
    'studio.th_groups': '分组',
    'studio.th_cases': '测试用例',
    'studio.th_failed': '失败用例',
    'studio.btn_open': '打开',
    'studio.btn_delete_title': '删除此运行',
    'studio.confirm_delete_run': '您确定要删除此运行吗？此运行的所有执行数据、结果和日志都将被永久删除。',

    // Studio Run Details
    'studio.run.back_to_runs': '返回概览',
    'studio.run.run_details': '运行详情',
    'studio.run.execution_mode': '执行模式',
    'studio.run.catalog_profile': '组件库配置',
    'studio.run.started_at': '启动时间',
    'studio.run.duration': '耗时',
    'studio.run.log_panel': '执行日志',
    'studio.run.show_logs': '显示日志',
    'studio.run.hide_logs': '隐藏日志',
    'studio.run.actions': '操作',
    'studio.run.start_execution': '开始执行',
    'studio.run.running': '运行中',
    'studio.run.completed': '已完成',
    'studio.run.failed': '已失败',
    'studio.run.groups_list': '分组与用例',

    // Studio Create Run
    'studio.create.back_to_runs': '返回列表',
    'studio.create.title': '从 Excel 或 JSON 创建运行',
    'studio.create.desc': '导入 Excel 电子表格 (.xlsx) 或 JSON 文件 (.json) 以动态解析 Prompt，解析组件库配置，并初始化新的测试执行。',
    'studio.create.creation_failed': '创建失败：',
    'studio.create.auto_start_failed': '已创建运行，但未启动自动执行：',
    'studio.create.step1_title': '1. 选择测试集电子表格或 JSON',
    'studio.create.file_ready': '文件已就绪',
    'studio.create.drag_drop_placeholder': '拖拽您的 Excel 或 JSON 文件到这里',
    'studio.create.drag_drop_subtitle': '支持标准的 .xlsx 测试工作簿或 .json 格式文件',
    'studio.create.change_file': '更改文件',
    'studio.create.browse_files': '浏览文件',
    'studio.create.run_metadata': '元数据配置',
    'studio.create.run_name': '运行名称',
    'studio.create.step2_title': '2. 运行配置',
    'studio.create.model': '大语言模型',
    'studio.create.grading_model': '自动打分模型',
    'studio.create.catalog_profile_id': '组件库 Profile ID',
    'studio.create.execution_mode_label': '执行模式',
    'studio.create.btn_create': '创建并执行',
    'studio.create.success_title': '运行创建成功！',
    'studio.create.success_desc': '运行骨架已经成功初始化，并已注册到本地控制台面板中。',
    'studio.create.success_groups': '个测试组',
    'studio.create.success_cases': '个测试用例',
    'studio.create.success_active': '正在后台执行任务。',
    'studio.create.success_inactive': '任务当前未处于激活状态。',
    'studio.create.btn_view_details': '查看运行详情',
  },
} as const;

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  isLoaded: boolean;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({children}: {children: ReactNode}) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage after hydration to avoid SSR/hydration mismatch
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') {
      setLocaleState(stored);
    }
    setIsLoaded(true);
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  return (
    <LanguageContext.Provider value={{locale, setLocale, isLoaded}}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  const {locale, setLocale, isLoaded} = context;

  const t = useCallback(
    (key: keyof typeof TRANSLATIONS['en'], defaultText?: string): string => {
      if (!isLoaded) {
        return defaultText || key;
      }
      const translation = TRANSLATIONS[locale]?.[key];
      return translation || defaultText || key;
    },
    [locale, isLoaded]
  );

  return {t, locale, setLocale, isLoaded};
}
