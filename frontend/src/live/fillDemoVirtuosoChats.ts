/**
 * One-off, logged-in app-admin Virtuoso test data filler.
 * No credentials, new clubs, teams, polls, events or deployments required.
 * Strictly scoped to the chats you belong to in the demo club you manage.
 */
import { icpCtx, icpListMyAdminClubs, icpListTeams } from "@/lib/icpClubTeamLookup";
import { sendLiveMessage } from "./features/messaging";
import { connectLiveMessagingDomain } from "./domains";
import { unwrapCandid } from "./features/candid";

const LINES = [
  "Please confirm your availability for Saturday's game.",
  "Great effort at training today! ⚽",
  "Can someone bring the cones and bibs?",
  "Reminder to bring boots, shin pads and a drink bottle.",
  "Pitch board discussion: let's try a wider midfield and rotate positions at half time.",
  "Thanks to the volunteers for helping with the junior teams!",
  "This longer sample message is for testing virtual scrolling, message bubble heights and scroll position. Training will begin with warm-ups, move into passing drills, then small-sided games and goalkeeper rotations. Please arrive ten minutes early and let us know if you can't make it.",
  "Check the updated fixtures in Ignite Club HQ.",
  "Who's available to help with the goal setup?",
  "Nice work everyone! 👍",
];

export async function fillDemoVirtuosoChats(
  onProgress: (done: number, total: number) => void,
  target = 150,
): Promise<void> {
  if (target !== 150) throw Error("Only the approved 150-message target is supported");
  const ctx = await icpCtx();
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  // Find the demo club in this deployment by name (IDs differ per environment).
  const club = (await icpListMyAdminClubs()).find(c => /demo/i.test(c.name));
  if (!club) throw Error("No demo club found among the clubs you manage");
  const CLUB = club.id;
  const groups = await unwrapCandid(actor.read_account_list_groups_by_club(CLUB), "Read demo club groups");
  const threads = new Set(groups.filter(g => g.club_id[0] === CLUB && g.is_member).map(g => g.conversation_id));
  for (const team of await icpListTeams(CLUB)) {
    const teamGroups = await unwrapCandid(actor.read_account_list_groups_by_team(team.id), "Read demo team groups");
    for (const g of teamGroups) if (g.club_id[0] === CLUB && g.is_member) threads.add(g.conversation_id);
  }
  const THREADS = [...threads];
  if (!THREADS.length) throw Error(`No chats you belong to in ${club.name}; nothing to seed`);

  const total = THREADS.length * target;
  let done = 0;
  // Deterministic keys ensure that restarting does not create duplicate samples.
  // Existing message counts are checked before each thread to avoid unnecessary sends.
  for (let thread = 0; thread < THREADS.length; thread++) {
    const id = THREADS[thread];
    const page = await unwrapCandid(actor.read_account_list_messages_page(id, [], 1), "Read message count");
    const count = Number(page.latest_sequence) - 1;
    const needed = Math.max(0, target - count);
    for (let i = 0; i < needed; i++) {
      const body = `[DEMO TEST DATA] ${String(i + 1).padStart(3, "0")}: ${LINES[(i + thread) % LINES.length]}`;
      await sendLiveMessage(ctx, id, body, `virt-demo-ui-v1-${thread}-${i}`);
      done++;
      onProgress(done, total);
    }
    // Check readback after each thread; do not claim success on unverified writes.
    const after = await unwrapCandid(actor.read_account_list_messages_page(id, [], 1), "Verify chat count");
    if (Number(after.latest_sequence) - 1 < target) throw Error(`Chat ${thread + 1} has fewer than ${target} messages after seeding`);
  }
}
