"use client";

export type ModalProps = {
  className?: string;
  title?: string;
  text?: string;
  error?: string;
  textForCancel?: string;
  textForConfirm?: string;
  onClose?: () => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export default function Modal({ className, title, text, error, textForCancel, textForConfirm, onClose, onConfirm }: ModalProps) {

    return (
    <div className={className || 'fixed inset-0 flex items-center justify-center bg-black bg-opacity-30 z-50 pointer-events-none'}>
      <div className="bg-white p-6 rounded shadow-lg mx-8 text-black">
        {title && <h2 className="text-xl font-bold mb-4">{title}</h2>}
        {text && <p className="text-gray-700 mb-4">{text}</p>}
        {error && <p className="text-red-500 mb-4" aria-live="polite">{error}</p>}
        <div className="flex justify-end space-x-6">
          {textForCancel && (
            <button
              className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded cursor-pointer pointer-events-auto"
              onClick={onClose}
            >
              {textForCancel}
            </button>
          )}
          {textForConfirm && (
            <button
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded cursor-pointer pointer-events-auto"
              onClick={onConfirm}
            >
              {textForConfirm}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}