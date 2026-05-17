'use client';

import { useState, type ReactNode } from 'react';
import type { GridSize, LayoutMode } from '../utils/pagePreferences';

export interface PageLayoutSettingsProps {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  customCols: GridSize;
  setCustomCols: (value: GridSize) => void;
  customRows: GridSize;
  setCustomRows: (value: GridSize) => void;
  showLayoutDropdown: boolean;
  setShowLayoutDropdown: (open: boolean) => void;
  variant?: 'tracking' | 'homepage';
  className?: string;
}

function LayoutModeButtons({
  layoutMode,
  setLayoutMode,
  onSelect,
  activeClass,
  inactiveClass,
}: {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  onSelect?: () => void;
  activeClass: string;
  inactiveClass: string;
}) {
  const pick = (mode: LayoutMode) => {
    setLayoutMode(mode);
    onSelect?.();
  };

  return (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => pick('grid')}
        className={`p-2 rounded-lg transition-all duration-200 text-lg ${
          layoutMode === 'grid' ? activeClass : inactiveClass
        }`}
        title="Grid view"
      >
        🔲
      </button>
      <button
        type="button"
        onClick={() => pick('horizontal')}
        className={`p-2 rounded-lg transition-all duration-200 text-lg ${
          layoutMode === 'horizontal' ? activeClass : inactiveClass
        }`}
        title="Horizontal scroll"
      >
        ⬅️➡️
      </button>
    </div>
  );
}

