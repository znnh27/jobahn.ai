import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BrandMark } from "../../BrandMark";
import { NewApplicationForm } from "./form";

export default async function NewApplicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="page">
      <div className="page-container">
        <BrandMark />
        <div className="page-header">
          <h1 className="heading-page">新增應徵</h1>
          <Link href="/" className="link-muted">
            回首頁
          </Link>
        </div>
        <NewApplicationForm />
      </div>
    </div>
  );
}
