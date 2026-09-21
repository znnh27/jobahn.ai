"use client";

export function CompletionPopup({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="completion-popup-overlay" onClick={onClose}>
      <div className="completion-popup-card" onClick={(e) => e.stopPropagation()}>
        <p className="completion-popup-message">{message}</p>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          太好了！繼續優化履歷
        </button>
      </div>
    </div>
  );
}
