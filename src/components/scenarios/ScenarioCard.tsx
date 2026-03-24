"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, Edit, Copy, Play, Archive } from "lucide-react";

interface ScenarioCardProps {
  scenario: {
    id: string;
    title: string;
    setting: string;
    difficulty: string;
    status: string;
    archetype_tag: string | null;
    ai_role: string;
    trainee_role: string;
  };
  onDuplicate: (id: string) => void;
  onArchive: (id: string) => void;
}

const difficultyColors: Record<string, string> = {
  low: "bg-green-100 text-green-800",
  moderate: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  extreme: "bg-red-100 text-red-800",
};

export function ScenarioCard({ scenario, onDuplicate, onArchive }: ScenarioCardProps) {
  return (
    <Card className="group relative hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <Link href={`/scenarios/${scenario.id}`} className="flex-1">
          <CardTitle className="text-base leading-tight hover:underline">
            {scenario.title}
          </CardTitle>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted">
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link href={`/scenarios/${scenario.id}`} />}>
              <Edit className="mr-2 h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            {scenario.status === "published" && (
              <DropdownMenuItem render={<Link href={`/scenarios/${scenario.id}/briefing`} />}>
                <Play className="mr-2 h-3.5 w-3.5" /> Start Simulation
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onDuplicate(scenario.id)}>
              <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onArchive(scenario.id)}>
              <Archive className="mr-2 h-3.5 w-3.5" /> Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground line-clamp-1">
            {scenario.setting && `${scenario.setting} — `}
            {scenario.trainee_role} with {scenario.ai_role}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={scenario.status === "published" ? "default" : "secondary"}>
              {scenario.status}
            </Badge>
            <Badge variant="outline" className={difficultyColors[scenario.difficulty] || ""}>
              {scenario.difficulty}
            </Badge>
            {scenario.archetype_tag && (
              <Badge variant="outline" className="text-[10px]">
                {scenario.archetype_tag.replace(/-/g, " ")}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
