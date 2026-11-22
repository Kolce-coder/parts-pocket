import * as C from './core.js';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function textInventory(state) {
  const clean=C.validateState(state);
  return {...clean,items:clean.items.map(x=>({...x,photos:[]})),locations:clean.locations.map(x=>({...x,photos:[]}))};
}
export function sameInventory(a,b) {
  const clean=s=>({locations:[...s.locations].sort((x,y)=>x.id.localeCompare(y.id)),items:[...s.items].sort((x,y)=>x.id.localeCompare(y.id))});
  return equal(clean(a),clean(b));
}
export function mergeInventories(base,local,remote,resolutions={}) {
  [base,local,remote]=[base,local,remote].map(C.validateState);
  const conflicts=[],next={...local};
  for(const kind of ['locations','items']) {
    const [b,l,r]=[base,local,remote].map(s=>new Map(s[kind].map(x=>[x.id,x]))),merged=[];
    for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])) {
      const before=b.get(id),here=l.get(id),there=r.get(id);let result;
      if(before&&here&&there) {
        result={id};
        for(const field of Object.keys(before).filter(x=>x!=='id')) {
          const bothQuantity=field==='quantity'&&here[field]!==before[field]&&there[field]!==before[field];
          const key=kind+':'+id+':'+field;
          if(bothQuantity&&Object.hasOwn(resolutions,key))result[field]=resolutions[key];
          else if(bothQuantity)conflicts.push({kind,id,name:here.name,field,local:here[field],remote:there[field],before:before[field]});
          else if(equal(here[field],there[field])||equal(there[field],before[field]))result[field]=here[field];
          else if(equal(here[field],before[field]))result[field]=there[field];
          else conflicts.push({kind,id,name:here.name,field,local:here[field],remote:there[field]});
        }
      }
      else if(equal(here,there))result=here;
      else if(equal(here,before))result=there;
      else if(equal(there,before))result=here;
      else if(!before||!here||!there)conflicts.push({kind,id,name:(here||there||before).name,field:'record',local:here??null,remote:there??null});
      if(result&&!(kind==='items'&&result.quantity===0&&Object.hasOwn(resolutions,kind+':'+id+':quantity')))merged.push(result);
    }
    next[kind]=merged;
  }
  if(conflicts.length)return {state:null,conflicts,structural:null};
  try{return {state:C.validateState(next),conflicts:[],structural:null};}
  catch(error){return {state:null,conflicts:[],structural:error.message};}
}
