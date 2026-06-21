import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

interface RichTextViewerProps {
  content?: any; // TipTap JSON or HTML string
  className?: string;
}

export default function RichTextViewer({ content, className = '' }: RichTextViewerProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-primary-600 underline hover:text-primary-700',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    ],
    content: content || '',
    editable: false,
  });

  if (!editor || !content) return null;

  return (
    <div className={`prose prose-sm max-w-none text-gray-700 ${className}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
