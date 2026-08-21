import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildResumeDocx } from "@/lib/documents/buildResumeDocx";
import { buildResumePdf } from "@/lib/documents/buildResumePdf";
import type { ResumeContact } from "@/lib/documents/resumeDocContent";
import type { GeneratedResume } from "@/lib/resumes/generateResume";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/applications/[id]/resume-download">,
) {
  const { id } = await ctx.params;
  const searchParams = request.nextUrl.searchParams;
  const lang = searchParams.get("lang");
  const format = searchParams.get("format");

  if (!lang || (format !== "docx" && format !== "pdf")) {
    return new Response("缺少或不合法的 lang / format 參數", { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("請先登入", { status: 401 });

  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("resume_snapshot, resume_language, company_name, job_title")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (appError || !application) {
    return new Response("找不到這筆應徵紀錄", { status: 404 });
  }

  const resumeSnapshot: Record<string, GeneratedResume["resume"]> | null =
    application.resume_snapshot;
  if (!resumeSnapshot || !resumeSnapshot[lang]) {
    return new Response("這個語言版本的履歷還沒定案", { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();

  const contact: ResumeContact = (profile?.data as { contact?: ResumeContact })?.contact ?? {
    name_zh: null,
    name_en: null,
    email: null,
    phone: null,
    linkedin: null,
    portfolio: null,
  };

  const input = { contact, resume: resumeSnapshot[lang], language: lang };
  const buffer = format === "docx" ? await buildResumeDocx(input) : await buildResumePdf(input);

  const namePart = (application.company_name || "resume") + "-" + (application.job_title || id.slice(0, 8));
  const fileName = `${namePart}_${lang}.${format}`.replace(/[^\w.\-一-鿿]+/g, "_");

  const contentType =
    format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/pdf";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
