//! Pending writes survive failed callbacks/upgrades. Never infer no remote
//! mutation from a timeout; retry the same semantic operation and read it back.
use candid::CandidType;
use serde::{Deserialize,Serialize};
use crate::recovery_protocol::Record;
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct Pending {pub record:Record,pub revision:Option<u64>}
pub fn prepare(prior:Option<Pending>,record:Record)->Result<Pending,String> {
    crate::recovery_protocol::validate_record(&record)?;
    match prior {
        Some(p) if p.record==record=>Ok(p),
        Some(_)=>Err("Immutable pending recovery operation conflict".into()),
        None=>Ok(Pending {record,revision:None}),
    }
}
pub fn acknowledge(pending:&Pending,revision:u64,observed:&Record)->Result<Pending,String> {
    // Equivalent semantic retries may read the first immutable operation ID.
    if revision==0 || pending.record.event!=observed.event || pending.revision.is_some_and(|r|r!=revision) {
        return Err("Exact external recovery acknowledgement required".into());
    }
    Ok(Pending {record:pending.record.clone(),revision:Some(revision)})
}
#[cfg(test)] mod tests {
    use super::*;
    use candid::Principal;
    use crate::recovery_protocol::{Event,Progress};
    fn record()->Record {Record {operation_id:"remove:1:base:seal".into(),event:Event::Progress {account_id:"account".into(),generation:1,progress:Progress::Sealed {target:Principal::from_slice(&[3,1])}}}}
    #[test] fn unknown_write_survives_serialization_and_exact_retry() {
        let r=record();let p=prepare(None,r.clone()).unwrap();let restored:Pending=crate::decode(&crate::encode(&p));
        assert_eq!(restored.revision,None);assert_eq!(prepare(Some(restored),r.clone()).unwrap(),p);
        assert_eq!(acknowledge(&p,7,&r).unwrap().revision,Some(7));
    }
    #[test] fn wrong_generation_target_or_ack_revision_cannot_clear_pending() {
        let r=record();let p=prepare(None,r.clone()).unwrap();
        let mut changed=r.clone();if let Event::Progress {generation,..}=&mut changed.event {*generation=2;}
        assert!(prepare(Some(p.clone()),changed.clone()).is_err());assert!(acknowledge(&p,1,&changed).is_err());
        assert!(acknowledge(&p,0,&r).is_err());let ack=acknowledge(&p,1,&r).unwrap();assert!(acknowledge(&ack,2,&r).is_err());
    }
    #[test] fn first_semantic_operation_id_readback_is_valid_but_not_another_event() {
        let p=prepare(None,record()).unwrap();let mut observed=p.record.clone();observed.operation_id="first-attempt".into();
        assert!(acknowledge(&p,1,&observed).is_ok());
        observed.event=Event::Disable {identity:Principal::from_slice(&[3,1]),generation:1};assert!(acknowledge(&p,1,&observed).is_err());
    }
}