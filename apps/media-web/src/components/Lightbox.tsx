import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center"
          onClick={onClose}
        >
          {/* Header Absolute */}
          <div className="absolute top-0 left-0 right-0 flex justify-between items-center p-4 text-white z-[110] bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
            <div className="text-sm font-medium opacity-90 pointer-events-auto">
              {currentIndex + 1} / {mediaList.length} - {media.original_filename || media.display_name}
            </div>
            <div className="flex gap-4 pointer-events-auto items-center">
              {downloadUrlTemplate && (
                <a 
                  href={downloadUrlTemplate(media)} 
                  download
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                  title="Download"
                >
                  <Download className="w-5 h-5" />
                  <span className="text-sm font-medium hidden sm:inline">Download</span>
                </a>
              )}
              <button 
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="flex items-center gap-2 px-3 py-2 bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors shadow-lg"
              >
                <X className="w-5 h-5" />
                <span className="text-sm font-semibold">Tutup</span>
              </button>
            </div>
          </div>

          {/* Media Container */}
          <div className="absolute inset-0 p-16 flex items-center justify-center pointer-events-none">
            {currentIndex > 0 && (
              <button 
                onClick={handlePrev}
                className="absolute left-6 p-4 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all z-[110] pointer-events-auto"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
            )}

            {isVideo ? (
              <video 
                src={previewUrlTemplate(media)} 
                controls 
                autoPlay 
                onClick={e => e.stopPropagation()}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl pointer-events-auto"
              />
            ) : (
              <img 
                src={previewUrlTemplate(media)} 
                alt={media.original_filename} 
                onClick={e => e.stopPropagation()}
                className="max-w-full max-h-full object-contain rounded-lg shadow-2xl pointer-events-auto"
              />
            )}

            {currentIndex < mediaList.length - 1 && (
              <button 
                onClick={handleNext}
                className="absolute right-6 p-4 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all z-[110] pointer-events-auto"
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
