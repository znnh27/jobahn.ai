import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Canvas } from "./canvas";
import { CoverLetter } from "./cover-letter";
import type { ResumeContact } from "@/lib/documents/resumeDocContent";

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

  const contact = (profile?.data as { contact?: ResumeContact })?.contact ?? {
    name_zh: null,
    name_en: null,
    email: null,
    phone: null,
    linkedin: null,
    portfolio: null,
  };

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-[1180px] space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">
              {application.company_name || "未命名公司"} · {application.job_title || "未命名職缺"}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              語言版本：{(application.resume_language ?? []).join(" / ")}
            </p>
          </div>
          <Link href="/" className="text-sm text-neutral-500 hover:underline">
            回首頁
          </Link>
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
        />

        {application.status !== "draft" && (
          <CoverLetter
            applicationId={application.id}
            resumeLanguages={application.resume_language ?? []}
            initialCoverLetterLanguages={application.cover_letter_language ?? []}
            initialDraft={application.cover_letter_draft}
            initialChecklist={application.jd_match_checklist ?? {}}
            initialCompleted={application.status === "completed"}
          />
        )}
      </div>
    </div>
  );
}
