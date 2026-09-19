import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';

interface ImageGalleryProps {
  images: string[];
  altTitle: string;
}

export const ImageGallery: React.FC<ImageGalleryProps> = ({ images, altTitle }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!images || images.length === 0) {
    return (
      <div className="w-full h-80 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-400">
        No images available
      </div>
    );
  }

  const next = () => setCurrentIndex((prev) => (prev + 1) % images.length);
  const prev = () => setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);

  return (
    <div className="space-y-3">
      {/* Main Image View */}
      <div className="relative h-72 sm:h-96 md:h-[420px] rounded-2xl overflow-hidden bg-slate-900 group">
        <img
          src={images[currentIndex]}
          alt={`${altTitle} - photo ${currentIndex + 1} of ${images.length}`}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-102"
        />

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
          {currentIndex + 1} / {images.length}
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
                idx === currentIndex
                  ? 'border-emerald-500 scale-102'
                  : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              <img
                src={img}
                alt={`${altTitle} thumbnail ${idx + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
