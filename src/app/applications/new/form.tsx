"use client";

import { useActionState, useState, useTransition } from "react";
import { createApplication, scrapeJobUrlAction } from "./actions";

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

  function handleScrape() {
    setScrapeMessage(null);
    startScrapeTransition(async () => {
      const result = await scrapeJobUrlAction(jobUrl);
      if (result.error || !result.text) {
        setScrapeMessage(`錯誤：${result.error}`);
        return;
      }
      setJobDescription(result.text);
      setScrapeMessage("抓取完成，內容已帶入下方，記得檢查一下有沒有多餘的雜訊文字");
    });
  }

  return (
    <form action={formAction} className="card form-stack">
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
            {isScraping ? "抓取中…" : "抓取內容"}
          </button>
        </div>
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
        />
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
      </fieldset>

      {state.error && <p className="text-error">{state.error}</p>}

      <button type="submit" disabled={isPending} className="btn btn-primary">
        {isPending ? "建立中…" : "下一步：生成履歷"}
      </button>
    </form>
  );
}
