// Minimal IDL subsets for closed PROD g2 creation. Every setter signature here
// is cross-checked against the generated bindings in prod-g2-create.test.mjs
// (dev layout); hand-copied types must never drift from the real interfaces.

/** All group setters return variant { Ok; Err: text }. */
const unitResult = IDL => IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });

const ARG_KINDS = {
  principal: IDL => [IDL.Principal],
  vecPrincipal: IDL => [IDL.Vec(IDL.Principal)],
  twoPrincipals: IDL => [IDL.Principal, IDL.Principal],
  nat64: IDL => [IDL.Nat64],
  none: () => [],
};

/** Service name → setter method → argument kind (see backend/<name>/<name>.did). */
export const G2_SETTERS = Object.freeze({
  club_domain: {
    register_media_quota_store: 'principal', set_notification_queue_canister: 'principal',
    set_events_domain_canister: 'principal', set_messaging_domain_canister: 'principal',
    set_pii_canister: 'principal', set_mini_league_domain_canister: 'principal',
    set_competition_domain_canister: 'principal', set_competition_authorities: 'vecPrincipal',
    set_gallery_media_authority: 'principal',
  },
  vault_domain: {
    set_club_domain_canister: 'principal', set_vault_stores: 'vecPrincipal',
    set_gallery_media_authority: 'principal', set_messaging_domain_canister: 'principal',
    set_competition_domain_canister: 'principal',
  },
  pii_access_control: { set_club_domain_canister: 'principal', set_competition_domain_canister: 'principal' },
  club_points_domain: { set_club_domain_canister: 'principal' },
  messaging_domain: {
    set_club_domain_canister: 'principal', set_notification_queue_canister: 'principal',
    set_vault_domain_canister: 'principal', set_competition_domain_canister: 'principal',
  },
  notification_queue: {
    set_club_domain_canister: 'principal', set_messaging_domain_canister: 'principal',
    set_identity_access_canister: 'principal', grant_worker: 'principal',
  },
  events_domain: {
    set_club_domain_canister: 'principal', set_notification_queue_canister: 'principal',
    set_competition_domain_canister: 'principal', set_mini_league_domain_canister: 'principal',
  },
  competition_domain: {
    set_club_domain_canister: 'principal', set_participant_club_authorities: 'vecPrincipal',
    set_events_domain_canister: 'principal', set_vault_domain_canister: 'principal',
    set_pii_access_control_canister: 'principal',
  },
  mini_league_domain: { set_club_domain_canister: 'principal', set_events_domain_canister: 'principal' },
  media_metadata: { set_gallery_authorities: 'twoPrincipals' },
  insights_domain: {},
  timer_jobs: { grant_worker: 'principal' },
  media_blob_store: {
    set_club_domain_canister: 'principal', set_vault_authority: 'principal',
    enable_stable_media_storage: 'none', set_capacity_limit: 'nat64',
  },
});

/** Setter-only service actor for one group service. */
export function setterService(IDL, service) {
  const methods = G2_SETTERS[service];
  if (!methods) throw new Error(`Unknown g2 service: ${service}`);
  return () => IDL.Service(Object.fromEntries(Object.entries(methods).map(([method, kind]) =>
    [method, IDL.Func(ARG_KINDS[kind](IDL), [unitResult(IDL)], [])])));
}

/** media_blob_store sizing/health queries (subset records decode by field). */
export function blobStoreService(IDL) {
  return () => IDL.Service({
    ...Object.fromEntries(Object.entries(G2_SETTERS.media_blob_store).map(([method, kind]) =>
      [method, IDL.Func(ARG_KINDS[kind](IDL), [unitResult(IDL)], [])])),
    stable_storage_status: IDL.Func([], [IDL.Record({ enabled: IDL.Bool })], ['query']),
    get_usage: IDL.Func([], [IDL.Record({ capacity_limit_bytes: IDL.Nat64 })], ['query']),
  });
}

/** Every group service exposes cycles_balance: () -> nat query. */
export function cyclesService(IDL) {
  return () => IDL.Service({ cycles_balance: IDL.Func([], [IDL.Nat], ['query']) });
}

/** Cycles ledger: balance + idempotent canister creation (dedup on created_at_time). */
export function ledgerService(IDL) {
  const settings = IDL.Record({ controllers: IDL.Opt(IDL.Vec(IDL.Principal)) });
  const selection = IDL.Variant({ Subnet: IDL.Record({ subnet: IDL.Principal }),
    Filter: IDL.Record({ subnet_type: IDL.Opt(IDL.Text) }) });
  const err = IDL.Variant({
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }), TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), TemporarilyUnavailable: IDL.Null,
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat, canister_id: IDL.Opt(IDL.Principal) }),
    FailedToCreate: IDL.Record({ fee_block: IDL.Opt(IDL.Nat), refund_block: IDL.Opt(IDL.Nat), error: IDL.Text }),
    GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
  });
  return () => IDL.Service({
    icrc1_balance_of: IDL.Func([IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })], [IDL.Nat], ['query']),
    create_canister: IDL.Func([IDL.Record({ from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64), amount: IDL.Nat,
      creation_args: IDL.Opt(IDL.Record({ settings: IDL.Opt(settings), subnet_selection: IDL.Opt(selection) })) })],
      [IDL.Variant({ Ok: IDL.Record({ block_id: IDL.Nat, canister_id: IDL.Principal }), Err: err })], []),
  });
}

/** Cycles ledger deposit: idempotent canister top-up (dedup on created_at_time). */
export function depositService(IDL) {
  const err = IDL.Variant({
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }), TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }), TemporarilyUnavailable: IDL.Null,
    Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
  });
  return () => IDL.Service({
    icrc1_balance_of: IDL.Func([IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })], [IDL.Nat], ['query']),
    deposit: IDL.Func([IDL.Record({ to: IDL.Principal, amount: IDL.Nat, from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
      memo: IDL.Opt(IDL.Vec(IDL.Nat8)), created_at_time: IDL.Opt(IDL.Nat64) })],
      [IDL.Variant({ Ok: IDL.Record({ balance: IDL.Nat, block_index: IDL.Nat }), Err: err })], []),
  });
}

/** Management canister: status, environment variables, chunked install (never reinstall/upgrade). */
export function managementService(IDL) {
  const env = IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text }));
  return () => IDL.Service({
    canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
      status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
      module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal) }) })], []),
    update_settings: IDL.Func([IDL.Record({ canister_id: IDL.Principal, settings: IDL.Record({ environment_variables: IDL.Opt(env) }) })], [], []),
    clear_chunk_store: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [], []),
    upload_chunk: IDL.Func([IDL.Record({ canister_id: IDL.Principal, chunk: IDL.Vec(IDL.Nat8) })], [IDL.Record({ hash: IDL.Vec(IDL.Nat8) })], []),
    install_chunked_code: IDL.Func([IDL.Record({
      mode: IDL.Variant({ install: IDL.Null }), target_canister: IDL.Principal, store_canister: IDL.Opt(IDL.Principal),
      chunk_hashes_list: IDL.Vec(IDL.Record({ hash: IDL.Vec(IDL.Nat8) })), wasm_module_hash: IDL.Vec(IDL.Nat8), arg: IDL.Vec(IDL.Nat8),
      sender_canister_version: IDL.Opt(IDL.Nat64) })], [], []),
  });
}
