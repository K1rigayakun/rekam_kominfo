import React, { useState, useEffect } from 'react';
import { X, FilmStrip, Upload, Trash, SpinnerGap } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'motion/react';
import RichTextEditor from './RichTextEditor';

export interface UploadFileItem {
  file: File;
  displayName: string;
}

interface SectionEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activityId: string;
  activityTitle: string;
  section?: {
    id?: string;
    title: string;
    description_json?: any;
    description?: string;
  } | null;
  onSave: (data: { title: string; description: string; description_json: any }) => Promise<any>;
  onQueueUpload: (sectionId: string, files: UploadFileItem[], useAutoNaming: boolean) => void;
}

export default function SectionEditorModal({
  isOpen,
  onClose,
  activityTitle,
  section,
  onSave,
  onQueueUpload,
}: SectionEditorModalProps) {
  const [title, setTitle] = useState('');
  const [descriptionJson, setDescriptionJson] = useState<any>(null);
  const [descriptionHtml, setDescriptionHtml] = useState('');
  const [uploadFiles, setUploadFiles] = useState<UploadFileItem[]>([]);
  const [useAutoNaming, setUseAutoNaming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (section) {
        setTitle(section.title || '');
        setDescriptionJson(section.description_json || null);
        setDescriptionHtml(section.description || '');
      } else {
        setTitle('');
        setDescriptionJson(null);
        setDescriptionHtml('');
      }
      setUploadFiles([]);
      setUseAutoNaming(false);
    }
  }, [isOpen, section]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map(file => ({
        file,
        displayName: file.name
      }));
      setUploadFiles(prev => [...prev, ...newFiles]);
    }
    // reset input
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  const updateFileName = (index: number, newName: string) => {
    setUploadFiles(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], displayName: newName };
      return updated;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setSaving(true);
    try {
      // 1. Save Section via callback
      const savedSection = await onSave({
        title,
        description: descriptionHtml,
        description_json: descriptionJson
      });

      // 2. Queue Uploads if any
      if (uploadFiles.length > 0 && savedSection?.id) {
        onQueueUpload(savedSection.id, uploadFiles, useAutoNaming);
      }

      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-xl font-bold text-gray-900">
              {section?.id ? 'Edit Judul / Seksi' : 'Tambah Judul / Seksi'}
            </h2>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              <X weight="bold" className="w-5 h-5" />
            </button>
          </div>

          {/* Form Content (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {/* Title */}
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-2 block">
                Nama Judul <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Misal: Sesi Foto Utama, Penyerahan Plakat..."
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all font-medium text-gray-900"
              />
            </div>

            {/* Description (Rich Text) */}
            <div>
              <label className="text-sm font-semibold text-gray-700 mb-2 block">Deskripsi Judul (Opsional)</label>
              <div className="border border-gray-200 rounded-xl overflow-hidden bg-white focus-within:ring-2 focus-within:ring-primary-500/20 focus-within:border-primary-500 transition-all">
                <RichTextEditor
                  content={descriptionJson}
                  onChange={(json, html) => {
                    setDescriptionJson(json);
                    setDescriptionHtml(html);
                  }}
                  placeholder="Tulis deskripsi atau catatan khusus untuk sesi ini..."
                  minHeight="120px"
                />
              </div>
            </div>

            {/* Media Upload Area */}
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
              <label className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
                <Upload className="w-4 h-4 text-primary-600" />
                Upload Media Langsung
              </label>

              {/* Upload Dropzone / Button */}
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-gray-300 rounded-xl hover:border-primary-400 hover:bg-primary-50/50 cursor-pointer transition-colors relative">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  <Upload className="w-4 h-4" />
                  Pilih Foto atau Video
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>

              {/* File List / Preview */}
              {uploadFiles.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-gray-700 bg-white px-2 py-1 rounded-md shadow-sm border border-gray-100">
                      {uploadFiles.length} file dipilih
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="autoNameSection"
                        checked={useAutoNaming}
                        onChange={(e) => setUseAutoNaming(e.target.checked)}
                        className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500"
                      />
                      <label htmlFor="autoNameSection" className="text-xs text-gray-600 cursor-pointer">
                        Penamaan Otomatis ({activityTitle} - {title || 'Foto'} 01)
                      </label>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                    {uploadFiles.map((uf, i) => (
                      <div key={i} className="flex gap-3 bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm items-center group">
                        <div className="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-gray-100 border border-gray-100 relative">
                          {uf.file.type.startsWith('image/') ? (
                            <img src={URL.createObjectURL(uf.file)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <FilmStrip className="w-5 h-5" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            value={uf.displayName}
                            onChange={(e) => updateFileName(i, e.target.value)}
                            placeholder="Nama file..."
                            className="w-full text-sm font-semibold text-gray-900 border-none p-0 focus:ring-0 placeholder:text-gray-400 bg-transparent"
                          />
                          <p className="text-[10px] text-gray-400 truncate mt-0.5" title={uf.file.name}>
                            Asli: {uf.file.name} ({(uf.file.size / 1024 / 1024).toFixed(1)} MB)
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(i)}
                          className="w-8 h-8 shrink-0 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-colors"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !title.trim()}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-xl transition-colors shadow-sm flex items-center gap-2"
            >
              {saving ? <SpinnerGap className="w-4 h-4 animate-spin" /> : 'Simpan'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