function GridSizeControls({
  customCols,
  setCustomCols,
  customRows,
  setCustomRows,
}: {
  customCols: GridSize;
  setCustomCols: (value: GridSize) => void;
  customRows: GridSize;
  setCustomRows: (value: GridSize) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500 dark:text-slate-400 w-16 shrink-0">Columns:</label>
        <input
          type="number"
          min={1}
          max={12}
          value={customCols === 'auto' ? '' : customCols}
          onChange={e =>
            setCustomCols(
              e.target.value === '' ? 'auto' : Math.max(1, Math.min(12, Number(e.target.value)))
            )
          }
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          placeholder="auto"
        />
        <button
          type="button"
          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
            customCols === 'auto'
              ? 'bg-primary-500 text-white shadow-md'
              : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
          onClick={() => setCustomCols('auto')}
        >
          Auto
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500 dark:text-slate-400 w-16 shrink-0">Rows:</label>
        <input
          type="number"
          min={1}
          max={12}
          value={customRows === 'auto' ? '' : customRows}
          onChange={e =>
            setCustomRows(
              e.target.value === '' ? 'auto' : Math.max(1, Math.min(12, Number(e.target.value)))
            )
          }
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          placeholder="auto"
        />
        <button
          type="button"
          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all shrink-0 ${
            customRows === 'auto'
              ? 'bg-primary-500 text-white shadow-md'
              : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
          }`}
          onClick={() => setCustomRows('auto')}
        >
          Auto
        </button>
      </div>
    </div>
  );
}

function LayoutSettingsModal({
  open,
  onClose,
  title,
  layoutMode,
  modeButtons,
  gridControls,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  layoutMode: LayoutMode;
  modeButtons: ReactNode;
  gridControls: ReactNode;
}) {
  if (!open) return null;

  return (
    <>
      <div
        className="sm:hidden fixed inset-0 bg-black/50 z-[9998] backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="sm:hidden fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-4 w-[90vw] max-w-sm max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 text-lg" aria-label="Close">
            ✕
          </button>
        </div>
        <label className="text-xs font-medium text-gray-600 dark:text-slate-400 mb-2 block">Mode</label>
        <div className="flex gap-2">{modeButtons}</div>
        {layoutMode === 'grid' && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <label className="text-xs font-medium text-gray-600 dark:text-slate-400 mb-2 block">
              Grid size
            </label>
            {gridControls}
          </div>
        )}
      </div>
    </>
  );
}

export function PageLayoutSettings({
  layoutMode,
  setLayoutMode,
  customCols,
  setCustomCols,
  customRows,
  setCustomRows,
  showLayoutDropdown,
  setShowLayoutDropdown,
  variant = 'tracking',
  className = '',
}: PageLayoutSettingsProps) {
  const isHomepage = variant === 'homepage';
  const closeDropdown = () => setShowLayoutDropdown(false);

  const activeClass = isHomepage
    ? 'bg-blue-600 text-white shadow-md'
    : 'bg-primary-500 text-white shadow-md transform scale-105';
  const inactiveClass = isHomepage
    ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
    : 'hover:bg-white/50 dark:hover:bg-gray-700/50 text-slate-600 dark:text-slate-400';

  const modeButtons = (
    <LayoutModeButtons
      layoutMode={layoutMode}
      setLayoutMode={setLayoutMode}
      onSelect={closeDropdown}
      activeClass={activeClass}
      inactiveClass={inactiveClass}
    />
  );

  const gridControls = (
    <GridSizeControls
      customCols={customCols}
      setCustomCols={setCustomCols}
      customRows={customRows}
      setCustomRows={setCustomRows}
    />
  );

  const modal = (
    <LayoutSettingsModal
      open={showLayoutDropdown}
      onClose={closeDropdown}
      title={isHomepage ? 'Layout' : 'Layout settings'}
      layoutMode={layoutMode}
      modeButtons={modeButtons}
      gridControls={gridControls}
    />
  );

  if (isHomepage) {
    return (
      <HomepageLayoutPanel
        className={className}
        layoutMode={layoutMode}
        modeButtons={modeButtons}
        gridControls={gridControls}
        modal={modal}
        showLayoutDropdown={showLayoutDropdown}
        setShowLayoutDropdown={setShowLayoutDropdown}
      />
    );
  }

  return (
    <>
      <div
        className={`hidden sm:flex items-center gap-2 card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 px-3 py-2 rounded-xl shadow-lg ${className}`}
      >
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Layout:</span>
        {modeButtons}
      </div>
      <div className="sm:hidden ml-auto relative">
        <button
          type="button"
          className="px-3 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-medium shadow"
          onClick={() => setShowLayoutDropdown(!showLayoutDropdown)}
        >
          ⚙️ Layout
        </button>
      </div>
      {modal}
    </>
  );
}

function HomepageMobileLayoutToggle({
  showLayoutDropdown,
  setShowLayoutDropdown,
}: {
  showLayoutDropdown: boolean;
  setShowLayoutDropdown: (open: boolean) => void;
}) {
  return (
    <div className="sm:hidden flex justify-end mb-3">
      <button
        type="button"
        className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium shadow"
        onClick={() => setShowLayoutDropdown(!showLayoutDropdown)}
      >
        ⚙️ Layout
      </button>
    </div>
  );
}

function HomepageLayoutPanel({
  className,
  layoutMode,
  modeButtons,
  gridControls,
  modal,
  showLayoutDropdown,
  setShowLayoutDropdown,
}: {
  className: string;
  layoutMode: LayoutMode;
  modeButtons: ReactNode;
  gridControls: ReactNode;
  modal: ReactNode;
  showLayoutDropdown: boolean;
  setShowLayoutDropdown: (open: boolean) => void;
}) {
  const [desktopPanelOpen, setDesktopPanelOpen] = useState(false);

  return (
    <div className={className}>
      <div className="hidden sm:flex justify-end mb-3">
        <button
          type="button"
          onClick={() => setDesktopPanelOpen(prev => !prev)}
          className={`px-4 py-2 rounded-lg text-sm font-medium shadow transition-all duration-200 flex items-center gap-2 ${
            desktopPanelOpen
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
          title={desktopPanelOpen ? 'Hide layout options' : 'Show layout options'}
        >
          <span>⚙️</span>
          <span>{desktopPanelOpen ? 'Hide Layout Options' : 'Edit Layout'}</span>
        </button>
      </div>
      {desktopPanelOpen && (
        <div className="hidden sm:flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Layout:</span>
          {modeButtons}
          {layoutMode === 'grid' && (
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[200px] border-l border-gray-200 dark:border-gray-600 pl-3">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Grid:</span>
              <div className="flex flex-wrap gap-3 flex-1">{gridControls}</div>
            </div>
          )}
        </div>
      )}
      <HomepageMobileLayoutToggle
        showLayoutDropdown={showLayoutDropdown}
        setShowLayoutDropdown={setShowLayoutDropdown}
      />
      {modal}
    </div>
  );
}
