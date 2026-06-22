import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Image, Film, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { api, API_URL } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

interface SortableMediaItemProps {
  id: string;
  media: any;
  onClick: () => void;
  filterUneditedOnly?: boolean;
  viewMode?: 'grid' | 'list';
}

export function SortableMediaItem({ id, media, onClick, filterUneditedOnly, viewMode = 'grid' }: SortableMediaItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: {
      type: 'Media',
      media,
    },
    disabled: false, // Could disable if isEditing but wait, let's just use stopPropagation
  });

  const { token } = useAuthStore();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(media.display_name || media.original_filename);
  const [editName, setEditName] = useState(displayName);
  const [isLocallyEdited, setIsLocallyEdited] = useState(Boolean(media.is_edited));

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(displayName);
    setIsEditing(true);
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
      e.preventDefault();
      try {
        await api.put(`/api/media/${media.id}`, { display_name: editName });
        setDisplayName(editName);
        setIsLocallyEdited(true);
        setIsEditing(false);
      } catch (err) {
        console.error('Failed to rename', err);
      }
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(displayName);
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isCompromised = media.status === 'ERROR' && media.processing_error === 'COMPROMISED';

  if (filterUneditedOnly && isLocallyEdited) {
    return null;
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`group relative overflow-hidden border border-gray-200 hover:border-primary-300 premium-transition cursor-grab active:cursor-grabbing ${
        viewMode === 'list' ? 'w-full bg-white rounded-xl' : 'aspect-square bg-gray-100 rounded-xl'
      }`}
    >
      {viewMode === 'list' ? (
        <div className="flex items-center gap-4 w-full h-16 px-4">
          <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center shrink-0 overflow-hidden relative">
            {media.media_type === 'IMAGE' ? (
              <img 
                src={`${API_URL}/api/media/${media.id}/download?quality=preview&inline=true&token=${token}`} 
                alt={media.display_name} 
                className="w-full h-full object-cover" 
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : (
              <video 
                src={`${API_URL}/api/media/${media.id}/download?quality=preview&inline=true&token=${token}`} 
                className="w-full h-full object-cover" 
                controls
                onError={(e) => {
                  (e.target as HTMLVideoElement).style.display = 'none';
                  (e.target as HTMLVideoElement).nextElementSibling?.classList.remove('hidden');
                }}
              />
            )}
            <div className="hidden absolute flex items-center justify-center h-full w-full">
               {media.media_type === 'IMAGE' ? <Image className="w-5 h-5 text-gray-400" /> : <Film className="w-5 h-5 text-gray-400" />}
            </div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center" onDoubleClick={handleDoubleClick}>
            {isEditing ? (
              <input 
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => setIsEditing(false)}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-full text-sm bg-white text-gray-900 px-1 py-0.5 rounded outline-none border border-primary-500"
              />
            ) : (
              <p className="text-gray-900 text-sm font-medium truncate" title="Klik ganda untuk ubah nama">
                {displayName}
              </p>
            )}
            <p className="text-gray-500 text-xs mt-0.5 truncate">{media.title || 'Belum ada judul'}</p>
          </div>
          {isCompromised ? (
             <span className="px-2 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded-md uppercase flex items-center gap-1 shrink-0" title="File ini rusak atau hilang">
               <AlertTriangle className="w-3 h-3" /> Rusak
             </span>
           ) : isLocallyEdited ? null : (
             <span className="px-2 py-1 bg-amber-50 text-amber-600 text-[10px] font-bold rounded-md uppercase shrink-0">Belum Diedit</span>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-center h-full w-full bg-gray-200">
            {media.media_type === 'IMAGE' ? (
              <img 
                src={`${API_URL}/api/media/${media.id}/download?quality=preview&inline=true&token=${token}`} 
                alt={media.display_name} 
                className="w-full h-full object-cover" 
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : (
              <video 
                src={`${API_URL}/api/media/${media.id}/download?quality=preview&inline=true&token=${token}`} 
                className="w-full h-full object-cover" 
                controls
                onError={(e) => {
                  (e.target as HTMLVideoElement).style.display = 'none';
                  (e.target as HTMLVideoElement).nextElementSibling?.classList.remove('hidden');
                }}
              />
            )}
            <div className="hidden absolute flex items-center justify-center h-full w-full">
               {media.media_type === 'IMAGE' ? <Image className="w-8 h-8 text-gray-400" /> : <Film className="w-8 h-8 text-gray-400" />}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2.5" onDoubleClick={handleDoubleClick}>
            {isEditing ? (
              <input 
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => setIsEditing(false)}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="w-full text-xs bg-white text-gray-900 px-1 py-0.5 rounded outline-none border border-primary-500"
              />
            ) : (
              <p className="text-white text-xs truncate font-medium" title="Klik ganda untuk ubah nama">
                {displayName}
              </p>
            )}
            {isCompromised ? (
              <span className="absolute top-[-20px] right-2 px-1.5 py-0.5 bg-red-600 text-white text-[9px] font-bold rounded uppercase shadow-sm flex items-center gap-1" title="File rusak/hilang">
                <AlertTriangle className="w-2.5 h-2.5" /> Rusak
              </span>
            ) : !isLocallyEdited && (
              <span className="absolute top-[-20px] right-2 px-1.5 py-0.5 bg-amber-500 text-white text-[9px] font-bold rounded uppercase shadow-sm">
                Belum Diedit
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
