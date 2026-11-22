import * as C from './core.js';
export function openDatabase(name='parts-pocket-v1') {
  return new Promise((resolve,reject)=> {
    if(!globalThis.indexedDB) {reject(new Error('This browser cannot save an inventory. Open this app in Safari, Chrome or Edge.'));return;}
    const req=indexedDB.open(name,2);
    req.onupgradeneeded=()=> {const db=req.result;if(!db.objectStoreNames.contains('inventory'))db.createObjectStore('inventory');if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos',{keyPath:'id'});if(!db.objectStoreNames.contains('sync'))db.createObjectStore('sync');};
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(new Error('Close other copies of Parts Pocket, then try again.'));
    req.onsuccess=()=> {req.result.onversionchange=()=>req.result.close();resolve(req.result);};
  });
}
export function readInventory(db) {
  return new Promise((resolve,reject)=> {
    const tx=db.transaction('inventory','readonly'),req=tx.objectStore('inventory').get('state');let state;
    req.onsuccess=()=> {try {state=req.result===undefined?C.emptyState():C.validateState(req.result);} catch(error) {reject(error);}};
    tx.oncomplete=()=>resolve(state);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Could not read inventory.'));
  });
}
export function readPhoto(db,id) {
  return new Promise((resolve,reject)=> {
    const req=db.transaction('photos','readonly').objectStore('photos').get(id);
    req.onsuccess=()=>resolve(req.result?.blob??null);req.onerror=()=>reject(req.error);
  });
}
export function commitInventory(db,expectedRevision,next,additions=[],replaceAllPhotos=false,syncMeta=null) {
  const checked=C.validateState(next),needed=C.referencedPhotos(checked);
  if(syncMeta){syncMeta={...syncMeta,base:C.validateState(syncMeta.base)};if(!Number.isSafeInteger(syncMeta.remoteRevision)||syncMeta.remoteRevision<0)throw new Error('Invalid cloud revision.');}
  for(const p of additions) if(!(p.blob instanceof Blob)||!/^image\/(jpeg|png|webp)$/.test(p.blob.type)||p.blob.size>3000000) throw new Error('Unsupported photo. Choose a smaller JPEG, PNG or WebP image.');
  return new Promise((resolve,reject)=> {
    const tx=db.transaction(['inventory','photos','sync'],'readwrite'),inventory=tx.objectStore('inventory'),photos=tx.objectStore('photos');
    let failure=null,saved;
    function abort(error) {failure=error;tx.abort();}
    const get=inventory.get('state');
    get.onsuccess=()=> {
      try {
        const current=get.result===undefined?C.emptyState():C.validateState(get.result);
        if(current.revision!==expectedRevision) {abort(new Error('Inventory changed in another window. Close this form and try again to use the latest version.'));return;}
        const keys=photos.getAllKeys();
        keys.onsuccess=()=> {
          try {
            const available=new Set(replaceAllPhotos?[]:keys.result);
            additions.forEach(p=>available.add(p.id));
            for(const id of needed) if(!available.has(id)) {abort(new Error('A photo could not be saved. Please add it again.'));return;}
            if(replaceAllPhotos) photos.clear();
            else for(const id of keys.result) if(!needed.has(id)) photos.delete(id);
            for(const p of additions) if(needed.has(p.id)) photos.put({id:p.id,blob:p.blob});
            saved={...checked,revision:current.revision+1};inventory.put(saved,'state');
            if(syncMeta){tx.objectStore('sync').put(syncMeta,'meta');tx.objectStore('sync').delete('attempt');}
          } catch(error) {abort(error);}
        };
      } catch(error) {abort(error);}
    };
    tx.oncomplete=()=>resolve(saved);
    tx.onabort=()=>reject(failure||tx.error||new Error('Save failed. Your previous inventory is unchanged.'));
    tx.onerror=()=> {failure=failure||tx.error;};
  });
}
export function readSyncSnapshot(db) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['inventory','sync'],'readonly'),s=tx.objectStore('inventory').get('state'),m=tx.objectStore('sync').get('meta'),a=tx.objectStore('sync').get('attempt');
    tx.oncomplete=()=>{try{resolve({state:C.validateState(s.result??C.emptyState()),meta:m.result??{base:C.emptyState(),remoteRevision:0,checkedAt:null},attempt:a.result??null});}catch(error){reject(error);}};
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Could not read sync information.'));
  });
}
export function saveSyncAttempt(db,expectedRevision,attempt) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['inventory','sync'],'readwrite'),req=tx.objectStore('inventory').get('state');let failure;
    req.onsuccess=()=>{if((req.result?.revision??0)!==expectedRevision){failure=new Error('Inventory changed while syncing. Your new edits are safe; sync again.');tx.abort();return;}tx.objectStore('sync').put(attempt,'attempt');};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(failure||tx.error);
  });
}
export function clearSyncAttempt(db,id){
  return new Promise((resolve,reject)=>{const tx=db.transaction('sync','readwrite'),store=tx.objectStore('sync'),req=store.get('attempt');req.onsuccess=()=>{if(req.result?.id===id)store.delete('attempt');};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
export function saveRecovery(db,expectedRevision,remoteState=null) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['inventory','photos','sync'],'readwrite'),s=tx.objectStore('inventory').get('state'),p=tx.objectStore('photos').getAll();let failure;
    p.onsuccess=()=>{const state=s.result??C.emptyState();if(state.revision!==expectedRevision){failure=new Error('Inventory changed. Reopen the sync review.');tx.abort();return;}tx.objectStore('sync').put({state,photos:p.result,at:new Date().toISOString()},'recovery');if(remoteState)tx.objectStore('sync').put({state:remoteState,photos:[],at:new Date().toISOString()},'cloudRecovery');};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(failure||tx.error);
  });
}
export async function exportRecovery(db,source='local') {
  const snapshot=await new Promise((resolve,reject)=>{const req=db.transaction('sync','readonly').objectStore('sync').get(source==='remote'?'cloudRecovery':'recovery');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  if(!snapshot)throw new Error('No recovery copy is available yet.');
  return snapshotToBackup(snapshot);
}
async function blobToData(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=16384) binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return 'data:'+blob.type+';base64,'+btoa(binary);
}
export async function exportInventory(db) {
  // One readonly transaction gives a consistent metadata + photo snapshot.
  const snapshot=await new Promise((resolve,reject)=> {
    const tx=db.transaction(['inventory','photos'],'readonly');
    const s=tx.objectStore('inventory').get('state'),p=tx.objectStore('photos').getAll();
    tx.oncomplete=()=>resolve({state:s.result===undefined?C.emptyState():s.result,photos:p.result});
    tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Backup failed.'));
  });
  return snapshotToBackup(snapshot);
}
async function snapshotToBackup(snapshot) {
  const state=C.validateState(snapshot.state),needed=C.referencedPhotos(state),photos=[];
  for(const p of snapshot.photos) if(needed.has(p.id)) photos.push({id:p.id,data:await blobToData(p.blob)});
  return C.validateBackup({format:'parts-pocket',version:1,state,photos});
}
export async function restoreInventory(db,expectedRevision,input) {
  const checked=C.validateBackup(input);
  const additions=checked.photos.map(p=> {
    const [header,body]=p.data.split(','),binary=atob(body),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    return {id:p.id,blob:new Blob([bytes],{type:header.slice(5).split(';')[0]})};
  });
  // A valid header is not enough: decode every image before opening a write
  // transaction. Node integration tests check signatures; browsers also check pixels.
  await validatePhotoBlobs(additions);
  return commitInventory(db,expectedRevision,checked.state,additions,true);
}
export async function validatePhotoBlobs(additions) {
  for(const p of additions) {
    if(!(p.blob instanceof Blob)||!/^image\/(jpeg|png|webp)$/.test(p.blob.type)||p.blob.size>3000000)throw new Error('A photo is invalid or too large.');
    if(typeof createImageBitmap==='function') {
      let image;
      try {image=await createImageBitmap(p.blob);if(!image.width||!image.height)throw new Error();}
      catch {throw new Error('A backup photo could not be opened. Your current inventory is unchanged.');}
      finally {image?.close();}
    } else if(typeof Image!=='undefined') {
      const url=URL.createObjectURL(p.blob);
      try {await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth?resolve():reject(new Error('Invalid photo.'));img.onerror=()=>reject(new Error('A backup photo could not be opened. Your current inventory is unchanged.'));img.src=url;});}
      finally {URL.revokeObjectURL(url);}
    }
  }
}
