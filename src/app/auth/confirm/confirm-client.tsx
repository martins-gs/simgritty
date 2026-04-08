"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { ProLogIcon, ProLogWordmark } from "@/components/ProLogLogo";

interface Props {
  token_hash?: string;
  type?: string;
  code?: string;
}

export default function ConfirmClient({ token_hash, type, code }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "verifying" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleConfirm() {
    setStatus("verifying");
    const supabase = createClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        router.replace("/dashboard");
        return;
      }
      setErrorMsg("This sign-in link has already been used or has expired.");
      setStatus("error");
      return;
    }

    if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as EmailOtpType,
      });
      if (!error) {
        router.replace("/dashboard");
        return;
      }
      setErrorMsg("This sign-in link has already been used or has expired.");
      setStatus("error");
      return;
    }

    setErrorMsg("Invalid sign-in link.");
    setStatus("error");
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="mx-auto">
            <ProLogIcon size={44} />
          </div>
          <p className="text-[13px] text-destructive">{errorMsg}</p>
          <Button
            variant="outline"
            className="h-9 text-[13px]"
            onClick={() => router.push("/auth/login")}
          >
            Request a new sign-in link
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3">
            <ProLogIcon size={44} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Sign in to <ProLogWordmark iconSize={0} />
          </h1>
        </div>
        <div className="rounded-md border bg-muted/40 px-4 py-5 text-center space-y-3">
          <p className="text-[13px] text-muted-foreground">
            Click below to complete your sign-in.
          </p>
          <Button
            className="w-full h-9 text-[13px]"
            onClick={handleConfirm}
            disabled={status === "verifying"}
          >
            {status === "verifying" ? "Signing in..." : "Complete sign-in"}
          </Button>
        </div>
      </div>
    </div>
  );
}
