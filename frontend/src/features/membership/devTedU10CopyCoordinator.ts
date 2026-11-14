/**
 * Deliberately UNWIRED DEV-only state machine for a staged child copy.
 *
 * A true cross-canister child-ID move is not supported by club_domain.
 * If separately authorised, this coordinates ONE new Group 2 child ID with a
 * durable operator-supplied journal. Nothing calls this in production/UI.
 *
 * Every non-idempotent write is preceded by an awaited durable checkpoint.
 * Unknown outcomes stay pending: there is NO implicit retry or rollback.
 * Group 1 source child, guardians, PII and memberships are never modified.
 */
import { DEV_TED_U10, type DevTedPreflight } from "./devTedU10TransferPreflight";

export const TED_COPY_APPROVAL = "AUTHORISE ONE DEV G2 TED COPY";
export type TedCopyPhase =
  | "create-pending" | "created"
  | "name-pending" | "name-verified"
  | "team-pending" | "team-verified"
  | "staff-verified";

export interface TedCopyReceipt {
  readonly version: 1;
  readonly sourceCanister: string;
  readonly sourceChildId: string;
  readonly targetCanister: string;
  readonly targetClubId: string;
  readonly targetTeamId: string;
  readonly principal: string;
  readonly phase: TedCopyPhase;
  readonly targetChildId: string | null;
}

export interface TedCopyReadback {
  /** Child ID recorded in destination Group 2, or null if absent. */
  id: string | null;
  parent: string | null;
  guardians: readonly string[];
  teams: readonly string[];
}
export interface TedCopyActions {
  /** Must require a real signed-in Test full access browser principal. */
  principal: () => string;
  /** Must re-read source encrypted name, sole guardian and G2 empty target. */
  preflight: () => Promise<DevTedPreflight>;
  /** Must re-read unchanged original G1 record. No G1 writes are allowed. */
  checkSourcePreserved: () => Promise<boolean>;
  /** Durable read/write store. Never store plaintext name or private keys. */
  readReceipt: () => Promise<TedCopyReceipt | null>;
  persistReceipt: (receipt: TedCopyReceipt) => Promise<void>;
  /** Must target only the pinned G2 club_domain with the signed-in Parent. */
  createDestinationOwnChild: () => Promise<{ id: string }>;
  /** Must target G2 PII and propagate failures (NO best-effort catch). */
  registerEncryptedName: (targetChildId: string, name: "Ted") => Promise<void>;
  /** Fresh authenticated G2 PII readback. Missing name is a hard failure. */
  readEncryptedName: (targetChildId: string) => Promise<string | null>;
  /** Fresh G2 child-domain read by the signed-in Parent. */
  readDestinationChild: (targetChildId: string) => Promise<TedCopyReadback>;
  /** Only once after PII readback proves the name. */
  assignDestinationU10: (targetChildId: string) => Promise<void>;
  /** Executed separately with an authorised club-staff principal, never Parent. */
  verifyStaffU10Roster: (targetChildId: string) => Promise<boolean>;
}

export function assertTedCopyReceipt(receipt: TedCopyReceipt): void {
  if (
    receipt.version !== 1 ||
    receipt.sourceCanister !== DEV_TED_U10.sourceCanister ||
    receipt.sourceChildId !== DEV_TED_U10.sourceChildId ||
    receipt.targetCanister !== DEV_TED_U10.destinationCanister ||
    receipt.targetClubId !== DEV_TED_U10.targetClubId ||
    receipt.targetTeamId !== DEV_TED_U10.targetTeamId ||
    receipt.principal !== DEV_TED_U10.parentPrincipal ||
    !([
      "create-pending", "created", "name-pending", "name-verified",
      "team-pending", "team-verified", "staff-verified",
    ] as readonly string[]).includes(receipt.phase) ||
    (receipt.phase === "create-pending" ? receipt.targetChildId !== null :
      !receipt.targetChildId || receipt.targetChildId === receipt.sourceChildId)
  ) {
    throw new Error("Transfer journal is invalid or refers to another child/group.");
  }
}

function baseReceipt(): TedCopyReceipt {
  return {
    version: 1,
    sourceCanister: DEV_TED_U10.sourceCanister,
    sourceChildId: DEV_TED_U10.sourceChildId,
    targetCanister: DEV_TED_U10.destinationCanister,
    targetClubId: DEV_TED_U10.targetClubId,
    targetTeamId: DEV_TED_U10.targetTeamId,
    principal: DEV_TED_U10.parentPrincipal,
    phase: "create-pending",
    targetChildId: null,
  };
}

function assertVerifiedPreflight(result: DevTedPreflight): void {
  if (
    result.parentPrincipal !== DEV_TED_U10.parentPrincipal ||
    result.sourceChildId !== DEV_TED_U10.sourceChildId ||
    result.sourceCanister !== DEV_TED_U10.sourceCanister ||
    result.targetCanister !== DEV_TED_U10.destinationCanister ||
    result.targetClubId !== DEV_TED_U10.targetClubId ||
    result.targetTeamId !== DEV_TED_U10.targetTeamId ||
    result.name !== "Ted" || result.destinationEmpty !== true ||
    result.writeAuthorised !== false
  ) throw new Error("Pinned read-only preflight no longer matches the proposed DEV child copy.");
}

