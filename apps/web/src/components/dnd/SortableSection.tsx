import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, GripVertical, Paperclip, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

interface SortableSectionProps {
  id: string;
  section: any;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAttachment: () => void;
  children: ReactNode;
}

export function SortableSection({
  id,
  section,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onAttachment,
  children,
}: SortableSectionProps) {
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
      type: 'Section',
      section,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden mb-3 ${
        isDragging ? 'ring-2 ring-primary-500 shadow-xl' : ''
      }`}
    >
      {/* Section header */}
      <div className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50 premium-transition">
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -ml-1 hover:bg-gray-100 rounded"
        >
          <GripVertical className="w-4 h-4 text-gray-300 hover:text-gray-500" />
        </div>
        
        <button
          onClick={onToggle}
          className="flex items-center gap-3 flex-1 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
          <span className="font-semibold text-gray-900 flex-1">{section.title}</span>
          {section.compromised_count > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-semibold bg-red-50 text-red-600 px-2.5 py-1 rounded-full border border-red-100" title={`${section.compromised_count} file rusak`}>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              {section.compromised_count} Isu
            </span>
          )}
          <span className="text-xs text-text-muted bg-gray-100 px-2.5 py-1 rounded-full">
            {section.media_count} media
          </span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAttachment();
          }}
          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
          title="Lampiran Judul"
        >
          <Paperclip className="w-4 h-4" /> Lampiran
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Edit Judul"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="Hapus Judul"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Section content (media grid) */}
      {isExpanded && (
        <div className="px-5 pb-5 border-t border-gray-50">
          {children}
        </div>
      )}
    </div>
  );
}
