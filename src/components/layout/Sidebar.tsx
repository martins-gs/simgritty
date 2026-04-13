"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Home,
  LayoutDashboard,
  BookOpen,
  ChartColumn,
  Settings,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { ProLogWordmark } from "@/components/ProLogLogo";
import { useAppStore } from "@/store/appStore";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const userProfile = useAppStore((s) => s.userProfile);
  const navItems = [
    { href: "/", label: "Home", icon: Home, exact: true },
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/scenarios", label: "Scenarios", icon: BookOpen },
    ...(userProfile?.role === "admin" || userProfile?.role === "educator"
      ? [{ href: "/analytics", label: "Analytics", icon: ChartColumn }]
      : []),
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <aside className="hidden md:flex h-[calc(100vh-36px)] w-56 shrink-0 flex-col border-r border-border/60 bg-sidebar">
      <div className="flex h-12 items-center px-5">
        <Link href="/" className="flex items-center">
          <ProLogWordmark className="text-[17px]" iconSize={26} />
        </Link>
      </div>
      <nav className="flex-1 px-3 pt-2">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
              >
                <item.icon className="h-[15px] w-[15px]" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="border-t border-border/60 px-3 py-2">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <LogOut className="h-[15px] w-[15px]" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
