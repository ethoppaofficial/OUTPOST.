import React, { useState, useEffect } from 'react';
import { Layers, Info, X, Sparkles, Building } from 'lucide-react';
import {
  mapConfig,
  isMapTilerConfigured,
  is3DBuildingsEnabled,
  set3DBuildingsEnabled,
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
  const [hasMaptiler, setHasMaptiler] = useState(isMapTilerConfigured());
  const [enable3DBuildings, setEnable3DBuildings] = useState(is3DBuildingsEnabled());

  useEffect(() => {
    const unsubscribe = subscribeToMapConfig(() => {
      setHasMaptiler(isMapTilerConfigured());
      setEnable3DBuildings(is3DBuildingsEnabled());
    });
    return unsubscribe;
  }, []);

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
        title="Map Style & Layer Preferences"
        className="px-2.5 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-800 shadow-md text-xs font-semibold flex items-center gap-1.5 transition backdrop-blur-xs cursor-pointer"
      >
        <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <span className="hidden sm:inline font-medium">Map:</span>
        <span className="text-slate-900 dark:text-white font-bold max-w-[140px] truncate">
          {mapConfig.providerName}
        </span>
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 bg-emerald-500"
          title="Map Ready"
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-72 sm:w-80 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-150 text-left space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                Campus Street Map Layers
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
              <span className="font-bold text-slate-900 dark:text-white">
                {mapConfig.providerName}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                Active
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Detailed vector street map for Dambare, Rimin Gata, and the BUK New Site corridor with automatic OpenStreetMap raster fallback.
            </p>
          </div>

          {hasMaptiler && (
            <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/60 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                  <Building className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>3D Buildings Layer</span>
                </div>
                <button
                  type="button"
                  onClick={handleToggle3DBuildings}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                    enable3DBuildings
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {enable3DBuildings ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          )}

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
