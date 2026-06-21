import { motion, AnimatePresence } from 'motion/react';
import { Question } from '@phosphor-icons/react';
import { useState, useEffect, useRef } from 'react';

interface PromptModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  inputType?: 'text' | 'password' | 'url';
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function PromptModal({
  isOpen,
  title,
  message,
  defaultValue = '',
  placeholder = '',
  confirmText = 'Konfirmasi',
  cancelText = 'Batal',
  inputType = 'text',
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(value);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative w-full max-w-md bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-white/10"
          >
            <form onSubmit={handleSubmit}>
              <div className="p-6">
                <div className="flex items-start gap-4 mb-4">
                  <div className="p-3 rounded-2xl shrink-0 bg-primary-50 text-primary-600">
                    <Question size={28} weight="fill" />
                  </div>
                  <div className="pt-1">
                    <h3 className="text-xl font-bold text-slate-900 mb-1">{title}</h3>
                    {message && <p className="text-slate-500 leading-relaxed text-sm">{message}</p>}
                  </div>
                </div>
                
                <div className="p-1.5 bg-slate-50 border border-slate-100 rounded-2xl">
                  <input
                    ref={inputRef}
                    type={inputType}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={placeholder}
                    className="w-full bg-transparent px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3 rounded-b-[2rem]">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 rounded-xl transition-colors"
                >
                  {cancelText}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-bold text-white rounded-xl shadow-sm transition-all active:scale-95 bg-primary-600 hover:bg-primary-700 shadow-primary-600/20"
                >
                  {confirmText}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
