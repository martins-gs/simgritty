"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ConsentGateProps {
  contentWarning: string;
  educatorFacilitationRecommended: boolean;
  onConsent: () => void;
  onDecline: () => void;
}

export function ConsentGate({
  contentWarning,
  educatorFacilitationRecommended,
  onConsent,
  onDecline,
}: ConsentGateProps) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
            <AlertTriangle className="h-6 w-6 text-yellow-600" />
          </div>
          <CardTitle>Content Warning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {contentWarning || "This simulation may include distressing content including simulated verbal aggression."}
          </p>

          {educatorFacilitationRecommended && (
            <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
              This scenario is recommended for use with educator facilitation available.
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            You can exit the simulation at any time using the exit button. This is a training exercise — no real patients are involved.
          </p>

          <div className="flex items-center gap-3 rounded-md border p-3">
            <Switch
              id="consent"
              checked={agreed}
              onCheckedChange={setAgreed}
            />
            <Label htmlFor="consent" className="text-sm cursor-pointer">
              I understand the nature of this simulation and wish to proceed
            </Label>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onDecline}>
              Go Back
            </Button>
            <Button
              className="flex-1"
              disabled={!agreed}
              onClick={onConsent}
            >
              Continue to Briefing
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
