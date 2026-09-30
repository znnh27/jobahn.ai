"use client";

// 全站統一的中文/英文切換（分段切換樣式）。刻意跟一般按鈕長得不一樣，
// 同一排旁邊放「儲存、定案」這類動作按鈕時才不會混在一起。
export function LangSwitch<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "語言版本",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="lang-switch" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={opt.value === value ? "lang-switch-item lang-switch-item--active" : "lang-switch-item"}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
