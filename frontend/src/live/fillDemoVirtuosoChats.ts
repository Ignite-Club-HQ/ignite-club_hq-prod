/**
 * One-off, logged-in app-admin Virtuoso test data filler.
 * No credentials, new clubs, teams, polls, events or deployments required.
 * Strictly scoped to the existing Ignite Soccer Demo Club conversations.
 */
import { icpCtx } from "@/lib/icpClubTeamLookup";
import { sendLiveMessage } from "./features/messaging";
import { connectLiveMessagingDomain } from "./domains";
import { unwrapCandid } from "./features/candid";

const CLUB = "9c5fa204-6cbe-49d5-a3d2-26b98b0419de";
const THREADS = [
  `default-club-chat:${CLUB}:coaches`,
  `default-club-chat:${CLUB}:club_committee`,
  `default-club-chat:${CLUB}:team_admins`,
  `chat-${CLUB}-13`,
  CLUB,
  "b13954cf-a9f8-4b51-9cb1-0f7ec6a31820",
  "d4f22f68-26a0-4868-a0aa-2b28dcd01933",
  "e813df04-63bd-4dcb-bdf9-bccfa8c57d21",
  "f04f188b-8cb4-475e-9f31-0cf0f83ab20c",
] as const;
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
  const groups = await unwrapCandid(await actor.read_account_list_groups_by_club(CLUB), "Read demo club groups");
  const clubGroups = new Set(groups.filter(g => g.club_id[0] === CLUB && g.is_member).map(g => g.conversation_id));
  // Team conversations are not returned by list_groups_by_club; their exact IDs
  // are fixed and checked separately against their live team groups.
  const teamIds = [
    "b13954cf-a9f8-4b51-9cb1-0f7ec6a31820",
    "d4f22f68-26a0-4868-a0aa-2b28dcd01933",
    "e813df04-63bd-4dcb-bdf9-bccfa8c57d21",
    "f04f188b-8cb4-475e-9f31-0cf0f83ab20c",
  ];
  for (const id of THREADS.slice(0, 5)) if (!clubGroups.has(id)) throw Error("Missing demo club chat; refusing to seed");
  for (const id of teamIds) {
    const teamGroups = await unwrapCandid(await actor.read_account_list_groups_by_team(id), "Read demo team groups");
    if (!teamGroups.some(g => g.conversation_id === id && g.club_id[0] === CLUB && g.is_member)) {
      throw Error("Missing demo team chat; refusing to seed");
    }
  }

  const total = THREADS.length * target;
  let done = 0;
  // Deterministic keys ensure that restarting does not create duplicate samples.
  // Existing message counts are checked before each thread to avoid unnecessary sends.
  for (let thread = 0; thread < THREADS.length; thread++) {
    const id = THREADS[thread];
    const page = await unwrapCandid(await actor.read_account_list_messages_page(id, [], 1), "Read message count");
    const count = Number(page.latest_sequence) - 1;
    const needed = Math.max(0, target - count);
    for (let i = 0; i < needed; i++) {
      const body = `[DEMO TEST DATA] ${String(i + 1).padStart(3, "0")}: ${LINES[(i + thread) % LINES.length]}`;
      await sendLiveMessage(ctx, id, body, `virt-demo-ui-v1-${thread}-${i}`);
      done++;
      onProgress(done, total);
    }
    // Check readback after each thread; do not claim success on unverified writes.
    const after = await unwrapCandid(await actor.read_account_list_messages_page(id, [], 1), "Verify chat count");
    if (Number(after.latest_sequence) - 1 < target) throw Error(`Chat ${thread + 1} has fewer than ${target} messages after seeding`);
  }
}
