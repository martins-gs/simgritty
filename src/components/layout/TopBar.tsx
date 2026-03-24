"use client";

import { useAppStore } from "@/store/appStore";

export function TopBar() {
  const userProfile = useAppStore((s) => s.userProfile);

  return (
    <header className="flex h-12 items-center justify-end border-b border-border/60 px-5">
      {userProfile && (
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {userProfile.display_name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <span className="text-[13px] text-foreground">
            {userProfile.display_name}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
            {userProfile.role}
          </span>
        </div>
      )}
    </header>
  );
}
