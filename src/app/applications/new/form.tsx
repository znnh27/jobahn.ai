"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { createApplication, scrapeJobUrlAction } from "./actions";
import { ProgressBar, Spinner, useEstimatedProgress } from "@/app/ProgressBar";
import { ConfirmDialog } from "@/app/ConfirmDialog";
import { companyMentionedInJd } from "@/lib/jobs/companyInJd";

type CreateResult = { error?: string };

const initialState: CreateResult = {};

export function NewApplicationForm() {
  const [state, formAction, isPending] = useActionState(
    async (_prev: CreateResult, formData: FormData) => createApplication(formData),
    initialState,
  );
  const [jobUrl, setJobUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [scrapeMessage, setScrapeMessage] = useState<string | null>(null);
  const [isScraping, startScrapeTransition] = useTransition();
  const scrapeProgress = useEstimatedProgress(isScraping, 10000);
  const formRef = useRef<HTMLFormElement>(null);
  // JD 裡找不到填的公司名稱時，送出前先確認（可能 JD 貼錯公司）。按「仍要建立」後才真的送出。
  const [mismatchCompany, setMismatchCompany] = useState<string | null>(null);
  const confirmedMismatch = useRef(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (confirmedMismatch.current) {
      confirmedMismatch.current = false;
      return;
    }
    const company = (new FormData(e.currentTarget).get("companyName") as string | null)?.trim() ?? "";
    if (companyMentionedInJd(company, jobDescription) === false) {
      e.preventDefault();
      setMismatchCompany(company);
    }
  }

  function handleScrape() {
    setScrapeMessage(null);
    startScrapeTransition(async () => {
      try {
        const result = await scrapeJobUrlAction(jobUrl);
        if (result.error || !result.text) {
          setScrapeMessage(`錯誤：${result.error}`);
          return;
        }
        setJobDescription(result.text);
        setScrapeMessage("抓取完成，內容已帶入下方，記得檢查一下有沒有多餘的雜訊文字");
      } catch {
        // 請求本身失敗（斷網、逾時）也要告訴使用者，不然進度條消失後什麼都沒發生。
        setScrapeMessage("錯誤：抓取失敗，請檢查網路後再試一次，或直接把 JD 貼到下面");
      }
    });
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="card form-stack">
      <div className="field">
        <label htmlFor="companyName" className="label">
          公司名稱（選填）
        </label>
        <input id="companyName" name="companyName" type="text" className="input" />
      </div>

      <div className="field">
        <label htmlFor="jobTitle" className="label">
          職稱（選填）
        </label>
        <input id="jobTitle" name="jobTitle" type="text" className="input" />
      </div>

      <div className="field">
        <label htmlFor="jobUrl" className="label">
          職缺連結（選填，自動抓取內容）
        </label>
        <div className="input-row">
          <input
            id="jobUrl"
            type="url"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="https://..."
            className="input"
          />
          <button
            type="button"
            onClick={handleScrape}
            disabled={isScraping || !jobUrl.trim()}
            className="btn btn-secondary"
          >
            抓取內容
          </button>
        </div>
        {scrapeProgress !== null && <ProgressBar value={scrapeProgress} label="正在抓取職缺頁面內容…" />}
        {scrapeMessage && <p className="hint-text">{scrapeMessage}</p>}
      </div>

      <div className="field">
        <label htmlFor="jobDescription" className="label">
          JD 內容（貼上職缺頁面的文字，或用上面的連結自動抓取）
        </label>
        <textarea
          id="jobDescription"
          name="jobDescription"
          required
          rows={10}
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          className="textarea"
          aria-describedby="jobDescription-hint"
        />
        <p id="jobDescription-hint" className="hint-text">
          ⚠ JD 內容建立後就不能修改（之後只能查看），履歷跟求職信都會照這份內容寫。貼錯的話要刪掉這筆重新新增。
        </p>
      </div>

      <fieldset>
        <legend className="label">要生成哪個語言版本</legend>
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
        <p className="hint-text">⚠ 語言版本建立後也不能再改。公司名稱跟職稱之後還可以在標題旁邊修改。</p>
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
