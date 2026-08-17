"use client";

import { useActionState } from "react";
import { createApplication } from "./actions";

type CreateResult = { error?: string };

const initialState: CreateResult = {};

export function NewApplicationForm() {
  const [state, formAction, isPending] = useActionState(
    async (_prev: CreateResult, formData: FormData) => createApplication(formData),
    initialState,
  );

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
        <label htmlFor="jobDescription" className="block text-sm font-medium text-neutral-700">
          JD 內容（貼上職缺頁面的文字）
        </label>
        <textarea
          id="jobDescription"
          name="jobDescription"
          required
          rows={10}
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
