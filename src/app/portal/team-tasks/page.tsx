"use client";

import React from "react";
import { PageHeader } from "@/components/ui";
import { TeamTasks } from "@/components/attendance/TeamTasks";

export default function TeamTasksPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Task tim" description="Pantau task anggota tim, tinjau buktinya, dan beri task untuk hari tertentu." />
      <TeamTasks />
    </div>
  );
}
