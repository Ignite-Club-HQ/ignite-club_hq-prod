import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('team creation only offers download handoff following successful navigation branches', () => {
  const creation = load('frontend/src/pages/CreateTeamPage.tsx');
  assert.equal((creation.match(/justCreatedTeam: true/g) || []).length, 6);
  assert.equal((creation.match(/navigate\(`\/teams\/\$\{team\.id\}`\);/g) || []).length, 0);
  assert.match(creation, /await invalidateTeamLists\(queryClient, user\?\.id\);\s*navigate\(`\/teams\/\$\{team\.id\}`, \{ state: \{ justCreatedTeam: true \} \}\)/);
});

test('completed team readback gates downloads; no native duplicate install or DEV-to-PROD data handoff', () => {
  const detail = load('frontend/src/pages/TeamDetailPage.tsx');
  const guide = load('frontend/src/components/AppStoreDownloadGuide.tsx');
  const intro = detail.indexOf('{/* This appears only after a confirmed team creation');
  const end = detail.indexOf('{/* Post-creation onboarding nudge', intro);
  assert.ok(intro >= 0 && end > intro, 'Expected self-contained download completion UI');
  const section = detail.slice(intro, end);
  assert.match(section, /locationState\?\.justCreatedTeam && team\?\.id === id && !Capacitor\.isNativePlatform\(\)/);
  assert.match(section, /<AppStoreDownloadGuide/);
  assert.match(section, /justCreatedTeam: false/);
  assert.match(section, /Test clubs and teams\s+will not appear in the production iOS or Android apps/);
  assert.doesNotMatch(section, /supabase\.|withFeatureBackend\(|createLive|icp canister install|fetch\(/);
  assert.match(guide, /https:\/\/igniteclubhq\.app\/get\/ios/);
  assert.match(guide, /https:\/\/igniteclubhq\.app\/get\/android/);
});

test('same-day mirrored match visual dedupe retains time-separated rematches', () => {
  const summary = load('frontend/src/components/events/ClubDaySummary.tsx');
  assert.match(summary, /export function dedupeMirroredGames/);
  assert.match(summary, /scope === "club"\) return dedupeMirroredGames\(events \|\| \[\]\)/);
  assert.match(summary, /if \(e\.type !== "game" \|\| !e\.team_name \|\| !e\.opponent\) return true/);
  assert.match(summary, /e\.event_date.*e\.start_time/);
});
