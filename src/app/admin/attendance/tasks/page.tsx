"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import { PageHeader, Tabs } from "@/components/ui";
import { TeamTasks } from "@/components/attendance/TeamTasks";
import { TaskPolicies } from "@/components/attendance/TaskPolicies";

export default function AttendanceTasksPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<"team" | "policies">("team");
  // Policies apply company-wide; a supervisor only works with their own team.
  const canManage = session?.user?.role === "SUPERADMIN" || session?.user?.role === "HRD";
  return (
    <div className="space-y-5">
      <PageHeader title="Task harian" description="Task yang harus diselesaikan karyawan selain absen masuk dan pulang, beserta bukti pekerjaannya." />
      {canManage && <Tabs value={tab} onChange={setTab} tabs={[{ id: "team", label: "Task karyawan" }, { id: "policies", label: "Aturan" }]} />}
      {canManage && tab === "policies" ? <TaskPolicies /> : <TeamTasks />}
    </div>
  );
}
