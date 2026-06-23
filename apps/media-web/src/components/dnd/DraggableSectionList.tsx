import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
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
import type { DragEndEvent, DragStartEvent, DragOverEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableSection } from './SortableSection';
import { SortableMediaItem } from './SortableMediaItem';
import { api } from '../../lib/api';

interface DraggableSectionListProps {
  activityId: string;
  sections: any[];
  setSections: (sections: any[]) => void;
  sectionMedia: Record<string, any[]>;
  setSectionMedia: Dispatch<SetStateAction<Record<string, any[]>>>;
  expandedSections: Set<string>;
  onToggleSection: (id: string) => void;
  onEditSection: (section: any) => void;
  onDeleteSection: (id: string) => void;
  onAttachment: (id: string) => void;
  onMediaClick: (media: any) => void;
  filterUneditedOnly: boolean;
  viewMode?: 'grid' | 'list';
}

export function DraggableSectionList({
  activityId,
  sections,
  setSections,
  sectionMedia,
  setSectionMedia,
  expandedSections,
  onToggleSection,
  onEditSection,
  onDeleteSection,
  onAttachment,
  onMediaClick,
  filterUneditedOnly,
  viewMode = 'grid'
}: DraggableSectionListProps) {
  const [activeType, setActiveType] = useState<'Section' | 'Media' | null>(null);
  const [activeData, setActiveData] = useState<any>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveType(active.data.current?.type);
    setActiveData(active.data.current?.media || active.data.current?.section);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    if (activeType !== 'Media') return;

    const activeContainer = active.data.current?.sortable?.containerId || Object.keys(sectionMedia).find(k => sectionMedia[k]?.find(m => m.id === active.id));
    const overId = over.id;
    const overContainer = overType === 'Section' ? overId : over.data.current?.sortable?.containerId;

    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return;
    }

    setSectionMedia((prev) => {
      const activeItems = prev[activeContainer] || [];
      const overItems = prev[overContainer as string] || [];
      const activeIndex = activeItems.findIndex((m) => m.id === active.id);
      const overIndex = overType === 'Section' 
        ? overItems.length 
        : overItems.findIndex((m) => m.id === overId);

      const newActiveItems = [...activeItems];
      const [movedItem] = newActiveItems.splice(activeIndex, 1);
      const newOverItems = [...overItems];
      
      const insertIndex = overIndex >= 0 ? overIndex : overItems.length;
      newOverItems.splice(insertIndex, 0, movedItem);

      return {
        ...prev,
        [activeContainer]: newActiveItems,
        [overContainer as string]: newOverItems,
      };
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveType(null);
    setActiveData(null);

    if (!over) return;

    if (active.data.current?.type === 'Section' && over.data.current?.type === 'Section') {
      if (active.id !== over.id) {
        const oldIndex = sections.findIndex((s) => s.id === active.id);
        const newIndex = sections.findIndex((s) => s.id === over.id);
        const newSections = arrayMove(sections, oldIndex, newIndex);
        setSections(newSections);

        try {
          await api.put(`/api/activities/${activityId}/sections/reorder`, {
            section_ids: newSections.map((s) => s.id),
          });
        } catch (err) {
          console.error('Failed to reorder sections', err);
        }
      }
    } else if (active.data.current?.type === 'Media') {
      const activeContainer = Object.keys(sectionMedia).find(k => sectionMedia[k]?.find(m => m.id === active.id));
      if (!activeContainer) return;

      const overContainer = over.data.current?.type === 'Section' ? over.id : Object.keys(sectionMedia).find(k => sectionMedia[k]?.find(m => m.id === over.id));
      if (!overContainer) return;

      if (activeContainer === overContainer) {
        const items = sectionMedia[activeContainer] || [];
        const oldIndex = items.findIndex((m) => m.id === active.id);
        const newIndex = items.findIndex((m) => m.id === over.id);

        if (oldIndex !== newIndex) {
          const newItems = arrayMove(items, oldIndex, newIndex);
          setSectionMedia((prev) => ({ ...prev, [activeContainer]: newItems }));
          
          try {
            await api.put(`/api/media/reorder`, {
              updates: newItems.map((m, i) => ({ id: m.id, section_id: activeContainer, sort_order: i }))
            });
          } catch (err) {
            console.error('Failed to reorder media', err);
          }
        }
      } else {
        // Across containers - state already updated in handleDragOver
        const newItems = sectionMedia[overContainer as string] || [];
        try {
          await api.put(`/api/media/reorder`, {
            updates: newItems.map((m, i) => ({ id: m.id, section_id: overContainer, sort_order: i }))
          });
        } catch (err) {
          console.error('Failed to reorder media across sections', err);
        }
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      collisionDetection={closestCenter}
    >
      <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-3">
          {sections.map((section) => (
            <SortableSection
              key={section.id}
              id={section.id}
              section={section}
              isExpanded={expandedSections.has(section.id)}
              onToggle={() => onToggleSection(section.id)}
              onEdit={() => onEditSection(section)}
              onDelete={() => onDeleteSection(section.id)}
              onAttachment={() => onAttachment(section.id)}
            >
              <SortableContext
                id={section.id}
                items={(sectionMedia[section.id] || []).map((m) => m.id)}
                strategy={rectSortingStrategy}
              >
                <div className={`${viewMode === 'list' ? 'flex flex-col gap-2' : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'} mt-4 min-h-[50px]`}>
                  {(sectionMedia[section.id] || []).map((media) => (
                    <SortableMediaItem
                      key={media.id}
                      id={media.id}
                      media={media}
                      onClick={() => onMediaClick(media)}
                      filterUneditedOnly={filterUneditedOnly}
                      viewMode={viewMode}
                    />
                  ))}
                  {(!sectionMedia[section.id] || sectionMedia[section.id].length === 0) && (
                    <div className="col-span-full py-4 text-center text-sm text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
                      Belum ada media di judul ini.
                    </div>
                  )}
                </div>
              </SortableContext>
            </SortableSection>
          ))}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={{ duration: 200, sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }) }}>
        {activeType === 'Section' && activeData ? (
          <div className="bg-white border-2 border-primary-500 rounded-2xl shadow-2xl p-4 opacity-90 cursor-grabbing">
            <p className="font-semibold">{activeData.title}</p>
          </div>
        ) : activeType === 'Media' && activeData ? (
          <div className="aspect-square bg-white border-2 border-primary-500 rounded-xl shadow-2xl opacity-90 cursor-grabbing flex items-center justify-center">
             <p className="text-xs font-medium text-center px-2 truncate w-full">{activeData.display_name || activeData.original_filename}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
