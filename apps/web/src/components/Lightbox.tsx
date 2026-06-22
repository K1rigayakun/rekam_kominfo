import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface LightboxProps {
  isOpen: boolean;
  onClose: () => void;
  mediaList: any[];
  initialIndex: number;
  downloadUrlTemplate?: (media: any) => string;
  previewUrlTemplate: (media: any) => string;
}

export default function Lightbox({ isOpen, onClose, mediaList, initialIndex, downloadUrlTemplate, previewUrlTemplate }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, initialIndex]);

  const handleNext = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (currentIndex < mediaList.length - 1) setCurrentIndex(currentIndex + 1);
  };

  const handlePrev = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, mediaList.length]);

  if (!isOpen || mediaList.length === 0) return null;

  const media = mediaList[currentIndex];
  const isVideo = media.media_type === 'VIDEO';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col"
          onClick={onClose}
        >
          <div className="flex justify-between items-center p-4 text-white z-[110]">
            <div className="text-sm font-medium opacity-70">
              {currentIndex + 1} / {mediaList.length} - {media.original_filename || media.display_name}
            </div>
            <div className="flex gap-4">
              {downloadUrlTemplate && (
                <a 
                  href={downloadUrlTemplate(media)} 
                  download
                  onClick={e => e.stopPropagation()}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  title="Download"
                >
                  <Download className="w-6 h-6" />
                </a>
              )}
              <button 
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="flex-1 relative flex items-center justify-center overflow-hidden">
            {currentIndex > 0 && (
              <button 
                onClick={handlePrev}
                className="absolute left-4 p-3 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-md transition-all z-[110]"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
            )}

            <div 
              className="w-full h-full p-4 flex items-center justify-center"
              onClick={e => e.stopPropagation()}
            >
              {isVideo ? (
                <video 
                  src={previewUrlTemplate(media)} 
                  controls 
                  autoPlay 
                  className="w-full h-full object-contain rounded-lg shadow-2xl"
                />
              ) : (
                <img 
                  src={previewUrlTemplate(media)} 
                  alt={media.original_filename} 
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                />
              )}
            </div>

            {currentIndex < mediaList.length - 1 && (
              <button 
                onClick={handleNext}
                className="absolute right-4 p-3 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-md transition-all z-[110]"
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
