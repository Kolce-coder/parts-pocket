import * as C from './core.js';
import * as S from './store.js';
import * as M from './merge.js';

export async function syncOnce({db,remote,active=()=>true,decision=null}) {
  const check=()=>{if(!active())throw new Error('Sync cancelled because the account changed.');};
  for(let attempt=0;attempt<3;attempt++) {
    check();const snapshot=await S.readSyncSnapshot(db),local=M.textInventory(snapshot.state);
    const cloud=await remote.pull(snapshot.meta);check();
    if(cloud.revision<snapshot.meta.remoteRevision)throw new Error('The shared inventory file is missing or was rolled back. Your saved inventory is safe here. Restore the file from GitHub history before syncing again.');
    const remoteState=M.textInventory(cloud.state);
    // A durable request ID distinguishes our lost acknowledgement from an
    // independent device making the same numerical adjustment.
    const confirmed=snapshot.attempt&&(cloud.writeId===snapshot.attempt.id||cloud.receipts?.includes(snapshot.attempt.id));
    const base=confirmed?M.textInventory(snapshot.attempt.local):M.textInventory(snapshot.meta.base);
    let next;
    if(decision) {
      if(snapshot.state.revision!==decision.localRevision||cloud.revision!==decision.remoteRevision)throw new Error('The inventory changed since this review. Review the latest copies before choosing.');
      if(!['local','remote','merge'].includes(decision.source))throw new Error('Choose which copy to keep.');
      await S.saveRecovery(db,snapshot.state.revision,remoteState);check();
      next=decision.source==='local'?local:decision.source==='remote'?{...remoteState,lastBackupAt:local.lastBackupAt}:M.mergeInventories(base,local,remoteState,decision.resolutions).state;
      if(!next)throw new Error('Check every conflicting quantity before saving.');
    } else {
      if(snapshot.attempt&&!confirmed)return {status:'conflict',local:snapshot.state,remote:{state:remoteState,revision:cloud.revision},conflicts:[],structural:'An earlier save could not be confirmed. Review these copies before syncing so an old adjustment is not applied twice.'};
      const result=M.mergeInventories(base,local,remoteState);
      if(!result.state)return {status:'conflict',local:snapshot.state,remote:{state:remoteState,revision:cloud.revision},conflicts:result.conflicts,structural:result.structural};
      next=result.state;
    }
    let accepted={state:remoteState,revision:cloud.revision};
    if(!M.sameInventory(next,remoteState)) {
      const id=C.uid();await S.saveSyncAttempt(db,snapshot.state.revision,{id,local,merged:next,expectedRemoteRevision:cloud.revision});
      check();
      try{accepted=await remote.push(cloud.revision,{...next,revision:0,lastBackupAt:null},id);}
      catch(error){if(error.notApplied)await S.clearSyncAttempt(db,id);throw error;}
      check();
      if(!accepted){await S.clearSyncAttempt(db,id);if(decision)throw new Error('Another device saved during this review. Review the latest copies.');continue;}
    }
    const changed=!!snapshot.attempt||!M.sameInventory(snapshot.state,next)||snapshot.meta.remoteRevision!==accepted.revision;
    check();
    const state=changed?await S.commitInventory(db,snapshot.state.revision,next,[],false,{base:next,remoteRevision:accepted.revision,checkedAt:new Date().toISOString()}):snapshot.state;
    return {status:'synced',state,changed,checkedAt:new Date().toISOString()};
  }
  throw new Error('Another device is saving right now. Your changes are safe here; try syncing again shortly.');
}
