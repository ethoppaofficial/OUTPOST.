import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Building2 } from 'lucide-react';

interface ImageGalleryProps {
  images: string[];
  altTitle: string;
}

export const ImageGallery: React.FC<ImageGalleryProps> = ({ images, altTitle }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCurrentIndex(0);
    setFailedUrls({});
  }, [images]);

  if (!images || images.length === 0) {
    return (
      <div className="w-full h-80 bg-slate-100 dark:bg-slate-800 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-400">
        <Building2 className="w-10 h-10 opacity-60" />
        <span className="text-xs font-medium">No verified property images uploaded yet</span>
      </div>
    );
  }

  const safeIndex = currentIndex < images.length ? currentIndex : 0;
  const activeUrl = images[safeIndex];
  const isBroken = !activeUrl || failedUrls[activeUrl];

  const next = () => setCurrentIndex((prev) => (prev + 1) % images.length);
  const prev = () => setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);

  return (
    <div className="space-y-3">
      {/* Main Image View */}
      <div className="relative h-72 sm:h-96 md:h-[420px] rounded-2xl overflow-hidden bg-slate-900 group">
        {!isBroken ? (
          <img
            src={activeUrl}
            alt={`${altTitle} - photo ${safeIndex + 1} of ${images.length}`}
            onError={() => setFailedUrls((prevMap) => ({ ...prevMap, [activeUrl]: true }))}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 bg-slate-800">
            <Building2 className="w-10 h-10 opacity-60" />
            <span className="text-xs font-medium">Photo failed to load</span>
          </div>
        )}

        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-900/60 hover:bg-slate-900/90 text-white flex items-center justify-center backdrop-blur-xs transition"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={next}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-900/60 hover:bg-slate-900/90 text-white flex items-center justify-center backdrop-blur-xs transition"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        <div className="absolute bottom-3 right-3 px-3 py-1 rounded-full bg-slate-900/70 backdrop-blur-xs text-xs font-medium text-white">
          {safeIndex + 1} / {images.length}
        </div>
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((img, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={`relative flex-shrink-0 w-20 h-16 rounded-xl overflow-hidden border-2 transition ${
                idx === safeIndex
                  ? 'border-emerald-500 scale-102'
                  : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              {!failedUrls[img] ? (
                <img
                  src={img}
                  alt={`${altTitle} thumbnail ${idx + 1}`}
                  onError={() => setFailedUrls((prevMap) => ({ ...prevMap, [img]: true }))}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-800 text-slate-400">
                  <Building2 className="w-4 h-4" />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
