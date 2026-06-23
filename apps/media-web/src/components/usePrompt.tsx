
import { createRoot } from 'react-dom/client';
import PromptModal from './PromptModal';

interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  inputType?: 'text' | 'password' | 'url';
}

export function usePrompt() {
  const prompt = (options: PromptOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      const handleConfirm = (value: string) => {
        root.unmount();
        container.remove();
        resolve(value);
      };

      const handleCancel = () => {
        root.unmount();
        container.remove();
        resolve(null);
      };

      root.render(
        <PromptModal
          isOpen={true}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          {...options}
        />
      );
    });
  };

  return prompt;
}
