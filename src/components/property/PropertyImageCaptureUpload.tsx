import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Upload,
  Image as ImageIcon,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Star,
  RefreshCw,
  X,
  Sparkles,
  SwitchCamera,
  Plus,
  Info
} from 'lucide-react';
import { storageService } from '../../infrastructure/firebase/storageService';

export interface PropertyImageCaptureUploadProps {
  images: string[];
  onChange: (images: string[]) => void;
  minImages?: number;
  maxImages?: number;
}

// Curated authentic off-campus student accommodation sample photos (BUK Kano context)
const SAMPLE_STUDENT_HOUSING_PHOTOS = [
  {
    label: 'Exterior & Gated Entrance',
    url: 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Student Bedroom Interior',
    url: 'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Study Desk & Personal Space',
    url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'En-suite Bathroom & Water Facility',
    url: 'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=1000&auto=format&fit=crop&q=80',
  },
  {
    label: 'Kitchenette & Common Corridor',
    url: 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=1000&auto=format&fit=crop&q=80',
  },
];

export const PropertyImageCaptureUpload: React.FC<PropertyImageCaptureUploadProps> = ({
  images,
  onChange,
  minImages = 3,
  maxImages = 5,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedInSession, setCapturedInSession] = useState<string[]>([]);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [flashActive, setFlashActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileCameraInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Play a brief synthesized camera click sound
  const playCameraClickSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } catch {
      // Audio not supported or autoplay restricted
    }
  };

  // Start live camera stream
  const startCameraStream = async (facing: 'environment' | 'user') => {
    setCameraError(null);
    stopCameraStream();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: any) {
      console.warn('Camera stream error:', err);
      setCameraError(
        'Could not access camera viewfinder directly. You can use the "Device Camera" button below or upload photos from your device.'
      );
    }
  };

  const stopCameraStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (isCameraOpen) {
      startCameraStream(cameraFacing);
    } else {
      stopCameraStream();
    }
    return () => {
      stopCameraStream();
    };
  }, [isCameraOpen, cameraFacing]);

  // Flip camera between front and back
  const handleToggleFacing = () => {
    setCameraFacing((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Snap photo from the live video element
  const handleCaptureSnapshot = async () => {
    if (!videoRef.current) return;
    if (images.length + capturedInSession.length >= maxImages) {
      setCameraError(`Maximum limit of ${maxImages} photos reached.`);
      return;
    }

    try {
      playCameraClickSound();
      setFlashActive(true);
      setTimeout(() => setFlashActive(false), 150);

      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert to blob and upload through storage service
      canvas.toBlob(
        async (blob) => {
          if (!blob) return;
          const fileName = `camera_photo_${Date.now()}.jpg`;
          try {
            const uploadRes = await storageService.uploadPropertyImage(blob, fileName);
            const newUrl = uploadRes.url;
            setCapturedInSession((prev) => [...prev, newUrl]);
            onChange([...images, newUrl]);
          } catch (err: any) {
            // Fallback to data URL
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            setCapturedInSession((prev) => [...prev, dataUrl]);
            onChange([...images, dataUrl]);
          }
        },
        'image/jpeg',
        0.88
      );
    } catch (err: any) {
      setCameraError('Failed to capture frame: ' + (err.message || 'Unknown error'));
    }
  };

  // Handle uploaded files (either from standard file picker or mobile camera input)
  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);
    setIsUploading(true);

    try {
      const remainingSlots = maxImages - images.length;
      if (remainingSlots <= 0) {
        setUploadError(`You have already added the maximum of ${maxImages} photos.`);
        setIsUploading(false);
        return;
      }

      const filesToUpload = Array.from(files).slice(0, remainingSlots);
      const newUrls: string[] = [];

      for (const file of filesToUpload) {
        if (!file.type.startsWith('image/')) {
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          throw new Error(`"${file.name}" exceeds the 5MB maximum file size limit.`);
        }

        try {
          const uploadRes = await storageService.uploadPropertyImage(file, file.name);
          newUrls.push(uploadRes.url);
        } catch {
          // Fallback to local Object URL for instant preview
          newUrls.push(URL.createObjectURL(file));
        }
      }

      if (newUrls.length > 0) {
        onChange([...images, ...newUrls]);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload image(s).');
    } finally {
      setIsUploading(false);
      // Reset input value so same files can be re-selected if deleted
      e.target.value = '';
    }
  };

  // Load sample student hostel photos
  const handleLoadSamplePhotos = () => {
    const sampleUrls = SAMPLE_STUDENT_HOUSING_PHOTOS.slice(0, maxImages).map((p) => p.url);
    onChange(sampleUrls);
    setUploadError(null);
  };

  // Add manual URL
  const handleAddManualUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualUrl.trim()) return;
    if (images.length >= maxImages) {
      setUploadError(`Maximum of ${maxImages} photos reached.`);
      return;
    }
    onChange([...images, manualUrl.trim()]);
    setManualUrl('');
    setShowUrlInput(false);
  };

  // Remove photo
  const handleRemovePhoto = (indexToRemove: number) => {
    const updated = images.filter((_, idx) => idx !== indexToRemove);
    onChange(updated);
  };

  // Make cover photo (move to index 0)
  const handleSetCoverPhoto = (index: number) => {
    if (index === 0) return;
    const selected = images[index];
    const rest = images.filter((_, idx) => idx !== index);
    onChange([selected, ...rest]);
  };

  const totalCount = images.length;
  const isRequirementMet = totalCount >= minImages;

  return (
    <div className="space-y-4">
      {/* Header and Progress Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Accommodation Photographs
            </h3>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold flex items-center gap-1 ${
                isRequirementMet
                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                  : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
              }`}
            >
              {isRequirementMet ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>Requirement Met ({totalCount}/{maxImages})</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                  <span>
                    {totalCount} of {minImages} minimum photos ({minImages - totalCount} more needed)
                  </span>
                </>
              )}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Physical verification requires at least <strong>{minImages} to {maxImages} high-clarity photos</strong>{' '}
            (exterior entrance, bed space, study area, and washroom).
          </p>
        </div>

        {/* Quick Demo Button */}
        <button
          type="button"
          onClick={handleLoadSamplePhotos}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-xs font-medium transition self-start sm:self-auto cursor-pointer"
          title="Instantly populate with 5 genuine student accommodation sample photos"
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Load 5 Sample Hostel Photos</span>
        </button>
      </div>

      {/* Action Buttons: Take Camera Photo & Upload Photos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Button 1: Live Camera Viewfinder */}
        <button
          type="button"
          onClick={() => {
            setCapturedInSession([]);
            setIsCameraOpen(true);
          }}
          disabled={images.length >= maxImages}
          className="flex items-center justify-center gap-2.5 p-3.5 rounded-2xl border-2 border-emerald-500/40 hover:border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold text-xs shadow-xs transition group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
            <Camera className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="font-bold text-slate-900 dark:text-white">Take Photos (Camera)</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              Open live camera & snap 3 to 5 photos
            </div>
          </div>
        </button>

        {/* Button 2: File Upload (Multi-Select) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={images.length >= maxImages || isUploading}
          className="flex items-center justify-center gap-2.5 p-3.5 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-800 dark:text-slate-200 font-semibold text-xs shadow-xs transition group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="w-8 h-8 rounded-xl bg-slate-800 dark:bg-slate-700 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
            {isUploading ? (
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
          </div>
          <div className="text-left">
            <div className="font-bold text-slate-900 dark:text-white">
              {isUploading ? 'Uploading Photos...' : 'Upload Photos (Files)'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              Select 3 to 5 pictures from device
            </div>
          </div>
        </button>

        {/* Button 3: Mobile Native Camera Quick Snap */}
        <button
          type="button"
          onClick={() => mobileCameraInputRef.current?.click()}
          disabled={images.length >= maxImages}
          className="flex items-center justify-center gap-2.5 p-3.5 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed sm:col-span-2 lg:col-span-1"
        >
          <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Camera className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-left">
            <div className="font-bold text-slate-900 dark:text-white">Device Camera Direct</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              Trigger phone camera shutter
            </div>
          </div>
        </button>
      </div>

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/jpg"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />
      <input
        ref={mobileCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />

      {/* Error notification */}
      {uploadError && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Photo Gallery Grid */}
      {images.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-medium px-1">
            <span>
              Listing Gallery ({images.length}/{maxImages} photos)
            </span>
            <span>First photo is the public Cover Photo</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {images.map((imgUrl, index) => {
              const isCover = index === 0;
              const suggestedLabel =
                SAMPLE_STUDENT_HOUSING_PHOTOS[index]?.label || `Accommodation Photo ${index + 1}`;

              return (
                <div
                  key={`${imgUrl}-${index}`}
                  className={`group relative rounded-2xl overflow-hidden border-2 bg-slate-900 shadow-xs aspect-4/3 flex flex-col justify-between transition-all ${
                    isCover
                      ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-400'
                  }`}
                >
                  <img
                    src={imgUrl}
                    alt={suggestedLabel}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Gradient overlay for readability */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-slate-950/40 pointer-events-none" />

                  {/* Top Bar: Cover Badge or Make Cover Action */}
                  <div className="relative z-10 p-2 flex items-center justify-between">
                    {isCover ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[10px] shadow-xs">
                        <Star className="w-2.5 h-2.5 fill-current" />
                        Cover
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSetCoverPhoto(index)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded-lg bg-slate-900/80 hover:bg-emerald-600 text-white text-[10px] font-medium backdrop-blur-xs cursor-pointer"
                        title="Set as featured cover image"
                      >
                        Set Cover
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(index)}
                      className="w-6 h-6 rounded-full bg-slate-900/80 hover:bg-rose-600 text-white flex items-center justify-center transition-colors shadow-xs cursor-pointer"
                      title="Remove photograph"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Bottom Bar: Index and Label */}
                  <div className="relative z-10 p-2">
                    <span className="text-[10px] font-semibold text-white/90 drop-shadow-xs line-clamp-1">
                      #{index + 1}: {suggestedLabel}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Empty placeholder slot if under max */}
            {images.length < maxImages && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-emerald-50/30 flex flex-col items-center justify-center gap-1.5 p-3 text-slate-400 hover:text-emerald-600 transition aspect-4/3 cursor-pointer"
              >
                <Plus className="w-5 h-5" />
                <span className="text-[11px] font-medium">Add Photo {images.length + 1}</span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500">
                  ({minImages - images.length > 0 ? `${minImages - images.length} needed for min` : 'Optional'})
                </span>
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="p-6 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 text-center space-y-2">
          <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <ImageIcon className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              No Photos Added Yet
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Click <strong>"Take Photos (Camera)"</strong> to snap live pictures of your property,
              or <strong>"Upload Photos"</strong> to select 3 to 5 images from your phone or computer.
            </p>
          </div>
        </div>
      )}

      {/* Manual URL Toggle */}
      <div className="pt-1">
        {!showUrlInput ? (
          <button
            type="button"
            onClick={() => setShowUrlInput(true)}
            className="text-[11px] text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400 inline-flex items-center gap-1 transition cursor-pointer"
          >
            <span>Or paste an image web link (URL)</span>
          </button>
        ) : (
          <form onSubmit={handleAddManualUrl} className="flex gap-2 items-center">
            <input
              type="url"
              placeholder="https://example.com/property-photo.jpg"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              className="flex-1 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition cursor-pointer"
            >
              Add Link
            </button>
            <button
              type="button"
              onClick={() => setShowUrlInput(false)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>

      {/* Live Camera Viewfinder Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Take Property Photos</h3>
                  <p className="text-[11px] text-slate-400">
                    Snap {minImages} to {maxImages} photos of the building, room, and amenities
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleFacing}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                  title="Switch camera"
                >
                  <SwitchCamera className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsCameraOpen(false)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                  title="Close camera"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Video Viewfinder */}
            <div className="relative bg-black flex-1 min-h-[300px] sm:min-h-[380px] flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />

              {/* Viewfinder crosshairs / rule-of-thirds grid */}
              <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-white/10 opacity-40">
                <div className="border-r border-b border-white/10" />
                <div className="border-r border-b border-white/10" />
                <div className="border-b border-white/10" />
                <div className="border-r border-b border-white/10" />
                <div className="border-r border-b border-white/10" />
                <div className="border-b border-white/10" />
                <div className="border-r border-white/10" />
                <div className="border-r border-white/10" />
                <div />
              </div>

              {/* White flash overlay upon shutter snap */}
              {flashActive && (
                <div className="absolute inset-0 bg-white pointer-events-none transition-opacity duration-150 opacity-90" />
              )}

              {/* Camera Error / Fallback State */}
              {cameraError && (
                <div className="absolute inset-0 bg-slate-900/90 p-6 flex flex-col items-center justify-center text-center space-y-4">
                  <AlertCircle className="w-8 h-8 text-amber-400" />
                  <p className="text-xs text-slate-300 max-w-sm">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCameraOpen(false);
                      mobileCameraInputRef.current?.click();
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs cursor-pointer"
                  >
                    Open Device Camera Directly
                  </button>
                </div>
              )}

              {/* Photo Count Counter pill in Viewfinder */}
              <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-slate-950/70 backdrop-blur-xs text-xs font-semibold text-white flex items-center gap-1.5 border border-white/10">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  {images.length} / {maxImages} Photos Captured
                </span>
              </div>
            </div>

            {/* Viewfinder Controls & Strip */}
            <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-3">
              {/* Thumbnail Strip of photos captured so far */}
              {images.length > 0 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {images.map((img, i) => (
                    <div
                      key={i}
                      className="relative w-14 h-11 rounded-lg overflow-hidden flex-shrink-0 border border-slate-700 bg-slate-800"
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(i)}
                        className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center text-[10px]"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <span className="text-[10px] text-slate-400 pl-1">
                    {images.length >= minImages ? '✓ Ready' : `Need ${minImages - images.length} more`}
                  </span>
                </div>
              )}

              {/* Shutter Button & Completion */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsCameraOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancel
                </button>

                {/* Shutter Circle Button */}
                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  disabled={images.length >= maxImages}
                  aria-label="Capture photograph"
                  className="w-16 h-16 rounded-full border-4 border-white/80 p-1 flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg bg-transparent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="w-full h-full rounded-full bg-emerald-500 group-hover:bg-emerald-400 group-active:bg-emerald-600 transition-colors shadow-inner" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsCameraOpen(false)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
                >
                  Done ({images.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
