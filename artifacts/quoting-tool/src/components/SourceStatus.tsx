import React from "react";
import { AlertTriangle, BadgeCheck, Star } from "lucide-react";
import type { DataSourceSummary } from "@workspace/api-client-react";

/** "Default" pill shown next to the default source's name. */
export function DefaultBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-success/15 text-success-foreground">
      <Star className="w-3 h-3" /> Default
    </span>
  );
}

/** Quote Profile readiness pill: green when the seller identity is complete, amber (with what is missing) otherwise. */
export function ProfileBadge({ ds, short = false }: { ds: DataSourceSummary; short?: boolean }) {
  if (ds.quoteProfile.complete) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-success/15 text-success-foreground" data-testid={`profile-status-${ds.id}`} data-status="complete">
        <BadgeCheck className="w-3 h-3" /> Quote Profile Complete
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-warning/15 text-warning-foreground"
      title={`Missing: ${ds.quoteProfile.missing.join(", ")}`}
      data-testid={`profile-status-${ds.id}`}
      data-status="incomplete"
    >
      <AlertTriangle className="w-3 h-3" /> Quote Profile incomplete{!short && `: ${ds.quoteProfile.missing.join(", ")}`}
    </span>
  );
}
