import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav, getDisplayName } from "../../../AppNav";
import { StepBar } from "../../../StepBar";
import { reachedStepFromStatus } from "../../../steps";
import { ApplicationTitle } from "../ApplicationTitle";
import { CoverLetter, type AutoGenerate } from "./CoverLetter";
import { isValidWordLimit } from "@/lib/text/letterLength";
import { isCompanyResearchAvailable } from "@/lib/jobs/researchCompany";

// 求職信頁（流程第 3 步）：履歷定案後才進得來，版面跟履歷頁一樣。
export default async function CoverLetterPage(props: PageProps<"/applications/[id]/cover-letter">) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const { generate } = searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: application } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!application) {
    notFound();
  }

  // 履歷還沒定案（草稿，或定案後又按了回到編輯）就先回履歷頁。
  if (application.status === "draft") {
    redirect(`/applications/${id}`);
  }

  // 從履歷頁的視窗跳過來：?generate=zh,en&limit_zh=400&limit_en=250&research=1
  const autoGenerateLangs = (typeof generate === "string" ? generate.split(",") : []).filter(
    (l) => l === "zh" || l === "en",
  );
  const wordLimits: Record<string, number> = {};
  for (const lang of autoGenerateLangs) {
    const n = Number(searchParams[`limit_${lang}`]);
    if (isValidWordLimit(lang, n)) wordLimits[lang] = n;
  }
  const researchAvailable = isCompanyResearchAvailable();
  const autoGenerate: AutoGenerate | null =
    autoGenerateLangs.length > 0
      ? { languages: autoGenerateLangs, wordLimits, research: researchAvailable && searchParams.research === "1" }
      : null;
  const reached = reachedStepFromStatus(application.status);

  return (
    <div className="page page--with-nav">
      <AppNav userName={getDisplayName(user)} />
      <div className="page-container page-container--canvas">
        <div className="page-title-block">
          <ApplicationTitle
            applicationId={application.id}
            companyName={application.company_name}
            jobTitle={application.job_title}
            status={application.status}
          />
        </div>

        <CoverLetter
          applicationId={application.id}
          resumeLanguages={application.resume_language ?? []}
          initialCoverLetterLanguages={application.cover_letter_language ?? []}
          initialDraft={application.cover_letter_draft}
          resumeChecklist={application.jd_match_checklist ?? {}}
          initialLetterChecklist={application.cover_letter_checklist ?? {}}
          initialCompleted={application.status === "completed"}
          autoGenerate={autoGenerate}
          researchAvailable={researchAvailable}
          stepBar={
            <StepBar
              key="step-bar"
              current={reached === 3 ? 3 : 2}
              reached={reached}
              applicationId={application.id}
              job={{
                companyName: application.company_name,
                jobTitle: application.job_title,
                jobDescription: application.job_description,
              }}
            />
          }
        />
      </div>
    </div>
  );
}
