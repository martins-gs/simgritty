"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProLogIcon, ProLogWordmark } from "@/components/ProLogLogo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed.endsWith("@nhs.scot")) {
      setError("Only @nhs.scot email addresses can access PROLOG.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3">
            <ProLogIcon size={44} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Sign in to <ProLogWordmark iconSize={0} /></h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            For Health &amp; Care Workers
          </p>
        </div>
        {sent ? (
          <div className="rounded-md border bg-muted/40 px-4 py-5 text-center">
            <p className="text-[13px] font-medium">Check your email</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              We sent a sign-in link to <span className="font-medium">{email.trim().toLowerCase()}</span>.
              Click it to continue.
            </p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[13px]">NHS Scotland email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@nhs.scot"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-9"
              />
            </div>
            {error && (
              <p className="text-[13px] text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full h-9 text-[13px]" disabled={loading}>
              {loading ? "Sending link..." : "Send sign-in link"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
