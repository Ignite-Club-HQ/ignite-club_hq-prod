export const trancheTestManifest = {
  "00": {
    name: "test-governance",
    vitest: [
      "tests/local-supabase/.*\\.unit\\.test\\.ts$",
      "src/test/.*(?:UpgradeSafety|RepositoryGovernance|promotion|Promotion|migration).*\\.test\\.ts$",
    ],
  },
  "01": {
    name: "shared-foundations",
    vitest: [
      "src/(?:hooks|lib)/.*(?:Auth|auth|Cache|cache|Entitlement|entitlement|Session|session|Lifecycle|lifecycle).*\\.test\\.tsx?$",
      "src/components/(?:RouteErrorBoundary|layout/AppLayout).*\\.test\\.tsx$",
      "src/test/.*(?:Auth|auth|Cache|cache|Lifecycle|lifecycle|Entitlement|entitlement).*\\.(?:test|guard)\\.tsx?$",
    ],
    playwright: ["e2e-baseline/auth-safety.spec.ts"],
  },
  "02": {
    name: "membership-roles-invitations",
    vitest: [
      "src/features/membership/.*\\.test\\.tsx?$",
      "src/.*(?:Invite|invite|Invitation|invitation|Guardian|guardian|Membership|membership|Role|role|Season|season).*\\.(?:test|guard)\\.tsx?$",
    ],
    playwright: ["e2e-baseline/committee-invite-mobile-signup.spec.ts"],
    local: [
      "tests/local-supabase/(?:parent-invite|invitations|membership|child-guardian|roles-membership|season-rollover|role-surface).*\\.test\\.ts$",
    ],
  },
  "03": {
    name: "events-home",
    vitest: [
      "src/features/(?:events|home)/.*\\.test\\.tsx?$",
      "src/(?:components/event|pages/(?:CreateEvent|EditEvent|Event|HomePage)).*\\.(?:test|guard)\\.tsx?$",
      "src/lib/.*(?:Event|event|Rsvp|RSVP|rsvp|Attendance|attendance).*\\.test\\.tsx?$",
    ],
    playwright: [
      "e2e-baseline/club-wide-game-rsvp.spec.ts",
      "e2e-baseline/recurring-series-end-date.spec.ts",
    ],
    local: ["tests/local-supabase/(?:club-wide-game-rsvp|event-lifecycle).*\\.test\\.ts$"],
  },
  "04": {
    name: "competition",
    vitest: [
      "src/features/competitions/.*\\.test\\.tsx?$",
      "src/(?:components|pages|lib)/.*(?:Competition|competition|Fixture|fixture|Ladder|ladder).*\\.test\\.tsx?$",
    ],
    local: ["tests/local-supabase/(?:competition|event-groups).*\\.test\\.ts$"],
  },
  "05": {
    name: "messaging-notifications",
    vitest: [
      "src/features/(?:messaging|notifications)/.*\\.test\\.tsx?$",
      "src/(?:components/chat|hooks|lib|pages|test)/.*(?:Chat|chat|Message|message|Inbox|inbox|Notification|notification|Realtime|realtime).*\\.(?:test|guard)\\.tsx?$",
    ],
    playwright: [
      "e2e-baseline/messaging-cross-surface-contracts.spec.ts",
      "e2e-baseline/messaging-navigation-and-layout.spec.ts",
    ],
    local: ["tests/local-supabase/(?:messaging-security|realtime-isolation).*\\.test\\.ts$"],
  },
  "06": {
    name: "vault-media",
    vitest: [
      "src/features/(?:vault|media)/.*\\.test\\.tsx?$",
      "src/(?:components|hooks|lib|pages|test)/.*(?:Vault|vault|Media|media|Photo|photo|Storage|storage).*\\.(?:test|guard)\\.tsx?$",
    ],
    playwright: ["e2e-baseline/vault-upload-safety.spec.ts"],
    local: ["tests/local-supabase/(?:vault|media|storage).*\\.test\\.ts$"],
  },
  "07": {
    name: "pitchboard-autosub",
    vitest: [
      "src/components/pitch/.*\\.(?:test|sim)\\.tsx?$",
      "src/(?:hooks|lib|pages|test)/.*(?:Pitch|pitch|AutoSub|autoSub|Timer|timer|Lineup|lineup|Formation|formation).*\\.(?:test|guard)\\.tsx?$",
    ],
    playwright: ["e2e-baseline/messaging-navigation-and-layout.spec.ts"],
    local: ["tests/local-supabase/pitch-timer-concurrency.test.ts$"],
  },
  "08": {
    name: "telemetry-release-closeout",
    vitest: [
      "src/test/.*(?:Telemetry|telemetry|Security|security|Deployment|deployment|Promotion|promotion|Native|native).*\\.(?:test|guard)\\.tsx?$",
      "src/edge-functions/.*(?:Governance|governance|Security|security).*\\.test\\.ts$",
    ],
  },
  "09a": {
    name: "baseline-dependency-reconciliation",
    vitest: ["src/test/.*(?:Dependency|dependency|Upgrade|upgrade|Security|security).*\\.test\\.tsx?$"],
  },
  "09b": {
    name: "telemetry-recipient-reconciliation",
    vitest: [
      "src/.*(?:Recipient|recipient|Notification|notification|Telemetry|telemetry|Push|push).*\\.(?:test|guard)\\.tsx?$",
      "src/edge-functions/.*\\.test\\.ts$",
    ],
    local: ["tests/local-supabase/.*(?:notification|role-surface|messaging).*\\.test\\.ts$"],
  },
};
