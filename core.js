export const PHOTO_LIMIT = 6;
export function uid() { return 'p' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)); }
export function emptyState() { return {version:1,revision:0,locations:[],items:[],lastBackupAt:null}; }
export function fold(value) { return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function fail(message) { throw new Error(message); }
function textValue(value, label, max, required=false) {
  if(typeof value !== 'string' || value.length>max || (required && !value.trim())) fail(label+' is missing or too long.');
  return value.trim();
}
function validId(id) { if(typeof id!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) fail('Invalid record ID.'); return id; }
function photoIds(photos) {
  if(!Array.isArray(photos)||photos.length>PHOTO_LIMIT||new Set(photos).size!==photos.length) fail('Use up to six different photos.');
  photos.forEach(validId); return [...photos];
}
function normalizeLocation(value) {
  const name=textValue(value.name,'Location name',120,true);
  if(/[\/\\]/.test(name)) fail('Use one location name here. Add sublocations separately.');
  return {id:validId(value.id),name,parentId:value.parentId===null?null:validId(value.parentId),description:textValue(value.description??'','Location notes',2000),photos:photoIds(value.photos??[])};
}
function normalizeItem(value) {
  if(!Number.isSafeInteger(value.quantity)||value.quantity<1) fail('Quantity must be a whole number of at least 1.');
  return {id:validId(value.id),name:textValue(value.name,'Item name',160,true),locationId:validId(value.locationId),quantity:value.quantity,description:textValue(value.description??'','Placement notes',2000),aliases:textValue(value.aliases??'','Other names',500),photos:photoIds(value.photos??[])};
}
export function validateState(value) {
  if(!value || value.version!==1 || !Number.isSafeInteger(value.revision)||value.revision<0 || !Array.isArray(value.locations)||!Array.isArray(value.items)) fail('This is not a supported Parts Pocket inventory.');
  if(value.locations.length>10000||value.items.length>100000) fail('This inventory exceeds the supported record limit.');
  const locations=value.locations.map(normalizeLocation),items=value.items.map(normalizeItem);
  const map=new Map(locations.map(x=>[x.id,x]));
  if(map.size!==locations.length||new Set(items.map(x=>x.id)).size!==items.length) fail('Duplicate record IDs.');
  const siblings=new Set();
  for(const loc of locations) {
    const key=JSON.stringify([loc.parentId,fold(loc.name)]);
    if(siblings.has(key)) fail('Two locations have the same name in the same folder.'); siblings.add(key);
    const seen=new Set([loc.id]); let parent=loc.parentId;
    while(parent!==null) {
      if(seen.has(parent)) fail('Location cycle detected.');
      seen.add(parent);
      if(!map.has(parent)) fail('A parent location is missing.'); parent=map.get(parent).parentId;
    }
  }
  for(const item of items) if(!map.has(item.locationId)) fail('An item points to a missing location.');
  const lastBackupAt=value.lastBackupAt;
  if(lastBackupAt!=null && (typeof lastBackupAt!=='string'||lastBackupAt.length>40||!Number.isFinite(Date.parse(lastBackupAt)))) fail('Invalid backup date.');
  return {version:1,revision:value.revision,locations,items,lastBackupAt:lastBackupAt??null};
}
export function createPath(state,parentId,path) {
  if(parentId!==null&&!state.locations.some(x=>x.id===parentId)) fail('Choose a valid parent location.');
  const names=String(path).split('/').map(x=>x.trim()).filter(Boolean);
  if(!names.length) fail('Enter a location name.');
  let next={...state,locations:[...state.locations]},id=parentId;
  for(const name of names) {
    let loc=next.locations.find(x=>x.parentId===id&&fold(x.name)===fold(name));
    if(!loc) { loc=normalizeLocation({id:uid(),name,parentId:id,description:'',photos:[]});next.locations.push(loc); }
    id=loc.id;
  }
  return {state:validateState(next),id};
}
export function saveLocation(state,value) {
  const loc=normalizeLocation(value);
  const locations=state.locations.some(x=>x.id===loc.id)?state.locations.map(x=>x.id===loc.id?loc:x):[...state.locations,loc];
  return validateState({...state,locations});
}
export function saveItem(state,value) {
  const item=normalizeItem({...value,id:value.id||uid()});
  const items=state.items.some(x=>x.id===item.id)?state.items.map(x=>x.id===item.id?item:x):[...state.items,item];
  return validateState({...state,items});
}
export function adjustQuantity(state,id,delta,confirmed=false) {
  const item=state.items.find(x=>x.id===id); if(!item) fail('This item no longer exists.');
  const quantity=item.quantity+delta;
  if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(quantity)||quantity<0) fail('Enter a valid whole quantity.');
  if(quantity===0) {
    if(!confirmed) fail('Please confirm deletion of this item at zero quantity.');
    return {...state,items:state.items.filter(x=>x.id!==id)};
  }
  return saveItem(state,{...item,quantity});
}
export function transferItems(state,ids,destination,options={}) {
  if(!state.locations.some(x=>x.id===destination)) fail('Choose a destination.');
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>!state.items.some(x=>x.id===id))) fail('One of the selected items no longer exists.');
  const selected=new Set(ids), description=options.replaceDescription?textValue(options.description??'','Placement notes',2000):null;
  return validateState({...state,items:state.items.map(x=>selected.has(x.id)?{...x,locationId:destination,description:description===null?x.description:description}:x)});
}
export function removeLocation(state,id) {
  if(!state.locations.some(x=>x.id===id)) fail('This location no longer exists.');
  if(state.locations.some(x=>x.parentId===id)||state.items.some(x=>x.locationId===id)) fail('Move the items and remove the sublocations before deleting this location.');
  return {...state,locations:state.locations.filter(x=>x.id!==id)};
}
export function locationPath(state,id) {
  const map=new Map(state.locations.map(x=>[x.id,x])),parts=[],seen=new Set();
  while(id!==null && map.has(id) && !seen.has(id)) {seen.add(id);const loc=map.get(id);parts.unshift(loc.name);id=loc.parentId;}
  return parts.join(' / ');
}
export function descendantIds(state,id) {
  if(!id) return new Set(state.locations.map(x=>x.id));
  const ids=new Set([id]); let changed=true;
  while(changed) {changed=false;for(const loc of state.locations) if(ids.has(loc.parentId)&&!ids.has(loc.id)) {ids.add(loc.id);changed=true;}}
  return ids;
}
export function searchItems(state,query='',locationId=null) {
  const terms=fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean),scope=descendantIds(state,locationId);
  const results=[];
  for(const item of state.items) {
    if(!terms.length) {if(scope.has(item.locationId)) results.push({item,score:0});continue;}
    let hay=fold([item.name,item.aliases,item.description,locationPath(state,item.locationId)].join(' '));
    if(/\b(valve|rocker)[\s-]+covers?\b/.test(hay)) hay+=' valve rocker cover';
    const score=terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0);
    if(score) results.push({item,score});
  }
  return results.sort((a,b)=>b.score-a.score||a.item.name.localeCompare(b.item.name,undefined,{numeric:true,sensitivity:'base'})).map(x=>x.item);
}
export function referencedPhotos(state) {return new Set([...state.items,...state.locations].flatMap(x=>x.photos));}
export function validateBackup(value) {
  if(!value||value.format!=='parts-pocket'||value.version!==1||!Array.isArray(value.photos)) fail('Choose a Parts Pocket backup file.');
  const state=validateState(value.state),seen=new Set();
  const photos=value.photos.map(p=> {
    validId(p.id); if(seen.has(p.id)) fail('Duplicate photo IDs.');seen.add(p.id);
    if(typeof p.data!=='string'||p.data.length>4000100||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(p.data)) fail('The backup contains an unsupported or invalid photo.');
    const [header,encoded]=p.data.split(',');
    if(encoded.length%4!==0)fail('The backup contains an invalid photo.');
    const bytes=atob(encoded),n=bytes.length;
    const valid=header.includes('image/jpeg')?n>32&&bytes.charCodeAt(0)===255&&bytes.charCodeAt(1)===216&&bytes.charCodeAt(2)===255&&bytes.charCodeAt(n-2)===255&&bytes.charCodeAt(n-1)===217:
      header.includes('image/png')?n>32&&bytes.slice(0,8)==='\x89PNG\r\n\x1a\n'&&bytes.slice(-8)==='IEND\xaeB`\x82':
      n>32&&bytes.slice(0,4)==='RIFF'&&bytes.slice(8,12)==='WEBP';
    if(!valid||n>3000000)fail('The backup contains a damaged photo. Your inventory has not been changed.');
    return {id:p.id,data:p.data};
  });
  const needed=referencedPhotos(state);
  for(const id of needed) if(!seen.has(id)) fail('A photo is missing from this backup.');
  return {format:'parts-pocket',version:1,state,photos:photos.filter(p=>needed.has(p.id))};
}
