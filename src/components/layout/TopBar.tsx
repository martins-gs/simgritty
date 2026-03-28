"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/store/appStore";
import { cn } from "@/lib/utils";
import { LayoutDashboard, BookOpen, Settings } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/scenarios", label: "Scenarios", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function TopBar() {
  const userProfile = useAppStore((s) => s.userProfile);
  const pathname = usePathname();

  return (
    <header className="flex h-12 items-center justify-between border-b border-border/60 px-4 sm:px-5">
      {/* Mobile nav — visible below md (where sidebar is hidden) */}
      <nav className="flex md:hidden items-center gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              <span className="hidden xs:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Spacer on desktop (sidebar has the nav) */}
      <div className="hidden md:block" />

      {userProfile && (
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {userProfile.display_name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <span className="hidden sm:inline text-[13px] text-foreground">
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
