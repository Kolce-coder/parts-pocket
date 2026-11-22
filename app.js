import * as C from './core.js';
import * as S from './store.js';

const icons={box:'<path d="m3 7 9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7M12 11v10M7.5 5l9 4"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',folder:'<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3V6Z"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',chevron:'<path d="m9 5 7 7-7 7"/>',down:'<path d="m5 9 7 7 7-7"/>',move:'<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>',camera:'<path d="M3 7h4l2-3h6l2 3h4v13H3V7Z"/><circle cx="12" cy="13" r="4"/>',photo:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',backup:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',restore:'<path d="M12 17V5m-4 4 4-4 4 4M4 16v5h16v-5"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',check:'<path d="m5 12 4 4L20 5"/>',trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',phone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'};
function el(tag,attrs={},...children) {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)) {
    if(value===null||value===undefined||value===false) continue;
    if(key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if(key==='class') node.className=value;
    else if(key==='text') node.textContent=value;
    else if(key==='checked'||key==='disabled'||key==='hidden'||key==='required'||key==='multiple') node[key]=!!value;
    else node.setAttribute(key,String(value));
  }
  for(const child of children.flat(Infinity)) if(child!==null&&child!==undefined&&child!==false) node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
function icon(name) {const span=el('span',{'aria-hidden':'true'});span.innerHTML='<svg class="icon" viewBox="0 0 24 24">'+(icons[name]||icons.box)+'</svg>';return span.firstChild;}
function button(label,action,style='',glyph=null) {return el('button',{type:'button',class:'btn '+style,onclick:action},glyph?icon(glyph):null,label);}
function iconButton(label,action,glyph,style='quiet') {const b=button('',action,'icon-only '+style,glyph);b.setAttribute('aria-label',label);b.title=label;return b;}
const app=document.getElementById('app'),toastNode=document.getElementById('toast');
let db,state=C.emptyState(),busy=false,toastTimer,channel,offlineReady=false,offlineFailed=false,globalError='';
const ui={tab:'items',location:null,browse:null,query:'',selecting:false,selected:new Set(),collapsed:new Set(),backup:null};
const photoURLs=new Map();
function toast(message) {clearTimeout(toastTimer);toastNode.textContent=message;toastNode.hidden=false;toastTimer=setTimeout(()=>toastNode.hidden=true,4500);}
function errorMessage(error) {return error?.name==='QuotaExceededError'?'Your device is out of app storage. Save a backup, then free some space and try again. Nothing was changed.':(error?.message||'Something went wrong. Please try again.');}
async function reloadState() {state=await S.readInventory(db);if(ui.location&&!state.locations.some(x=>x.id===ui.location))ui.location=null;if(ui.browse&&!state.locations.some(x=>x.id===ui.browse))ui.browse=null;ui.selected=new Set([...ui.selected].filter(id=>state.items.some(x=>x.id===id)));}
async function save(next,additions=[],expected=state.revision) {
  if(busy) throw new Error('Please wait for the current save to finish.');
  busy=true;
  try {state=await S.commitInventory(db,expected,next,additions);globalError='';channel?.postMessage('changed');render();requestPersistence();return state;}
  catch(error) {try{await reloadState();}catch{} globalError=errorMessage(error);render();throw error;}
  finally{busy=false;}
}
async function simpleSave(operation,message) {try{await save(operation(state));toast(message);}catch(error){toast(errorMessage(error));}}
function requestPersistence() {navigator.storage?.persist?.().catch(()=>{});}
async function photoUrl(id) {
  if(photoURLs.has(id))return photoURLs.get(id);
  const blob=await S.readPhoto(db,id);if(!blob)return null;
  if(!photoURLs.has(id))photoURLs.set(id,URL.createObjectURL(blob));return photoURLs.get(id);
}
function clearPhotoCache() {for(const url of photoURLs.values())URL.revokeObjectURL(url);photoURLs.clear();}
function photo(photos=[],className='',alt='') {
  if(!photos.length)return el('div',{class:'photo photo-placeholder '+className,'aria-hidden':'true'},icon('box'));
  const img=el('img',{class:'photo '+className,alt,loading:'lazy'});
  photoUrl(photos[0]).then(url=>{if(url)img.src=url;else img.alt='Photo unavailable';}).catch(()=>{img.alt='Photo unavailable';});return img;
}
function brand() {return el('div',{class:'brand'},el('div',{class:'brand-mark'},icon('box')),el('span',{},'Parts Pocket'));}
function navigate(tab) {ui.tab=tab;ui.selected.clear();ui.selecting=false;render();window.scrollTo(0,0);}
function chooseLocation(id) {ui.location=id;ui.query='';ui.tab='items';ui.selected.clear();ui.selecting=false;render();window.scrollTo(0,0);}
function navButton(label,tab,glyph,cls='nav-button') {return el('button',{class:cls+(ui.tab===tab?' active':''),type:'button',onclick:()=>label==='All items'?chooseLocation(null):navigate(tab),'aria-current':ui.tab===tab?'page':null},icon(glyph),el('span',{},label));}
function sortedLocations(parent) {return state.locations.filter(x=>x.parentId===parent).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));}
function tree(parent=null) {
  const root=el('ul',{class:'tree'}),groups=new Map();
  for(const loc of state.locations){if(!groups.has(loc.parentId))groups.set(loc.parentId,[]);groups.get(loc.parentId).push(loc);}
  for(const group of groups.values())group.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
  const pending=[{parent,list:root}];
  while(pending.length){
    const {parent,list}=pending.pop();
    for(const loc of groups.get(parent)||[]){
      const hasChildren=groups.has(loc.id),collapsed=ui.collapsed.has(loc.id);
      const toggle=hasChildren?el('button',{class:'tree-toggle','aria-label':(collapsed?'Expand ':'Collapse ')+loc.name,'aria-expanded':!collapsed,onclick:()=>{collapsed?ui.collapsed.delete(loc.id):ui.collapsed.add(loc.id);render();}},icon(collapsed?'chevron':'down')):el('span',{class:'tree-spacer'});
      const child=el('li',{},el('div',{class:'tree-row'},toggle,el('button',{class:'tree-pick'+(ui.location===loc.id?' current':''),onclick:()=>chooseLocation(loc.id),title:C.locationPath(state,loc.id)},loc.name)));list.append(child);
      if(hasChildren&&!collapsed){const sub=el('ul',{class:'tree'});child.append(sub);pending.push({parent:loc.id,list:sub});}
    }
  }
  return root;
}
function render() {
  const needed=C.referencedPhotos(state);for(const [id,url] of photoURLs)if(!needed.has(id)){URL.revokeObjectURL(url);photoURLs.delete(id);}
  const sidebar=el('aside',{class:'sidebar'},brand(),el('nav',{class:'side-nav','aria-label':'Main'},navButton('All items','items','box'),navButton('Locations','locations','folder'),navButton('Backup & help','backup','backup')),
    el('div',{class:'sidebar-locations'},el('div',{class:'row between sidebar-title'},el('span',{class:'eyebrow'},'Your locations'),iconButton('Add location',()=>openLocationEditor(),'plus')),state.locations.length?tree():el('p',{class:'small muted',style:'padding:8px 12px'},'A place for every part. Add your first location to get started.')),
    el('div',{class:'side-foot'},el('div',{class:'row'},icon('shield'),'Saved on this device'),el('div',{style:'margin-top:6px'},offlineReady?'Ready to use offline':'Keep a backup of your inventory.')));
  const main=el('main',{class:'main'},el('div',{class:'mobile-brand'},brand(),el('span',{class:'pill'},'Personal inventory')));
  if(globalError)main.append(el('div',{class:'notice error inline-error',role:'alert'},globalError));
  if(ui.tab==='items')renderItems(main);else if(ui.tab==='locations')renderLocations(main);else renderBackup(main);
  const nav=el('nav',{class:'bottom-nav','aria-label':'Main'},navButton('Items','items','box',''),navButton('Locations','locations','folder',''),navButton('Backup','backup','backup',''));
  app.replaceChildren(sidebar,main,nav);
}
function renderItems(main) {
  const total=state.items.length;
  main.append(el('header',{class:'topbar row between'},el('div',{class:'grow'},el('h1',{},'Your inventory'),el('p',{class:'subtitle'},total?total+' item '+(total===1?'entry':'entries')+' · '+state.locations.length+' locations':'Find your parts. Remember their place.')),button('Add item',()=>openItemEditor(),'primary','plus')));
  const input=el('input',{id:'master-search',class:'search',type:'search',placeholder:'Search parts, tags or locations…',value:ui.query,'aria-label':'Search all items',autocomplete:'off',oninput:()=>{ui.query=input.value;ui.selected.clear();ui.selecting=false;renderResults();}});
  main.append(el('div',{class:'search-wrap'},icon('search'),input),el('p',{class:'search-hint'},'Searches everywhere · matches any word · ignores capitals'),el('div',{id:'results'}));
  queueMicrotask(renderResults);
}
function currentItems() {return C.searchItems(state,ui.query,ui.location);}
function renderResults() {
  const target=document.getElementById('results');if(!target)return;
  const items=currentItems(),loc=state.locations.find(x=>x.id===ui.location);
  const name=ui.query.trim()?'Search results':(loc?loc.name:'All items');
  const scope=el('div',{class:'row between list-heading'},el('div',{class:'grow'},el('h2',{},name),el('div',{class:'counter',style:'margin-top:5px'},items.length+' '+(items.length===1?'entry':'entries')+(ui.query.trim()?' across all locations':loc?' including sublocations':''))),
    items.length?button(ui.selecting?'Done':'Select',()=>{ui.selecting=!ui.selecting;ui.selected.clear();renderResults();},'compact quiet',ui.selecting?'check':null):null);
  const nodes=[scope];
  if(loc&&!ui.query.trim())nodes.push(el('div',{class:'row wrap',style:'margin-bottom:16px'},el('span',{class:'pill blue'},C.locationPath(state,loc.id)),button('All items',()=>chooseLocation(null),'compact quiet'),button('View location',()=>{ui.browse=loc.id;navigate('locations');},'compact quiet','folder')));
  if(ui.selecting&&items.length)nodes.push(el('div',{class:'row between',style:'margin-bottom:12px'},button(ui.selected.size===items.length?'Clear selection':'Select all shown',()=>{ui.selected=ui.selected.size===items.length?new Set():new Set(items.map(x=>x.id));renderResults();},'compact quiet'),el('span',{class:'counter'},ui.selected.size+' selected')));
  if(!items.length)nodes.push(el('div',{class:'empty'},el('div',{class:'empty-illustration'},icon(ui.query?'search':'box')),el('h2',{},ui.query?'No matching parts':loc?'Nothing stored here yet':'Know exactly where it is'),el('p',{},ui.query?'Try another name, a tag, or just one word.':loc?'Add an item to this location, or transfer parts here from another shelf.':'Add a part, give it a location, and take a photo. Next time you need it, just search.'),button(ui.query?'Clear search':'Add your first item',()=>{if(ui.query){ui.query='';render();}else openItemEditor();},'primary',ui.query?null:'plus'),!ui.query?el('div',{class:'example'},el('span',{},'For example:'),el('span',{class:'pill'},'GARAGE / RACK / LEVEL 2')):null));
  else nodes.push(el('div',{class:'item-list'},items.map(item=>itemCard(item))));
  if(ui.selected.size)nodes.push(el('div',{class:'selection-bar'},el('strong',{},ui.selected.size+' selected'),el('div',{class:'row',style:'gap:6px'},button('Clear',()=>{ui.selected.clear();renderResults();},'quiet compact'),button('Transfer',()=>openTransfer([...ui.selected]),'primary','move'))));
  target.replaceChildren(...nodes);
}
function itemCard(item) {
  let select=null;
  if(ui.selecting)select=el('label',{class:'select-label'},el('input',{type:'checkbox',class:'check',checked:ui.selected.has(item.id),'aria-label':'Select '+item.name,onchange:event=>{event.target.checked?ui.selected.add(item.id):ui.selected.delete(item.id);renderResults();}}));
  const card=el('article',{class:'item-card'+(ui.selected.has(item.id)?' selected':'')},select,
    el('button',{class:'item-open',type:'button',onclick:()=>{if(ui.selecting){ui.selected.has(item.id)?ui.selected.delete(item.id):ui.selected.add(item.id);renderResults();}else openItemDetail(item.id);},'aria-label':'View '+item.name},photo(item.photos,'',item.name),el('div',{class:'grow'},el('div',{class:'item-name'},item.name),el('span',{class:'pill'},C.locationPath(state,item.locationId)),item.description?el('p',{class:'item-description'},item.description):null)),
    el('div',{class:'item-actions'},el('div',{class:'quantity','aria-label':'Quantity'},el('button',{type:'button','aria-label':'Reduce quantity of '+item.name,onclick:()=>changeQuantity(item.id,-1)},'−'),el('span',{},item.quantity.toLocaleString()),el('button',{type:'button','aria-label':'Increase quantity of '+item.name,onclick:()=>changeQuantity(item.id,1)},'+')),button('Transfer',()=>openTransfer([item.id]),'quiet compact','move')));
  return card;
}
async function changeQuantity(id,delta) {
  const item=state.items.find(x=>x.id===id);if(!item||busy)return;
  const revision=state.revision;
  if(item.quantity+delta===0) {
    if(!await confirmAction('Remove this item?',item.name+' will reach zero quantity and be deleted from your inventory, including its item photos.','Delete item',true))return;
    if(state.revision!==revision){toast('The inventory changed. Please check the quantity and try again.');return;}
    await simpleSave(s=>C.adjustQuantity(s,id,delta,true),'Item removed');
  } else await simpleSave(s=>C.adjustQuantity(s,id,delta),'Quantity saved');
}
function renderLocations(main) {
  const loc=state.locations.find(x=>x.id===ui.browse),children=sortedLocations(loc?.id??null);
  main.append(el('header',{class:'topbar row between'},el('div',{class:'grow'},el('h1',{},loc?loc.name:'Your locations'),el('p',{class:'subtitle'},loc?'See what is here, or open a sublocation.':'From a whole room to the smallest parts box.')),button('Add location',()=>openLocationEditor(null,loc?.id??null),'primary','plus')));
  const crumbs=el('div',{class:'breadcrumb'},el('button',{onclick:()=>{ui.browse=null;render();}},'All locations'));
  if(loc){let cur=loc,chain=[];while(cur){chain.unshift(cur);cur=state.locations.find(x=>x.id===cur.parentId);}for(const l of chain)crumbs.append(icon('chevron'),el('button',{onclick:()=>{ui.browse=l.id;render();}},l.name));}main.append(crumbs);
  if(loc)main.append(el('div',{class:'location-summary'},loc.photos.length?el('button',{class:'location-photo-button','aria-label':'View location photos',onclick:()=>openGallery(loc.photos,loc.name)},photo(loc.photos,'',loc.name)):photo([]),el('div',{class:'grow'},el('strong',{},C.searchItems(state,'',loc.id).length+' item entries'),el('p',{class:'small muted detail-notes'},loc.description||'Add a photo or notes to recognise this spot.'),button('Edit location',()=>openLocationEditor(loc.id),'compact quiet','edit')),button('View items here',()=>chooseLocation(loc.id),'primary')));
  if(children.length)main.append(el('div',{class:'location-grid'},children.map(l=> {
    const count=C.searchItems(state,'',l.id).length,sub=state.locations.filter(x=>x.parentId===l.id).length;
    return el('article',{class:'location-card'},el('button',{class:'location-photo-button block','aria-label':'Open '+l.name,onclick:()=>{ui.browse=l.id;render();}},photo(l.photos,'location-image',l.name)),el('div',{class:'location-content'},el('button',{class:'location-open',onclick:()=>{ui.browse=l.id;render();}},l.name),el('p',{class:'location-meta'},count+' items'+(sub?' · '+sub+' sublocations':'')),el('div',{class:'row between'},button('View items',()=>chooseLocation(l.id),'quiet compact'),iconButton('Edit '+l.name,()=>openLocationEditor(l.id),'more'))));
  })));
  else if(!loc)main.append(el('div',{class:'empty'},el('div',{class:'empty-illustration'},icon('folder')),el('h2',{},'Start with a place'),el('p',{},'Create GARAGE or BEDROOM, then add a rack, level, drawer or box inside it.'),button('Create a location',()=>openLocationEditor(),'primary','plus')));
  else main.append(el('div',{class:'notice'},'No sublocations yet. Add one here if you want to divide this space into shelves, levels or boxes.'));
}
function renderBackup(main) {
  main.append(el('header',{class:'topbar'},el('h1',{},'Keep it with you'),el('p',{class:'subtitle'},'Your inventory and photos, ready to back up or move.')));
  const exportPanel=el('section',{class:'panel'},icon('backup'),el('h2',{},'Save a backup'),el('p',{},'One file containing every item, location and photo. Save it to Files or iCloud Drive, or move it to another device.'),button('Prepare backup',prepareBackup,'primary','backup'));
  if(state.lastBackupAt)exportPanel.append(el('p',{class:'footer-note'},'Last prepared: '+new Date(state.lastBackupAt).toLocaleString()+'. Remember to save the file.'));
  if(ui.backup) {
    const a=el('a',{class:'btn block backup-download',href:ui.backup.url,download:ui.backup.file.name},icon('backup'),'Download backup file');exportPanel.append(a);
    if(navigator.canShare?.({files:[ui.backup.file]}))exportPanel.append(button('Save / share backup',async()=>{try{await navigator.share({files:[ui.backup.file],title:'Parts Pocket backup'});}catch(error){if(error.name!=='AbortError')toast(errorMessage(error));}},'block backup-download','backup'));
    exportPanel.append(el('p',{class:'footer-note'},'Prepared '+ui.backup.file.name+' · '+(ui.backup.file.size/1048576).toFixed(1)+' MB. This is a snapshot; prepare a new backup after making changes.'));
  }
  const fileInput=el('input',{type:'file',accept:'.json,application/json',class:'file-input','aria-label':'Choose inventory backup',onchange:event=>{const file=event.target.files[0];if(file)importBackup(file);event.target.value='';}});
  const importPanel=el('section',{class:'panel'},icon('restore'),el('h2',{},'Restore or move inventory'),el('p',{},'Choose a Parts Pocket backup from another device or an earlier saved copy. You can review its contents before replacing this inventory.'),fileInput,button('Choose backup file',()=>fileInput.click(),'','restore'));
  main.append(el('div',{class:'backup-grid'},exportPanel,importPanel),el('div',{class:'notice warning',style:'margin-top:20px'},'Your records and photos are stored only on this device. They do not automatically sync. Clearing browser data or removing the app can erase them, so keep a separate backup.'));
  const instructions=el('section',{class:'panel install-panel'},icon('phone'),el('h2',{},'Put it on your iPhone'),el('ol',{},el('li',{},'Open the hosted app address in Safari.'),el('li',{},'Tap Share, then Add to Home Screen.'),el('li',{},'Turn on Open as Web App if shown, then tap Add.'),el('li',{},'Open Parts Pocket from its new icon before adding your inventory.')),el('p',{},'After the first full load, the installed app can work offline. Use the same app icon each time, and restore your backup when moving devices.'),el('div',{class:'notice'},offlineReady?'Offline files are ready on this browser.':location.protocol==='file:'?'This is the portable computer copy. iPhone installation needs the hosted version at a secure web address.':offlineFailed?'Offline setup could not finish. Connect to the internet and reopen the app to try again.':window.isSecureContext?'Preparing offline files. Keep this page open for a moment.':'This preview works online. Offline installation needs the app hosted at a secure HTTPS address.'),el('a',{class:'help-link',href:'https://support.apple.com/guide/iphone/iphea86e5236/ios',target:'_blank',rel:'noopener noreferrer',style:'display:inline-block;margin-top:15px'},'Apple’s home-screen instructions'));
  main.append(instructions,el('p',{class:'footer-note'},'Parts Pocket 1.0 · No account needed · Photos stay on your device'));
}
async function prepareBackup() {
  if(busy)return;busy=true;toast('Preparing your inventory and photos…');
  try {
    const data=await S.exportInventory(db),stamp=new Date().toISOString(),filename='Parts-Pocket-'+stamp.slice(0,10)+'-'+stamp.slice(11,19).replace(/:/g,'')+'.json';
    const file=new File([JSON.stringify({...data,exportedAt:stamp})],filename,{type:'application/json'});
    if(ui.backup)URL.revokeObjectURL(ui.backup.url);ui.backup={file,url:URL.createObjectURL(file)};
    // Timestamp means prepared, never claims that a download completed.
    state=await S.commitInventory(db,data.state.revision,{...data.state,lastBackupAt:stamp});
    channel?.postMessage('changed');render();toast('Backup ready. Download it or save it to Files.');
  } catch(error){toast(errorMessage(error));try{await reloadState();render();}catch{}}
  finally{busy=false;}
}
async function importBackup(file) {
  try {
    toast('Checking backup contents…');
    const backup=C.validateBackup(JSON.parse(await file.text())),revision=state.revision;
    if(!await confirmAction('Restore this backup?',file.name+' contains '+backup.state.items.length+' item entries, '+backup.state.locations.length+' locations and '+backup.photos.length+' photos. This will replace the '+state.items.length+' item entries currently on this device. Save a backup first if you want to keep them.','Replace inventory',true))return;
    if(busy)throw new Error('Please wait for the current save to finish.');busy=true;
    try {state=await S.restoreInventory(db,revision,backup);clearPhotoCache();ui.selected.clear();ui.location=null;ui.browse=null;globalError='';channel?.postMessage('changed');render();toast('Inventory and photos restored');}
    finally{busy=false;}
  }catch(error){toast(error instanceof SyntaxError?'This file is not a valid JSON backup.':errorMessage(error));}
}
function dialog(title) {
  const d=el('dialog',{class:'modal','aria-label':title}),body=el('div',{class:'modal-body'}),foot=el('div',{class:'modal-foot'});
  const close=iconButton('Close',()=>{if(!busy)d.close();},'close');
  d.append(el('div',{class:'modal-head'},el('h2',{},title),close),body,foot);
  d.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();return {d,body,foot,close};
}
function confirmAction(title,message,label,danger=false) {
  return new Promise(resolve=> {const m=dialog(title);let confirmed=false;m.body.append(el('p',{style:'margin-bottom:0'},message));m.foot.append(button('Cancel',()=>m.d.close()),button(label,()=>{confirmed=true;m.d.close();},danger?'danger':'primary'));m.d.addEventListener('close',()=>resolve(confirmed),{once:true});});
}
function field(label,input,help='') {const id='field-'+C.uid();input.id=id;return el('div',{class:'field'},el('label',{for:id},label),input,help?el('small',{},help):null);}
function textInput(value='',placeholder='',maxLength=160) {return el('input',{type:'text',value,placeholder,maxlength:maxLength});}
function textArea(value='',placeholder='') {const t=el('textarea',{placeholder,maxlength:2000});t.value=value;return t;}
function locationOptions(select,includeRoot=false) {
  if(includeRoot)select.append(el('option',{value:''},'Top level (no parent)'));
  for(const l of [...state.locations].sort((a,b)=>C.locationPath(state,a.id).localeCompare(C.locationPath(state,b.id),undefined,{numeric:true})))select.append(el('option',{value:l.id},C.locationPath(state,l.id)));
}
function destinationWidget(initial,baseState) {
  const select=el('select',{'aria-label':'Location',required:true});select.append(el('option',{value:''},'Choose a location…'));locationOptions(select);select.append(el('option',{value:'__new'},'+ Create a new location'));
  select.value=initial||(state.locations.length?'':'__new');
  const parent=el('select',{'aria-label':'Create inside'});locationOptions(parent,true);parent.value=ui.location||'';
  const path=textInput('','e.g. RACK / LEVEL 4',500),newFields=el('div',{},field('Create inside',parent),field('New location or path',path,'Use / to create sublocations, for example RACK / LEVEL 4.'));
  function changed(){newFields.hidden=select.value!=='__new';path.required=select.value==='__new';}select.addEventListener('change',changed);changed();
  return {node:el('div',{},field('Location',select),newFields),value:()=>select.value==='__new'?C.createPath(baseState,parent.value||null,path.value):{state:baseState,id:select.value}};
}
async function compressPhoto(file) {
  if(file.size>30*1024*1024)throw new Error('Choose a photo smaller than 30 MB.');
  const url=URL.createObjectURL(file),img=new Image();
  try {
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('This photo could not be opened. Try a JPEG or take a new photo.'));img.src=url;});
    const scale=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));
    if(!blob||blob.size>3000000)throw new Error('This photo could not be resized. Try a smaller image.');return blob;
  }finally{URL.revokeObjectURL(url);}
}
function photoEditor(ids,onWorking) {
  let photos=[...ids],working=false;const additions=new Map(),previewUrls=new Map(),strip=el('div',{class:'photo-strip'}),error=el('div',{class:'notice error form-error',role:'alert',hidden:true});
  const update=()=> {strip.replaceChildren(...photos.map(id=> {
    const img=el('img',{class:'photo',alt:'Attached photo'});if(previewUrls.has(id))img.src=previewUrls.get(id);else photoUrl(id).then(url=>{if(url)img.src=url;}).catch(()=>{});
    return el('div',{class:'photo-editor-tile'},img,el('button',{type:'button',class:'photo-remove','aria-label':'Remove photo',onclick:()=>{if(working)return;photos=photos.filter(x=>x!==id);update();}},'×'));
  }));};
  async function add(event) {
    const files=[...event.target.files];event.target.value='';if(!files.length||working)return;
    if(files.length+photos.length>C.PHOTO_LIMIT){error.textContent='You can add up to six photos. Remove one first.';error.hidden=false;return;}
    working=true;onWorking(true);cameraButton.disabled=true;libraryButton.disabled=true;error.hidden=true;
    try {for(const f of files){const blob=await compressPhoto(f),id=C.uid();additions.set(id,{id,blob});previewUrls.set(id,URL.createObjectURL(blob));photos.push(id);}update();}
    catch(err){error.textContent=errorMessage(err);error.hidden=false;update();}
    finally{working=false;onWorking(false);cameraButton.disabled=false;libraryButton.disabled=false;}
  }
  const camera=el('input',{type:'file',accept:'image/*',capture:'environment',class:'file-input','aria-label':'Take a photo',onchange:add});
  const library=el('input',{type:'file',accept:'image/*',multiple:true,class:'file-input','aria-label':'Choose photos',onchange:add});
  const cameraButton=button('Take photo',()=>camera.click(),'','camera'),libraryButton=button('Choose photos',()=>library.click(),'','photo');
  update();return {node:el('div',{class:'field'},el('div',{class:'field-title'},'Photos'),strip,el('div',{class:'photo-buttons'},cameraButton,libraryButton),camera,library,error,el('small',{},'Up to 6 photos. Resized and saved on this device.')),value:()=>({photos:[...photos],additions:[...additions.values()].filter(x=>photos.includes(x.id))}),isWorking:()=>working,dispose:()=>{for(const u of previewUrls.values())URL.revokeObjectURL(u);}};
}
function editorForm(m,saveLabel,onSubmit) {
  const form=el('form',{}),error=el('div',{class:'notice error form-error',role:'alert',hidden:true});
  const submit=el('button',{type:'submit',class:'btn primary',form:'form-'+C.uid()},saveLabel);form.id=submit.getAttribute('form');
  m.body.append(form);form.append(error);m.foot.append(button('Cancel',()=>m.d.close()),submit);
  form.addEventListener('submit',async event=> {
    event.preventDefault();if(submit.disabled)return;submit.disabled=true;error.hidden=true;
    try {await onSubmit();m.d.close();}catch(err){error.textContent=errorMessage(err);error.hidden=false;error.scrollIntoView({block:'nearest'});}finally{submit.disabled=false;}
  });return {form,submit,error};
}
function openItemEditor(id=null) {
  const base=state,revision=state.revision,item=base.items.find(x=>x.id===id),m=dialog(item?'Edit item':'Add an item');
  const name=textInput(item?.name??'','e.g. Valve cover Cleveland black');name.required=true;
  const quantity=el('input',{type:'number',inputmode:'numeric',min:item?0:1,max:Number.MAX_SAFE_INTEGER,step:1,value:item?.quantity??1,required:true});
  const aliases=textInput(item?.aliases??'','e.g. rocker cover, 351C, engine',500),description=textArea(item?.description??'','e.g. At the back right side of the rack');
  const dest=destinationWidget(item?.locationId??ui.location,base);let pics;
  const edit=editorForm(m,item?'Save changes':'Save item',async()=> {
    if(pics.isWorking())throw new Error('Please wait for the photos to finish.');
    const qty=Number(quantity.value);
    if(item&&qty===0){if(!await confirmAction('Remove this item?',item.name+' has zero quantity. Saving will delete the item and its photos.','Delete item',true))throw new Error('Deletion cancelled. Use a quantity of 1 or more to keep the item.');await save(C.adjustQuantity(base,id,-item.quantity,true),[],revision);toast('Item removed');return;}
    const target=dest.value(),p=pics.value();
    await save(C.saveItem(target.state,{id:id||C.uid(),name:name.value,quantity:qty,locationId:target.id,aliases:aliases.value,description:description.value,photos:p.photos}),p.additions,revision);toast(item?'Item updated':'Item added');
  });
  pics=photoEditor(item?.photos??[],working=>edit.submit.disabled=working);
  edit.form.append(field('Item name',name),el('div',{class:'field-grid'},field('Other names / search tags',aliases,'Anything you might call this part.'),field('Quantity',quantity)),dest.node,field('Where exactly?',description),pics.node);
  m.d.addEventListener('close',()=>pics.dispose(),{once:true});
}
function openLocationEditor(id=null,parentId=ui.browse) {
  const base=state,revision=state.revision,loc=state.locations.find(x=>x.id===id),m=dialog(loc?'Edit location':'Add a location');
  const name=textInput(loc?.name??'',loc?'Location name':'e.g. GARAGE or RACK / LEVEL 2',loc?120:500);name.required=true;
  const parent=el('select',{});locationOptions(parent,true);parent.value=loc?.parentId??parentId??'';parent.disabled=!!loc;
  const notes=textArea(loc?.description??'','e.g. The tall rack next to the garage door');let pics;
  const edit=editorForm(m,loc?'Save location':'Create location',async()=> {
    if(pics.isWorking())throw new Error('Please wait for the photos to finish.');
    const target=loc?{state:base,id:loc.id}:C.createPath(base,parent.value||null,name.value);
    if(!loc&&base.locations.some(x=>x.id===target.id))throw new Error('That location already exists. Open it to edit its notes or photos.');
    const p=pics.value(),record=target.state.locations.find(x=>x.id===target.id);
    await save(C.saveLocation(target.state,{...record,name:loc?name.value:record.name,description:notes.value,photos:p.photos}),p.additions,revision);toast(loc?'Location updated':'Location created');
  });
  pics=photoEditor(loc?.photos??[],working=>edit.submit.disabled=working);
  edit.form.append(field('Inside',parent),field(loc?'Location name':'Location name or path',name,loc?'':'Use / to make several levels at once.'),field('Location notes',notes),pics.node);
  if(loc)edit.form.append(button('Delete empty location',async()=> {
    try {const next=C.removeLocation(base,id);if(await confirmAction('Delete location?',C.locationPath(base,id)+' will be removed.','Delete location',true)){await save(next,[],revision);m.d.close();toast('Location deleted');}}
    catch(error){edit.error.textContent=errorMessage(error);edit.error.hidden=false;}
  },'danger','trash'));
  m.d.addEventListener('close',()=>pics.dispose(),{once:true});
}
function openTransfer(ids) {
  const base=state,revision=state.revision,items=base.items.filter(x=>ids.includes(x.id));if(!items.length)return;
  const m=dialog(items.length===1?'Transfer item':'Transfer '+items.length+' items'),dest=destinationWidget(null,base);
  const replace=el('input',{type:'checkbox',class:'check'}),description=textArea('','e.g. Front left, in the blue box');description.disabled=true;replace.addEventListener('change',()=>description.disabled=!replace.checked);
  const edit=editorForm(m,'Transfer '+items.length+(items.length===1?' item':' items'),async()=> {
    const target=dest.value(),next=C.transferItems(target.state,ids,target.id,{replaceDescription:replace.checked,description:description.value});
    ui.selected.clear();ui.selecting=false;await save(next,[],revision);toast(items.length+(items.length===1?' item transferred':' items transferred'));
  });
  edit.form.append(el('p',{class:'small muted'},'Move the full quantity of each selected item.'),el('div',{class:'transfer-list'},items.map(x=>el('div',{},x.name+' · Qty '+x.quantity))),dest.node,el('label',{class:'check-row'},replace,el('span',{},'Set new placement notes for all selected items')),field('New placement notes',description,'Leave the box unticked to keep each item’s existing notes.'));
}
function openGallery(ids,title) {
  const m=dialog(title);m.body.append(gallery(ids,title));m.foot.append(button('Done',()=>m.d.close(),'primary'));
}
function gallery(ids,title) {
  const g=el('div',{class:'detail-gallery'});for(const id of ids){const img=el('img',{alt:title,loading:'lazy'});photoUrl(id).then(url=>{if(url)img.src=url;}).catch(()=>{});g.append(img);}return g;
}
function openItemDetail(id) {
  const item=state.items.find(x=>x.id===id);if(!item)return;const m=dialog(item.name),loc=state.locations.find(x=>x.id===item.locationId);
  if(item.photos.length)m.body.append(gallery(item.photos,item.name));
  m.body.append(el('span',{class:'pill blue'},'Quantity: '+item.quantity),el('div',{class:'detail-label'},'LOCATION'),el('strong',{class:'detail-notes'},C.locationPath(state,item.locationId)));
  if(item.description)m.body.append(el('div',{class:'detail-label'},'WHERE EXACTLY'),el('p',{class:'detail-notes'},item.description));
  if(item.aliases)m.body.append(el('div',{class:'detail-label'},'OTHER NAMES / TAGS'),el('p',{class:'small detail-notes muted'},item.aliases));
  if(loc)m.body.append(button('View location'+(loc.photos.length?' & photos':''),()=>{m.d.close();ui.browse=loc.id;navigate('locations');},'block','folder'));
  m.foot.append(button('Transfer',()=>{m.d.close();openTransfer([id]);},'','move'),button('Edit item',()=>{m.d.close();openItemEditor(id);},'primary','edit'));
}
async function start() {
  try {
    db=await S.openDatabase();await reloadState();render();
    if('BroadcastChannel' in window){channel=new BroadcastChannel('parts-pocket-changes');channel.onmessage=async()=>{if(document.querySelector('dialog[open]')){toast('Inventory changed in another window. Reopen this form before saving.');return;}try{await reloadState();render();}catch(error){toast(errorMessage(error));}};}
    document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&!busy&&!document.querySelector('dialog[open]'))try{await reloadState();render();}catch(error){toast(errorMessage(error));}});
    if('serviceWorker' in navigator&&location.protocol!=='file:'&&window.isSecureContext) {
      navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;render();}).catch(()=>{offlineReady=false;offlineFailed=true;render();});
    }
  }catch(error) {app.replaceChildren(el('main',{class:'loading'},brand(),el('h1',{style:'margin-top:30px'},'Your inventory could not be opened'),el('p',{},errorMessage(error)),el('p',{},'Try reopening the app in Safari, Chrome or Edge. Existing data has not been replaced.'),button('Try again',()=>location.reload(),'primary')));}
}
start();
