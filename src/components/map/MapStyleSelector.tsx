import React, { useState, useEffect } from 'react';
import {
  Layers,
  Key,
  Check,
  ExternalLink,
  ChevronDown,
  Sparkles,
  Info,
  X,
} from 'lucide-react';
import {
  MAP_STYLE_PRESETS,
  getActiveMapStyleId,
  setActiveMapStyleId,
  getMaptilerApiKey,
  setMaptilerApiKey,
  subscribeToMapConfig,
} from '../../infrastructure/config/mapConfig';

interface MapStyleSelectorProps {
  className?: string;
  onStyleChanged?: () => void;
}

export const MapStyleSelector: React.FC<MapStyleSelectorProps> = ({
  className = '',
  onStyleChanged,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeId, setActiveId] = useState(getActiveMapStyleId());
  const [apiKeyInput, setApiKeyInput] = useState(getMaptilerApiKey());
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToMapConfig(() => {
      setActiveId(getActiveMapStyleId());
      setApiKeyInput(getMaptilerApiKey());
    });
    return unsubscribe;
  }, []);

  const handleSelectStyle = (id: string) => {
    setActiveMapStyleId(id);
    setActiveId(id);
    if (id === 'maptiler-streets' && !getMaptilerApiKey()) {
      setShowKeyInput(true);
    }
    onStyleChanged?.();
  };

  const handleSaveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    setMaptilerApiKey(apiKeyInput.trim());
    setActiveMapStyleId('maptiler-streets');
    setActiveId('maptiler-streets');
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
    onStyleChanged?.();
  };

  const currentPreset =
    MAP_STYLE_PRESETS.find((p) => p.id === activeId) || MAP_STYLE_PRESETS[0];

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="Map Style: MapTiler Streets / Google Maps View"
        className="px-2.5 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-800 shadow-md text-xs font-semibold flex items-center gap-1.5 transition backdrop-blur-xs cursor-pointer"
      >
        <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <span className="hidden sm:inline font-medium">Style:</span>
        <span className="text-slate-900 dark:text-white font-bold max-w-[130px] truncate">
          {currentPreset.name.split(' ')[0]}
        </span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-80 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150 text-left">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">Map Style & Theme</h4>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Style Options */}
          <div className="mt-2 space-y-2 max-h-72 overflow-y-auto pr-1">
            {MAP_STYLE_PRESETS.map((preset) => {
              const isSelected = preset.id === activeId;
              const hasKey = Boolean(getMaptilerApiKey());

              return (
                <div
                  key={preset.id}
                  onClick={() => handleSelectStyle(preset.id)}
                  className={`p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
                      : 'border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {preset.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                        {preset.badge}
                      </span>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                    )}
                  </div>

                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                    {preset.description}
                  </p>

                  {preset.requiresKey && (
                    <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-slate-200/60 dark:border-slate-800/80">
                      <span className="text-[10px] flex items-center gap-1 font-medium text-slate-500">
                        <Key className="w-3 h-3 text-amber-500" />
                        {hasKey ? 'Key configured ✓' : 'Free API key required'}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowKeyInput(!showKeyInput);
                        }}
                        className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                      >
                        {hasKey ? 'Edit Key' : 'Enter Key'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* MapTiler Key Input Form */}
          {(showKeyInput || (activeId === 'maptiler-streets' && !getMaptilerApiKey())) && (
            <form onSubmit={handleSaveApiKey} className="mt-3 p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                  <Key className="w-3.5 h-3.5 text-amber-500" />
                  MapTiler API Key
                </label>
                <a
                  href="https://cloud.maptiler.com/account/keys/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5"
                >
                  <span>Get Free Key</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste MapTiler Key (e.g. OpIi9...)"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-xs font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs cursor-pointer flex-shrink-0"
                >
                  Apply
                </button>
              </div>

              {savedSuccess && (
                <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> MapTiler key applied! Map updating...
                </p>
              )}

              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                Tip: Without an API key, OUTPOST automatically renders our high-resolution Streets Bright vector style matching Google Maps palette.
              </p>
            </form>
          )}

          {/* Footer note */}
          <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 flex items-center gap-1">
            <Info className="w-3 h-3 text-emerald-600 flex-shrink-0" />
            <span>MapLibre GL JS engine • Dambare & Rimin Gata BUK Corridor</span>
          </div>
        </div>
      )}
    </div>
  );
};
