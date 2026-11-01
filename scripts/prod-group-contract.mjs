// Exact infrastructure subset of backend/shard_router/shard_router.did.
export function groupContract(IDL) {
  const { Text: t, Principal: p, Nat64: n } = IDL;
  const result = type => IDL.Variant({ Ok: type, Err: t });
  const Group = IDL.Record({ id: t, target_alias: t, domains: IDL.Vec(IDL.Record({ domain: t, canister: p })),
    accepting: IDL.Bool, max_clubs: IDL.Nat32, assigned_clubs: IDL.Nat32, heap_budget_bytes: n,
    heap_bytes: n, min_cycles: n, cycles: n, observed_at_ns: n, photo_store: IDL.Opt(p) });
  const Placement = IDL.Record({ group_id: t, deployment_id: t, deployment_revision: n,
    host: t, network_kind: t, primary_subnet: p, approved_subnets: IDL.Vec(p), additional_subnets_enabled: IDL.Bool,
    domains: IDL.Vec(IDL.Record({ domain: t, canister: p, subnet: p })) });
  const Page = IDL.Record({ groups: IDL.Vec(Group), placements: IDL.Vec(Placement), revision: n,
    configuration_revision: IDL.Opt(n), next_cursor: IDL.Opt(t) });
  return { Group, Placement, Page, result, reader: () => IDL.Service({
    read_group_registry_page: IDL.Func([t, IDL.Opt(n), IDL.Opt(t), IDL.Nat32], [result(Page)], []),
  }), closedRegistrar: () => IDL.Service({
    read_group_registry_page: IDL.Func([t, IDL.Opt(n), IDL.Opt(t), IDL.Nat32], [result(Page)], []),
    register_group: IDL.Func([Group, n], [result(n)], []),
    register_group_placement: IDL.Func([Placement, n], [result(n)], []),
  }) };
}