function assertCaller(actions: TedCopyActions): void {
  if (actions.principal() !== DEV_TED_U10.parentPrincipal) {
    throw new Error("The signed-in Parent changed; no DEV child write is allowed.");
  }
}

function assertDestinationChild(row: TedCopyReadback, receipt: TedCopyReceipt, requireTeam: boolean): void {
  if (row.id !== receipt.targetChildId || row.parent !== receipt.principal ||
      row.guardians.length !== 1 || row.guardians[0] !== receipt.principal ||
      (requireTeam ?
        row.teams.length !== 1 || row.teams[0] !== receipt.targetTeamId :
        row.teams.length !== 0)) {
    throw new Error("Destination child ownership, guardians or team assignments changed; stop.");
  }
}

/** The ONLY permitted create path. Re-running with a stored receipt is denied.
 * A lost result after create-pending MUST be reconciled manually, not retried.
 */
export async function beginTedCopyOnce(approval: string, actions: TedCopyActions): Promise<TedCopyReceipt> {
  if (approval !== TED_COPY_APPROVAL) throw new Error("Explicit DEV child-copy authorisation is required.");
  assertCaller(actions);
  if (await actions.readReceipt()) throw new Error("A Ted transfer journal already exists. No second child may be created.");
  assertVerifiedPreflight(await actions.preflight());
  assertCaller(actions);
  if (!(await actions.checkSourcePreserved())) throw new Error("Original Group 1 child could not be reverified.");
  // A durable checkpoint MUST succeed before any non-idempotent create.
  const pending = baseReceipt();
  await actions.persistReceipt(pending);
  assertCaller(actions);
  const newChild = await actions.createDestinationOwnChild();
  // Unknown outcome: preserve the pending journal; do not retry creation.
  if (!newChild?.id || newChild.id === pending.sourceChildId)
    throw new Error("The new Group 2 child ID is unconfirmed. Reconcile the pending journal before continuing.");
  const created: TedCopyReceipt = { ...pending, phase: "created", targetChildId: newChild.id };
  await actions.persistReceipt(created);
  return created;
}

/** Drives only the named completed stage. Never automatically repeats a
 * pending PII or team write after an error/unknown outcome.
 */
export async function continueTedCopy(receipt: TedCopyReceipt, actions: TedCopyActions): Promise<TedCopyReceipt> {
  assertTedCopyReceipt(receipt);
  assertCaller(actions);
  const latest = await actions.readReceipt();
  if (!latest || JSON.stringify(latest) !== JSON.stringify(receipt)) {
    throw new Error("Stored journal changed or is missing. Refusing to continue.");
  }
  if (!(await actions.checkSourcePreserved())) throw new Error("Original Group 1 record changed.");

  const id = receipt.targetChildId;
  if (!id || receipt.phase === "create-pending" || receipt.phase === "name-pending" ||
      receipt.phase === "team-pending") {
    throw new Error("An update may already have succeeded. Reconcile its journal before any new write.");
  }

  if (receipt.phase === "created") {
    assertDestinationChild(await actions.readDestinationChild(id), receipt, false);
    const pending = { ...receipt, phase: "name-pending" as const };
    await actions.persistReceipt(pending);
    assertCaller(actions);
    // This must be a STRICT PII writer; registerLiveChildNamePii is unsuitable
    // because it catches errors and returns void as if writing succeeded.
    await actions.registerEncryptedName(id, "Ted");
    if ((await actions.readEncryptedName(id)) !== "Ted") {
      throw new Error("The encrypted Group 2 name could not be independently read back as Ted.");
    }
    const next = { ...receipt, phase: "name-verified" as const };
    await actions.persistReceipt(next);
    return next;
  }

  if (receipt.phase === "name-verified") {
    assertDestinationChild(await actions.readDestinationChild(id), receipt, false);
    if ((await actions.readEncryptedName(id)) !== "Ted") throw new Error("Verified Group 2 name changed.");
    const pending = { ...receipt, phase: "team-pending" as const };
    await actions.persistReceipt(pending);
    assertCaller(actions);
    await actions.assignDestinationU10(id);
    assertDestinationChild(await actions.readDestinationChild(id), receipt, true);
    const next = { ...receipt, phase: "team-verified" as const };
    await actions.persistReceipt(next);
    return next;
  }

  if (receipt.phase === "team-verified") {
    assertDestinationChild(await actions.readDestinationChild(id), receipt, true);
    if ((await actions.readEncryptedName(id)) !== "Ted" ||
        !(await actions.verifyStaffU10Roster(id)))
      throw new Error("G2 PII or independent staff roster readback not confirmed.");
    const next = { ...receipt, phase: "staff-verified" as const };
    await actions.persistReceipt(next);
    return next;
  }

  // Already verified. Idempotent read-only report; never issue another write.
  return receipt;
}
