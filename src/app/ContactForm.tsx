"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { saveContactAction } from "./settings/actions";
import { Spinner } from "./ProgressBar";
import { contactParts, pickName, type ResumeContact } from "@/lib/resumes/contact";

// 履歷抬頭（姓名＋聯絡資訊）表單。兩個地方用：
// 1. 第一次按「生成履歷」前跳出視窗（ContactDialog）
// 2. 帳號設定頁（之後可以改）
// 履歷跟求職信署名都用這裡的名字。

export function ContactForm({
  initial,
  submitLabel = "儲存",
  onSaved,
  onCancel,
}: {
  initial: ResumeContact;
  submitLabel?: string;
  onSaved?: (contact: ResumeContact) => void;
  onCancel?: () => void;
}) {
  const [contact, setContact] = useState<ResumeContact>({ ...initial, others: initial.others ?? [] });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof ResumeContact>(key: K, value: ResumeContact[K]) {
    setSaved(false);
    setContact((c) => ({ ...c, [key]: value }));
  }

  function setOther(index: number, field: "label" | "value", value: string) {
    setSaved(false);
    setContact((c) => ({
      ...c,
      others: (c.others ?? []).map((o, i) => (i === index ? { ...o, [field]: value } : o)),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await saveContactAction(contact);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      onSaved?.(contact);
    } catch {
      setError("儲存失敗，請檢查網路後再試一次");
    } finally {
      setPending(false);
    }
  }

  const previewName = pickName(contact, "en") || pickName(contact, "zh");
  const previewParts = contactParts(contact, "en");

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="contact-form-grid">
        <Field label="中文名" required value={contact.name_zh} onChange={(v) => set("name_zh", v)} placeholder="王小明" />
        <Field
          label="英文名"
          required
          value={contact.name_en}
          onChange={(v) => set("name_en", v)}
          placeholder="Wang, Hsiao-Ming (Ming Wang)"
        />
        <Field label="Email" required value={contact.email} onChange={(v) => set("email", v)} type="email" placeholder="name@example.com" />
        <Field label="電話" value={contact.phone} onChange={(v) => set("phone", v)} type="tel" placeholder="+886-912345678" />
        <Field label="LinkedIn" value={contact.linkedin} onChange={(v) => set("linkedin", v)} placeholder="linkedin.com/in/yourname" />
        <Field label="Portfolio" value={contact.portfolio} onChange={(v) => set("portfolio", v)} placeholder="yourname.com" />
      </div>

      <fieldset className="contact-form-others">
        <legend className="label">其他（選填）</legend>
        {(contact.others ?? []).map((o, i) => (
          <div key={i} className="contact-form-other-row">
            <input
              className="input contact-form-other-label"
              aria-label="欄位名稱"
              placeholder="名稱，例如 GitHub"
              value={o.label}
              onChange={(e) => setOther(i, "label", e.target.value)}
            />
            <input
              className="input"
              aria-label="內容"
              placeholder="內容"
              value={o.value}
              onChange={(e) => setOther(i, "value", e.target.value)}
            />
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              aria-label="刪除這個欄位"
              onClick={() => set("others", (contact.others ?? []).filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="contact-form-add"
          onClick={() => set("others", [...(contact.others ?? []), { label: "", value: "" }])}
        >
          ＋ 新增其他欄位
        </button>
      </fieldset>

      {(previewName || previewParts.length > 0) && (
        <div className="contact-preview" aria-label="履歷抬頭預覽">
          <p className="text-muted-xs">英文履歷抬頭預覽</p>
          <div className="contact-preview-name">{previewName}</div>
          <div className="contact-preview-line">
            {previewParts.map((p, i) => (
              <span key={i}>
                {i > 0 && " / "}
                <strong>{p.label}:</strong> {p.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-error">{error}</p>}
      {saved && !onSaved && <p className="text-success">已儲存</p>}

      {onCancel ? (
        <div className="btn-wrapper">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <Spinner />}
            {submitLabel}
          </button>
        </div>
      ) : (
        // 設定頁（沒有取消鈕）：按鈕跟下面 API Key 表單一樣滿版。
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending && <Spinner />}
          {submitLabel}
        </button>
      )}
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span className="label">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      <input
        className="input"
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}

/** 第一次生成履歷前跳出來的視窗。 */
export function ContactDialog({
  title = "先填履歷抬頭",
  initial,
  submitLabel,
  onSaved,
  onCancel,
}: {
  title?: string;
  initial: ResumeContact;
  submitLabel: string;
  onSaved: (contact: ResumeContact) => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="confirm-overlay">
      <div className="confirm-card contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title">
        <h2 id="contact-dialog-title" className="heading-card--lg">
          {title}
        </h2>
        <p className="text-body">
          履歷最上面的姓名跟聯絡資訊，求職信署名也會用這裡的名字。會存成預設值，之後每一份履歷、求職信都自動套用，不用每次重填；要改的話到「帳號設定」。
        </p>
        <ContactForm initial={initial} submitLabel={submitLabel} onSaved={onSaved} onCancel={onCancel} />
      </div>
    </div>,
    document.body,
  );
}
