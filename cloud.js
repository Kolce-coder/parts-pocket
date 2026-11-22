import * as C from './core.js';
import * as M from './merge.js';
import {CLOUD_CONFIG} from './cloud-config.js';

export const CONNECTION_KEY='parts-pocket-github-connection-v1';
export function encodeData(value){const bytes=new TextEncoder().encode(JSON.stringify(value));let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text);}
export function decodeData(value){const bytes=Uint8Array.from(atob(value.replace(/\s/g,'')),x=>x.charCodeAt(0));return JSON.parse(new TextDecoder().decode(bytes));}
export function checkEnvelope(value){
  if(value?.format!=='parts-pocket-sync'||value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.receipts)||value.receipts.length>256||value.receipts.some(x=>typeof x!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(x)))throw new Error('The private inventory file is not a supported Parts Pocket file.');
  return {format:'parts-pocket-sync',version:1,revision:value.revision,state:M.textInventory(C.validateState(value.state)),receipts:[...value.receipts]};
}
export function createGitHubRemote({owner,repo,token},fetcher=fetch) {
  if(!/^[a-zA-Z0-9-]+$/.test(owner)||!/[a-zA-Z0-9]/.test(repo)||!/^[a-zA-Z0-9_.-]+$/.test(repo))throw new Error('Invalid inventory repository.');
  const root='https://api.github.com/repos/'+owner+'/'+repo;let cached=null;
  async function request(url,options={}){
    // The key is sent only to GitHub's API, never to file download URLs or another service.
    if(!url.startsWith('https://api.github.com/'))throw new Error('Invalid sync destination.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{return await fetcher(url,{...options,signal:controller.signal,cache:'no-store',redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,...options.headers}});}
    catch(error){if(error.name==='AbortError')throw new Error('GitHub took too long to respond. Try again when connected.');throw error;}
    finally{clearTimeout(timer);}
  }
  async function fail(response){
    if(response.status===401)throw new Error('Your GitHub access key has expired or is invalid. Reconnect with a new key.');
    if(response.status===403||response.status===429){if(response.headers.get('x-ratelimit-remaining')==='0'||response.headers.get('retry-after'))throw new Error('GitHub has asked us to wait. Your changes are saved here; try again later.');throw new Error('This key needs Contents read and write access to your private inventory repository.');}
    if(response.status===404)throw new Error('The private inventory repository could not be found, or this key cannot access it.');
    throw new Error('GitHub could not save or read the inventory (status '+response.status+').');
  }
  async function verify(){const response=await request(root);if(!response.ok)await fail(response);const data=await response.json();if(data.private!==true)throw new Error('Inventory sync requires a private repository.');return data;}
  return {
    verify,
    async pull(){
      const response=await request(root+'/contents/inventory.json',cached?.etag?{headers:{'If-None-Match':cached.etag}}:{});
      if(response.status===304&&cached)return {...cached.value.stateEnvelope};
      if(response.status===404){await verify();cached={sha:null,etag:null,value:{stateEnvelope:{state:C.emptyState(),revision:0,receipts:[]}}};return cached.value.stateEnvelope;}
      if(!response.ok)await fail(response);
      const file=await response.json();if(file.type!=='file'||typeof file.sha!=='string')throw new Error('Expected a single private inventory file.');
      let value;
      if(file.encoding==='base64')value=decodeData(file.content);
      else {
        const blob=await request(root+'/git/blobs/'+file.sha);if(!blob.ok)await fail(blob);const data=await blob.json();value=decodeData(data.content);
      }
      const checked=checkEnvelope(value),stateEnvelope={state:checked.state,revision:checked.revision,receipts:checked.receipts,writeId:checked.receipts.at(-1)};
      cached={sha:file.sha,etag:response.headers.get('etag'),value:{stateEnvelope}};return stateEnvelope;
    },
    async push(expectedRevision,state,writeId){
      if(!cached||cached.value.stateEnvelope.revision!==expectedRevision)return null;
      let dispatched=false;
      try{
      await verify();
      const next=checkEnvelope({format:'parts-pocket-sync',version:1,revision:expectedRevision+1,state:M.textInventory(state),receipts:[...cached.value.stateEnvelope.receipts,writeId].slice(-256)});
      const content=encodeData(next);if(content.length>14000000)throw new Error('This inventory is too large to sync as one file. Export a backup.');
      const body={message:'Update inventory',content,...(cached.sha?{sha:cached.sha}:{})};
      dispatched=true;const response=await request(root+'/contents/inventory.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(response.status===409||response.status===422){cached=null;return null;}
      if(!response.ok){if([400,401,403,404,413,415,429].includes(response.status))dispatched=false;await fail(response);}
      const result=await response.json();if(!result.content?.sha)throw new Error('The save response was incomplete. Sync again to confirm it.');
      const stateEnvelope={state:next.state,revision:next.revision,receipts:next.receipts,writeId};cached={sha:result.content.sha,etag:null,value:{stateEnvelope}};return stateEnvelope;
      }catch(error){if(!dispatched)error.notApplied=true;throw error;}
    }
  };
}
export function createCloud(config=CLOUD_CONFIG,storage=localStorage) {
  let connection=null,remote=null;
  function reload(){connection=null;remote=null;try{const saved=JSON.parse(storage.getItem(CONNECTION_KEY)||'null');if(saved&&saved.owner===config.owner&&saved.repo===config.repo&&typeof saved.token==='string'&&saved.token.length>20){connection=saved;remote=createGitHubRemote(saved);}}catch{}return account();}
  function account(){return connection?{id:connection.owner+'/'+connection.repo,name:connection.owner+' / '+connection.repo}:null;}
  reload();
  return {
    account,reload,repository:config.owner+'/'+config.repo,
    databaseName:id=>'parts-pocket-github-'+id.toLowerCase(),
    forUser(id){if(!connection||id!==account().id)throw new Error('The connected inventory changed.');return remote;},
    async connect(value){const token=value.trim();if(!/^github_pat_[A-Za-z0-9_]+$/.test(token))throw new Error('Paste a fine-grained GitHub access key. It starts with github_pat_.');const next={...config,token};const adapter=createGitHubRemote(next);await adapter.verify();storage.setItem(CONNECTION_KEY,JSON.stringify(next));connection=next;remote=adapter;return account();},
    disconnect(){storage.removeItem(CONNECTION_KEY);connection=null;remote=null;},
  };
}
