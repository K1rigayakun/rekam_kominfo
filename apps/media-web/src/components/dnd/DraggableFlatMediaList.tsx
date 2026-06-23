import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  defaultDropAnimationSideEffects,
  DragOverlay,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableMediaItem } from './SortableMediaItem';
import { api } from '../../lib/api';

interface DraggableFlatMediaListProps {
  mediaList: any[];
  setMediaList: (media: any[]) => void;
  onMediaClick: (media: any) => void;
  filterUneditedOnly: boolean;
  viewMode?: 'grid' | 'list';
}

export function DraggableFlatMediaList({
  mediaList,
  setMediaList,
  onMediaClick,
  filterUneditedOnly,
  viewMode = 'grid'
}: DraggableFlatMediaListProps) {
  const [activeData, setActiveData] = useState<any>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveData(active.data.current?.media);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveData(null);

    if (!over) return;

    if (active.id !== over.id) {
      const oldIndex = mediaList.findIndex((m) => m.id === active.id);
      const newIndex = mediaList.findIndex((m) => m.id === over.id);
      const newMediaList = arrayMove(mediaList, oldIndex, newIndex);
      setMediaList(newMediaList);

      try {
        await api.put(`/api/media/reorder`, {
          updates: newMediaList.map((m, i) => ({ id: m.id, section_id: null, sort_order: i }))
        });
      } catch (err) {
        console.error('Failed to reorder media', err);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      collisionDetection={closestCenter}
    >
      <SortableContext
        items={mediaList.map((m) => m.id)}
        strategy={rectSortingStrategy}
      >
        <div className={`${viewMode === 'list' ? 'flex flex-col gap-2' : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'}`}>
          {mediaList.map((media) => (
            <SortableMediaItem
              key={media.id}
              id={media.id}
              media={media}
              onClick={() => onMediaClick(media)}
              filterUneditedOnly={filterUneditedOnly}
              viewMode={viewMode}
            />
          ))}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={{ duration: 200, sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }) }}>
        {activeData ? (
          <div className="aspect-square bg-white border-2 border-primary-500 rounded-xl shadow-2xl opacity-90 flex items-center justify-center">
            <p className="text-xs font-medium text-center px-2 truncate w-full">{activeData.display_name || activeData.original_filename}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
