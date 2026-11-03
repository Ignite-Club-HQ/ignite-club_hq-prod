// Exact bounded subsets of identity_access and recovery_witness Candid.
export function protectionContract(IDL) {
  const P=IDL.Principal,T=IDL.Text,N=IDL.Nat64,B=IDL.Vec(IDL.Nat8),V=IDL.Vec,R=IDL.Record;
  const result=x=>IDL.Variant({Ok:x,Err:T});
  const Domain=R({domain:T,canister:P});
  const Binding=R({registry:P,registry_revision:N,target_alias:T,deployment_id:T,deployment_revision:N,host:T,network_kind:T});
  const Group=R({id:T,target_alias:T,domains:V(Domain)});
  const Placement=R({group_id:T,deployment_id:T,deployment_revision:N,host:T,network_kind:T,primary_subnet:P,
    approved_subnets:V(P),additional_subnets_enabled:IDL.Bool,domains:V(R({domain:T,canister:P,subnet:P}))});
  const Inventory=R({groups:R({binding:Binding,history_revision:N,snapshot:R({revision:N,groups:V(Group),placements:V(Placement)})}),
    supplemental:V(R({group_id:T,domain:T,canister:P,subnet:P})),media:V(R({club_authority:P,registry:R({active:IDL.Bool,stores:V(P)})}))});
  const Expectation=R({identity:P,inventory:Inventory,modules:V(IDL.Tuple(P,B))});
  const Configuration=R({receiver:P,authority:IDL.Opt(P),protocol:IDL.Nat32,admission_required:IDL.Bool,removal_enabled:IDL.Bool,rehearsal:IDL.Bool});
  const Lifecycle=R({canister:P,module_hash:B,changes:N});
  const Draft=R({inventory:Inventory,eligibility_readers:V(P),account_readers:V(P),targets:V(P),lifecycle:V(Lifecycle),
    configurations:V(Configuration),release_authorized:IDL.Bool,recovery_accepted:IDL.Bool});
  const Body=R({kind:T,identity:P,operator:P,generation:N,expires_at_ns:N,expectation:Expectation,review:Draft,
    original_inventory_evidence:B,runtime_evidence:B,fenced_recovery_evidence:B,recovery_epoch:N});
  const Approval=R({body:Body,signature:B});
  const Acceptance=R({witness:P,witness_version:N,identity:P,identity_version:N,epoch:N,journal_revision:N,journal_digest:B,
    inventory_digest:B,decoded_history_digest:B,generation:N,signed_digest:B,expires_at_ns:N,history_revision:N,removal_generation:N,
    participants:V(R({canister:P,module:B,changes:N}))});
  const SignedAcceptance=R({body:Acceptance,signature:B});
  const State=R({generation:N,approval:IDL.Opt(Approval)});
  const Progress=IDL.Variant({Prepared:R({target:P}),Sealed:R({target:P}),Completed:IDL.Null});
  const Record=R({operation_id:T,event:IDL.Variant({Disable:R({generation:N,identity:P}),
    Removal:R({account_id:T,inventory_digest:B,subjects:V(P),generation:N,targets:V(P)}),Progress:R({account_id:T,generation:N,progress:Progress})})});
  const Head=R({epoch:N,revision:N,digest:B,accepted:IDL.Opt(SignedAcceptance)});
  const Request=R({identity:P,generation:N,recovery_epoch:N,signed_digest:B,request_id:N,history_revision:N,removal_generation:N,identity_version:N});
  const func=(args,out)=>IDL.Func(args,[result(out)],[]);
  return {Inventory,Expectation,Configuration,Draft,Body,Approval,Acceptance,SignedAcceptance,State,Record,Head,Request,
    identity:()=>IDL.Service({
      review_production_account_inventory:func([Expectation,N],Draft),review_production_account_protection:func([Expectation,N],Draft),
      read_active_production_account_protection:func([],Draft),
      production_account_approval_signing_bytes:func([Body],B),provision_production_account_inventory:func([Approval],N),
      authorize_production_account_readers:func([Approval],N),read_production_account_authorization:func([],State),
      read_production_account_history_revision:func([],N),read_production_account_removal_generation:func([],N),read_production_account_runtime_version:func([],N),
    }),
    witness:()=>IDL.Service({read_recovery_head:func([],Head),read_recovery_runtime_version:func([],N),
      read_recovery_records:func([N,IDL.Nat16],V(IDL.Tuple(N,Record))),recovery_acceptance_signing_bytes:func([Acceptance],B),
      subject_progress_approval_signing_bytes:func([Acceptance],B),accept_recovery_fence:func([SignedAcceptance],N),
      authorize_subject_removal_progress:func([SignedAcceptance],IDL.Null)}),
    infrastructure:()=>IDL.Service({read_account_removal_authority:IDL.Func([],[IDL.Opt(P)],[]),set_account_removal_authority:func([P],IDL.Null)}),
  };
}