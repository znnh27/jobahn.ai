import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav, getDisplayName } from "../../AppNav";
import { ApplicationTitle } from "./ApplicationTitle";
import { Canvas } from "./canvas";
import { StepBar } from "../../StepBar";
import { reachedStepFromStatus } from "../../steps";
import { readContact } from "@/lib/resumes/contact";
import { isCompanyResearchAvailable } from "@/lib/jobs/researchCompany";

export default async function ApplicationDetailPage(
  props: PageProps<"/applications/[id]">,
) {
  const { id } = await props.params;
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

  const { data: profile } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();

  const contact = readContact(profile?.data);

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

        <Canvas
          applicationId={application.id}
          languages={application.resume_language ?? []}
          initialDraft={application.resume_draft}
          initialChecklist={application.jd_match_checklist ?? {}}
          initialAtsScore={application.ats_score}
          initialGaps={application.ats_gaps ?? {}}
          initialFinalized={application.status !== "draft"}
          contact={contact}
          hasCoverLetter={!!application.cover_letter_draft}
          initialCoverLetterLanguages={application.cover_letter_language ?? []}
          researchAvailable={isCompanyResearchAvailable()}
          stepBar={
            <StepBar
              key="step-bar"
              current={1}
              reached={reachedStepFromStatus(application.status)}
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
