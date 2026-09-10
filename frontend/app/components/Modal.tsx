// app/components/Modal.tsx
import { ReactNode } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-start justify-center min-h-full p-3 sm:p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4 sm:my-8">
          <div className="flex justify-between items-center px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b">
            <h2 className="text-lg sm:text-xl font-bold text-gray-800">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              &times;
            </button>
          </div>
          <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-3 sm:pt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
