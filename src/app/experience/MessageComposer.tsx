"use client";

import { useRef, useState } from "react";

// 共用的對話輸入框：中文/日文等輸入法用 Enter 確認選字時，keydown 事件的
// isComposing 會是 true——如果沒有擋掉，選字按下的 Enter 會被誤判成「送出」，
// 導致訊息在還沒打完、輸入法還沒把拼音/注音轉成正式文字時就被截斷送出一半。
// 這裡用 onCompositionStart/End 自己追蹤組字狀態，双重保險再檢查
// e.nativeEvent.isComposing，組字中一律不當成送出鍵處理。
//
// 送出方式預設只能點「送出」按鈕，Enter 永遠不會單按就送出；使用者可以勾選
// 「連按兩下 Enter 送出」，勾選後才會在短時間內連續按兩次 Enter 時送出
// （第一次 Enter 還是正常換行，不攔截）。偏好記在 localStorage，不用每次重選。

const DOUBLE_ENTER_WINDOW_MS = 1000;
const STORAGE_KEY = "jobahn_composer_double_enter";

export function MessageComposer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const [doubleEnterEnabled, setDoubleEnterEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false; // localStorage 不可用就維持預設（只能點按鈕送出）
    }
  });
  const isComposingRef = useRef(false);
  const lastEnterAtRef = useRef(0);

  function toggleDoubleEnter(checked: boolean) {
    setDoubleEnterEnabled(checked);
    try {
      localStorage.setItem(STORAGE_KEY, checked ? "1" : "0");
    } catch {
      // 記不住偏好就算了，不影響這次的操作
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (isComposingRef.current || e.nativeEvent.isComposing) return; // 輸入法選字中，不當送出鍵

    if (!doubleEnterEnabled) return; // 沒勾選就永遠只是換行

    const now = Date.now();
    if (now - lastEnterAtRef.current < DOUBLE_ENTER_WINDOW_MS) {
      e.preventDefault();
      lastEnterAtRef.current = 0;
      if (value.trim()) onSend();
    } else {
      lastEnterAtRef.current = now; // 第一下 Enter，正常換行，記錄時間等第二下
    }
  }

  return (
    <div className="elicitation-composer-wrap">
      <div className="elicitation-composer">
        <textarea
          className="textarea"
          rows={2}
          placeholder={placeholder ?? "打字回覆…"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={handleKeyDown}
        />
        <button type="button" className="btn btn-primary" disabled={disabled || !value.trim()} onClick={onSend}>
          送出
        </button>
      </div>
      <label className="checkbox-label elicitation-composer-option">
        <input
          type="checkbox"
          checked={doubleEnterEnabled}
          onChange={(e) => toggleDoubleEnter(e.target.checked)}
        />
        連按兩下 Enter 送出（不勾選的話只能點「送出」）
      </label>
    </div>
  );
}
