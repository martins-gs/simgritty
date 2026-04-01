"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OrgSettingsForm } from "@/components/governance/OrgSettingsForm";
import type { OrgSettings } from "@/types/governance";
import { createClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        setIsAdmin(profile?.role === "admin");
      }

      const res = await fetch("/api/org-settings");
      if (res.ok) {
        setSettings(await res.json());
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
          Full RBAC permissions functionality will be implemented in next version. Current permissions are to enable management to view all features of the app.
        </div>
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-[13px] text-muted-foreground">
            Governance, content policies, and session limits
          </p>
        </div>

        {loading ? (
          <p className="text-[13px] text-muted-foreground">Loading...</p>
        ) : settings ? (
          <OrgSettingsForm settings={settings} isAdmin={isAdmin} />
        ) : (
          <p className="text-[13px] text-muted-foreground">Unable to load settings</p>
        )}
      </div>
    </AppShell>
  );
}
