import { useState, useCallback } from 'react';
import ConfirmModal from './ConfirmModal';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export function useConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<{ resolve: (value: boolean) => void } | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    setIsOpen(true);
    return new Promise((resolve) => {
      setResolver({ resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setIsOpen(false);
    if (resolver) resolver.resolve(true);
  }, [resolver]);

  const handleCancel = useCallback(() => {
    setIsOpen(false);
    if (resolver) resolver.resolve(false);
  }, [resolver]);

  const ConfirmDialog = useCallback(() => {
    if (!options) return null;
    return (
      <ConfirmModal
        isOpen={isOpen}
        title={options.title}
        message={options.message}
        confirmText={options.confirmText}
        cancelText={options.cancelText}
        isDestructive={options.isDestructive}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );
  }, [isOpen, options, handleConfirm, handleCancel]);

  return { confirm, ConfirmDialog };
}
