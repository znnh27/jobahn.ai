import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav, getDisplayName } from "../../AppNav";
import { NewApplicationForm } from "./form";
import { StepBar } from "../../StepBar";

export default async function NewApplicationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="page page--with-nav">
      <AppNav userName={getDisplayName(user)} />
      <div className="page-container">
        <div className="page-title-block">
          <h1 className="heading-page">新增應徵</h1>
          <StepBar current={0} />
        </div>
        <NewApplicationForm />
      </div>
    </div>
  );
}
