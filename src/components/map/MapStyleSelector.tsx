import React, { useState, useEffect } from 'react';
import {
  Layers,
  Key,
  Check,
  ExternalLink,
  Sparkles,
  Info,
  X,
  AlertTriangle,
  Building,
} from 'lucide-react';
import {
  mapConfig,
  getMaptilerApiKey,
  setMaptilerApiKey,
  isMapTilerConfigured,
  is3DBuildingsEnabled,
  set3DBuildingsEnabled,
  subscribeToMapConfig,
  MAPTILER_BUILDINGS_TILES_CLOUD_URL,
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
  const [apiKeyInput, setApiKeyInput] = useState(getMaptilerApiKey() || '');
  const [isConfigured, setIsConfigured] = useState(isMapTilerConfigured());
  const [enable3DBuildings, setEnable3DBuildings] = useState(is3DBuildingsEnabled());
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToMapConfig(() => {
      setApiKeyInput(getMaptilerApiKey() || '');
      setIsConfigured(isMapTilerConfigured());
      setEnable3DBuildings(is3DBuildingsEnabled());
    });
    return unsubscribe;
  }, []);

  const handleSaveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    setMaptilerApiKey(apiKeyInput.trim());
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
    onStyleChanged?.();
  };

  const handleToggle3DBuildings = () => {
    const next = !enable3DBuildings;
    setEnable3DBuildings(next);
    set3DBuildingsEnabled(next);
    onStyleChanged?.();
  };

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="MapTiler Streets & Buildings Tiles Configuration"
        className="px-2.5 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-800 shadow-md text-xs font-semibold flex items-center gap-1.5 transition backdrop-blur-xs cursor-pointer"
      >
        <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <span className="hidden sm:inline font-medium">Provider:</span>
        <span className="text-slate-900 dark:text-white font-bold max-w-[120px] truncate">
          MapTiler Streets
        </span>
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isConfigured ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
          title={isConfigured ? 'Key Configured' : 'Key Incomplete'}
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-80 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-150 text-left space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                MapTiler Provider & Tiles Setup
              </h4>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white">MapTiler Streets v2</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                Active Style
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Standard light street-map style featuring soft greens for campus landscapes, bright yellows for major highways, and detailed building layouts in Dambare & Rimin Gata.
            </p>
          </div>

          {/* MapTiler Buildings Tiles Integration */}
          <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/60 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                <Building className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>MapTiler 3D Buildings Tiles</span>
              </div>
              <a
                href={MAPTILER_BUILDINGS_TILES_CLOUD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5"
                title="View MapTiler Buildings Tiles on Cloud"
              >
                <span>cloud.maptiler.com/tiles/buildings</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              Integrated vector tileset providing extruded 3D structural building heights for hostels and compounds in Kano.
            </p>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                3D Extrusions Layer
              </span>
              <button
                type="button"
                onClick={handleToggle3DBuildings}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  enable3DBuildings
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {enable3DBuildings ? 'Enabled (Active)' : 'Disabled'}
              </button>
            </div>
          </div>

          {/* Key Status & Configuration */}
          <form onSubmit={handleSaveApiKey} className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-500" />
                <span>MapTiler API Key (VITE_MAPTILER_API_KEY)</span>
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

            <div className="flex gap-2">
              <input
                type="text"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter MapTiler API Key"
                className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs cursor-pointer flex-shrink-0"
              >
                Save
              </button>
            </div>

            {savedSuccess && (
              <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> MapTiler key saved and applied!
              </p>
            )}

            {!isConfigured && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>
                  Map configuration is incomplete. Please configure VITE_MAPTILER_API_KEY or enter your key above.
                </span>
              </div>
            )}
          </form>

          {/* Attribution note */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 flex items-center gap-1.5">
            <Info className="w-3 h-3 text-emerald-600 flex-shrink-0" />
            <span>{mapConfig.attribution}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapStyleSelector;
