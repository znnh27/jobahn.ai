"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { createApplication, tidyPastedJdAction } from "./actions";
import { ProgressBar, Spinner, useEstimatedProgress } from "@/app/ProgressBar";
import { ConfirmDialog } from "@/app/ConfirmDialog";
import { companyMentionedInJd } from "@/lib/jobs/companyInJd";
import { InfoTip } from "../../InfoTip";

type CreateResult = { error?: string };

const initialState: CreateResult = {};

export function NewApplicationForm() {
  const [state, formAction, isPending] = useActionState(
    async (_prev: CreateResult, formData: FormData) => createApplication(formData),
    initialState,
  );
  const [jobUrl, setJobUrl] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  // AI 整理時帶回來的公司名稱：跟 JD 出自同一個職缺頁，送出時不用再檢查 JD 裡有沒有這個名稱
  // （104 的 JD 內文常常不寫公司名，不然每次都會跳「可能貼錯公司」）。
  const [scrapedCompany, setScrapedCompany] = useState<string | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  // 最上面「從職缺頁帶入」：整頁貼上 → 按「AI 整理」才整理（2026-10-27 Z 要求：不要貼上就自動讀取），
  // 整理完填進下面空白的欄位。貼上框的內容不送出、整理完也保留，整理錯了可以直接再按一次。
  // 整理成功不另外說明（欄位填好就是回饋），只有失敗才顯示錯誤。
  const [pagePaste, setPagePaste] = useState("");
  const [tidyError, setTidyError] = useState<string | null>(null);
  const [isTidying, startTidyTransition] = useTransition();
  const tidyProgress = useEstimatedProgress(isTidying, 20000);
  const formRef = useRef<HTMLFormElement>(null);
  // JD 裡找不到填的公司名稱時，送出前先確認（可能 JD 貼錯公司）。按「仍要建立」後才真的送出。
  const [mismatchCompany, setMismatchCompany] = useState<string | null>(null);
  const confirmedMismatch = useRef(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (confirmedMismatch.current) {
      confirmedMismatch.current = false;
      return;
    }
    const company = companyName.trim();
    if (company !== scrapedCompany && companyMentionedInJd(company, jobDescription) === false) {
      e.preventDefault();
      setMismatchCompany(company);
    }
  }

  /** 只填空白的欄位，使用者已經打的不蓋掉（2026-10-27 Z 選的）。 */
  function fillEmptyFields(result: { text?: string; companyName?: string | null; jobTitle?: string | null }) {
    if (result.companyName && !companyName.trim()) {
      setCompanyName(result.companyName);
      setScrapedCompany(result.companyName);
    }
    if (result.jobTitle && !jobTitle.trim()) setJobTitle(result.jobTitle);
    if (result.text && !jobDescription.trim()) setJobDescription(result.text);
  }

  // 「AI 整理」：從整頁貼上的內容挑出職缺本身、公司名稱、職稱，填進下面空白的欄位。
  function handleTidy() {
    setTidyError(null);
    startTidyTransition(async () => {
      try {
        const result = await tidyPastedJdAction(pagePaste);
        if (result.notJob) {
          setTidyError("看起來不是職缺頁的內容");
          return;
        }
        if (result.error || !result.text) {
          setTidyError(result.error ?? "AI 整理失敗，可以再按一次");
          return;
        }
        fillEmptyFields(result);
      } catch {
        // 請求本身失敗（斷網、逾時）也要告訴使用者，不然進度條消失後什麼都沒發生。
        setTidyError("AI 整理失敗，請檢查網路後再試一次");
      }
    });
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="card form-stack">
      {/* 從職缺頁帶入（選填）：整頁貼上、按「AI 整理」，填好下面空白的欄位。操作說明直接顯示，不收進 ⓘ（2026-10-27 Z 要求）。
          貼上框沒有 name，內容不會送出。 */}
      <section className="quick-import" aria-labelledby="quick-import-title">
        <label htmlFor="pagePaste" id="quick-import-title" className="label">
          從職缺頁帶入（選填）
        </label>
        <p className="hint-text field-hint">
          在職缺頁按 ⌘A 或 Ctrl+A 全選、複製後貼在這裡，再按「AI 整理」，會自動填好下面的欄位。
        </p>
        <textarea
          id="pagePaste"
          rows={3}
          value={pagePaste}
          onChange={(e) => setPagePaste(e.target.value)}
          readOnly={isTidying}
          placeholder="請在這裡貼上網頁全部內容"
          className="textarea"
        />
        {tidyProgress !== null && <ProgressBar value={tidyProgress} label="AI 正在從貼上的內容挑出職缺…" />}
        <div className="quick-import-actions">
          {tidyError && <p className="text-error">{tidyError}</p>}
          <button
            type="button"
            onClick={handleTidy}
            disabled={isTidying || !pagePaste.trim()}
            className="btn btn-secondary"
          >
            {isTidying && <Spinner />}
            AI 整理
          </button>
        </div>
      </section>

      <div className="field">
        <label htmlFor="companyName" className="label">
          公司名稱
        </label>
        <input
          id="companyName"
          name="companyName"
          type="text"
          required
          className="input"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="jobTitle" className="label">
          職稱
        </label>
        <input
          id="jobTitle"
          name="jobTitle"
          type="text"
          required
          className="input"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="jobUrl" className="label">
          職缺連結（選填）
        </label>
        <input
          id="jobUrl"
          name="jobUrl"
          type="url"
          value={jobUrl}
          onChange={(e) => setJobUrl(e.target.value)}
          placeholder="https://..."
          className="input"
        />
      </div>

      <div className="field">
        <label htmlFor="jobDescription" className="label">
          JD 內容
          <InfoTip label="JD 內容的說明">
            <ul>
              <li>履歷跟求職信都會照這份內容寫</li>
              <li>建立後不能修改，之後只能查看</li>
              <li>貼錯的話，要刪掉這筆重新新增</li>
            </ul>
          </InfoTip>
        </label>
        <textarea
          id="jobDescription"
          name="jobDescription"
          required
          rows={10}
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          className="textarea"
        />
      </div>

      <fieldset>
        <legend className="label">
          要生成哪個語言版本
          <InfoTip label="語言版本的說明">
            <ul>
              <li>語言版本建立後不能再改</li>
              <li>公司名稱跟職稱之後還可以在標題旁邊修改</li>
            </ul>
          </InfoTip>
        </legend>
        <div className="checkbox-row">
          <label className="checkbox-label">
            <input type="checkbox" name="language" value="en" />
            英文
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="language" value="zh" />
            中文
          </label>
        </div>
      </fieldset>

      {state.error && <p className="text-error">{state.error}</p>}

      <button type="submit" disabled={isPending} className="btn btn-primary">
        {isPending && <Spinner />}
        下一步：生成履歷
      </button>

      {mismatchCompany && (
        <ConfirmDialog
          title="JD 跟公司名稱好像對不上"
          message={`JD 內容裡找不到「${mismatchCompany}」，確定貼的是同一份職缺嗎？JD 建立後就不能修改，貼錯的話履歷、求職信都會寫給別間公司。有些 JD 本來就不寫公司名稱，確認沒問題可以直接建立。`}
          confirmLabel="仍要建立"
          cancelLabel="回去檢查"
          tone="primary"
          onConfirm={() => {
            setMismatchCompany(null);
            confirmedMismatch.current = true;
            formRef.current?.requestSubmit();
          }}
          onCancel={() => setMismatchCompany(null)}
        />
      )}
    </form>
  );
}
