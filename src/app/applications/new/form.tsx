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
    <form action={formAction} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
      <div>
        <label htmlFor="companyName" className="block text-sm font-medium text-neutral-700">
          公司名稱（選填）
        </label>
        <input
          id="companyName"
          name="companyName"
          type="text"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="jobTitle" className="block text-sm font-medium text-neutral-700">
          職稱（選填）
        </label>
        <input
          id="jobTitle"
          name="jobTitle"
          type="text"
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="jobUrl" className="block text-sm font-medium text-neutral-700">
          職缺連結（選填，自動抓取內容）
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="jobUrl"
            type="url"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="https://..."
            className="block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleScrape}
            disabled={isScraping || !jobUrl.trim()}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            {isScraping ? "抓取中…" : "抓取內容"}
          </button>
        </div>
        {scrapeMessage && <p className="mt-1 text-xs text-neutral-500">{scrapeMessage}</p>}
      </div>

      <div>
        <label htmlFor="jobDescription" className="block text-sm font-medium text-neutral-700">
          JD 內容（貼上職缺頁面的文字，或用上面的連結自動抓取）
        </label>
        <textarea
          id="jobDescription"
          name="jobDescription"
          required
          rows={10}
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm shadow-sm focus:border-neutral-500 focus:outline-none"
        />
      </div>

      <fieldset>
        <legend className="block text-sm font-medium text-neutral-700">要生成哪個語言版本</legend>
        <div className="mt-2 flex gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" name="language" value="en" />
            英文
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" name="language" value="zh" />
            中文
          </label>
        </div>
      </fieldset>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {isPending ? "建立中…" : "下一步：生成履歷"}
      </button>
    </form>
  );
}
