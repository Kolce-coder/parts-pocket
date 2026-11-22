import * as C from './core.js';
import * as S from './store.js';
import * as M from './merge.js';
import {syncOnce} from './sync.js';
import {createCloud,CONNECTION_KEY} from './cloud.js';

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
let cloud=null,account=null,accountGeneration=0,accountKey='guest',switchingAccount=false,syncRunning=false,syncAgain=false,syncTimer,syncStatus='local',syncDetail='',syncConflict=null,authNotice='';
const ui={tab:'items',location:null,browse:null,query:'',selecting:false,selected:new Set(),collapsed:new Set(),backup:null};

function toast(message) {clearTimeout(toastTimer);toastNode.textContent=message;toastNode.hidden=false;toastTimer=setTimeout(()=>toastNode.hidden=true,4500);}
function errorMessage(error) {return error?.name==='QuotaExceededError'?'Your device is out of app storage. Save a backup, then free some space and try again. Nothing was changed.':(error?.message||'Something went wrong. Please try again.');}
async function reloadState() {const generation=accountGeneration,readDb=db;const loaded=await S.readInventory(readDb);if(generation!==accountGeneration||readDb!==db)return;state=loaded;if(ui.location&&!state.locations.some(x=>x.id===ui.location))ui.location=null;if(ui.browse&&!state.locations.some(x=>x.id===ui.browse))ui.browse=null;ui.selected=new Set([...ui.selected].filter(id=>state.items.some(x=>x.id===id)));}
async function save(next,additions=[],expected=state.revision,expectedAccount=accountGeneration) {
  if(switchingAccount||expectedAccount!==accountGeneration)throw new Error('The account changed. Reopen this form.');
  if(busy) throw new Error('Please wait for the current save to finish.');
  const generation=accountGeneration,savingDb=db;busy=true;
  try {const saved=await S.commitInventory(savingDb,expected,next,additions);if(generation!==accountGeneration)throw new Error('Account changed while saving. Reopen the inventory.');state=saved;globalError='';channel?.postMessage('changed');scheduleSync();render();requestPersistence();return state;}
  catch(error) {if(generation===accountGeneration){try{await reloadState();}catch{} globalError=errorMessage(error);render();}throw error;}
  finally{if(generation===accountGeneration)busy=false;}
}
async function simpleSave(operation,message) {try{await save(operation(state));toast(message);}catch(error){toast(errorMessage(error));}}
function requestPersistence() {navigator.storage?.persist?.().catch(()=>{});}
function accountContext(){return {db,generation:accountGeneration};}
function checkContext(context){if(context.db!==db||context.generation!==accountGeneration||switchingAccount)throw new Error('The account changed. Please try again in the current account.');}
function brand() {return el('div',{class:'brand'},el('div',{class:'brand-mark'},icon('box')),el('span',{},'Parts Pocket'));}
function themeButton() {
  const dark=document.documentElement.dataset.theme==='dark';
  const control=button(dark?'Light mode':'Dark mode',toggleTheme,'compact theme-toggle');
  control.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
  const symbol=el('span',{'aria-hidden':'true',class:'theme-symbol'},dark?'☀':'☾');control.prepend(symbol);
  return control;
}
function toggleTheme() {
  const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#111b26':'#f4f7f9');
  try{localStorage.setItem('parts-pocket-theme',theme);}catch{}
  for(const control of document.querySelectorAll('.theme-toggle')) {
    const replacement=themeButton();control.replaceChildren(...replacement.childNodes);control.setAttribute('aria-label',replacement.getAttribute('aria-label'));
  }
}
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
  if(switchingAccount){app.replaceChildren(el('main',{class:'loading'},brand(),el('p',{},'Opening your inventory…')));return;}
  const sidebar=el('aside',{class:'sidebar'},brand(),el('nav',{class:'side-nav','aria-label':'Main'},navButton('All items','items','box'),navButton('Locations','locations','folder'),navButton('Sync & backup','backup','backup')),
    el('div',{class:'sidebar-locations'},el('div',{class:'row between sidebar-title'},el('span',{class:'eyebrow'},'Your locations'),iconButton('Add location',()=>openLocationEditor(),'plus')),state.locations.length?tree():el('p',{class:'small muted',style:'padding:8px 12px'},'A place for every part. Add your first location to get started.')),
    el('div',{class:'side-foot'},button(syncLabel(),()=>navigate('backup'),'quiet compact','shield'),el('div',{style:'margin-top:6px'},offlineReady?'Ready to use offline':'Keep a backup of your inventory.')));
  const main=el('main',{class:'main'},el('div',{class:'mobile-brand'},brand(),el('span',{class:'pill'},'Personal inventory')));
  if(globalError)main.append(el('div',{class:'notice error inline-error',role:'alert'},globalError));
  main.append(el('div',{class:'sync-strip'},button(syncLabel(),()=>navigate('backup'),'compact quiet','shield'),themeButton()));
  if(ui.tab==='items')renderItems(main);else if(ui.tab==='locations')renderLocations(main);else renderBackup(main);
  const nav=el('nav',{class:'bottom-nav','aria-label':'Main'},navButton('Items','items','box',''),navButton('Locations','locations','folder',''),navButton('Sync & backup','backup','backup',''));
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
  if(!items.length)nodes.push(el('div',{class:'empty'},el('div',{class:'empty-illustration'},icon(ui.query?'search':'box')),el('h2',{},ui.query?'No matching parts':loc?'Nothing stored here yet':'Know exactly where it is'),el('p',{},ui.query?'Try another name, a tag, or just one word.':loc?'Add an item to this location, or transfer parts here from another shelf.':'Add a part, give it a location, and add a few notes. Next time you need it, just search.'),button(ui.query?'Clear search':'Add your first item',()=>{if(ui.query){ui.query='';render();}else openItemEditor();},'primary',ui.query?null:'plus'),!ui.query?el('div',{class:'example'},el('span',{},'For example:'),el('span',{class:'pill'},'GARAGE / RACK / LEVEL 2')):null));
  else nodes.push(el('div',{class:'item-list'},items.map(item=>itemCard(item))));
  if(ui.selected.size)nodes.push(el('div',{class:'selection-bar'},el('strong',{},ui.selected.size+' selected'),el('div',{class:'row',style:'gap:6px'},button('Clear',()=>{ui.selected.clear();renderResults();},'quiet compact'),button('Transfer',()=>openTransfer([...ui.selected]),'primary','move'))));
  target.replaceChildren(...nodes);
}
function itemCard(item) {
  let select=null;
  if(ui.selecting)select=el('label',{class:'select-label'},el('input',{type:'checkbox',class:'check',checked:ui.selected.has(item.id),'aria-label':'Select '+item.name,onchange:event=>{event.target.checked?ui.selected.add(item.id):ui.selected.delete(item.id);renderResults();}}));
  const card=el('article',{class:'item-card'+(ui.selected.has(item.id)?' selected':'')},select,
    el('button',{class:'item-open',type:'button',onclick:()=>{if(ui.selecting){ui.selected.has(item.id)?ui.selected.delete(item.id):ui.selected.add(item.id);renderResults();}else openItemDetail(item.id);},'aria-label':'View '+item.name},el('div',{class:'grow'},el('div',{class:'item-name'},item.name),el('span',{class:'pill'},C.locationPath(state,item.locationId)),item.description?el('p',{class:'item-description'},item.description):null)),
    el('div',{class:'item-actions'},el('div',{class:'quantity','aria-label':'Quantity'},el('button',{type:'button','aria-label':'Reduce quantity of '+item.name,onclick:()=>changeQuantity(item.id,-1)},'−'),el('span',{},item.quantity.toLocaleString()),el('button',{type:'button','aria-label':'Increase quantity of '+item.name,onclick:()=>changeQuantity(item.id,1)},'+')),button('Transfer',()=>openTransfer([item.id]),'quiet compact','move')));
  return card;
}
async function changeQuantity(id,delta) {
  const item=state.items.find(x=>x.id===id);if(!item||busy)return;
  const revision=state.revision,generation=accountGeneration;
  if(item.quantity+delta===0) {
    if(!await confirmAction('Remove this item?',item.name+' will reach zero quantity and be deleted from your inventory, including its quantity and notes.','Delete item',true))return;
    if(state.revision!==revision||generation!==accountGeneration){toast('The inventory changed. Please check the quantity and try again.');return;}
    await simpleSave(s=>C.adjustQuantity(s,id,delta,true),'Item removed');
  } else await simpleSave(s=>C.adjustQuantity(s,id,delta),'Quantity saved');
}
function renderLocations(main) {
  const loc=state.locations.find(x=>x.id===ui.browse),children=sortedLocations(loc?.id??null);
  main.append(el('header',{class:'topbar row between'},el('div',{class:'grow'},el('h1',{},loc?loc.name:'Your locations'),el('p',{class:'subtitle'},loc?'See what is here, or open a sublocation.':'From a whole room to the smallest parts box.')),button('Add location',()=>openLocationEditor(null,loc?.id??null),'primary','plus')));
  const crumbs=el('div',{class:'breadcrumb'},el('button',{onclick:()=>{ui.browse=null;render();}},'All locations'));
  if(loc){let cur=loc,chain=[];while(cur){chain.unshift(cur);cur=state.locations.find(x=>x.id===cur.parentId);}for(const l of chain)crumbs.append(icon('chevron'),el('button',{onclick:()=>{ui.browse=l.id;render();}},l.name));}main.append(crumbs);
  if(loc)main.append(el('div',{class:'location-summary'},icon('folder'),el('div',{class:'grow'},el('strong',{},C.searchItems(state,'',loc.id).length+' item entries'),el('p',{class:'small muted detail-notes'},loc.description||'Add notes to recognise this spot.'),button('Edit location',()=>openLocationEditor(loc.id),'compact quiet','edit')),button('View items here',()=>chooseLocation(loc.id),'primary')));
  if(children.length)main.append(el('div',{class:'location-grid'},children.map(l=> {
    const count=C.searchItems(state,'',l.id).length,sub=state.locations.filter(x=>x.parentId===l.id).length;
    return el('article',{class:'location-card'},el('div',{class:'location-content'},el('button',{class:'location-open',onclick:()=>{ui.browse=l.id;render();}},icon('folder'),l.name),el('p',{class:'location-meta'},count+' items'+(sub?' · '+sub+' sublocations':'')),l.description?el('p',{class:'small muted detail-notes'},l.description):null,el('div',{class:'row between'},button('View items',()=>chooseLocation(l.id),'quiet compact'),iconButton('Edit '+l.name,()=>openLocationEditor(l.id),'more'))));
  })));
  else if(!loc)main.append(el('div',{class:'empty'},el('div',{class:'empty-illustration'},icon('folder')),el('h2',{},'Start with a place'),el('p',{},'Create GARAGE or BEDROOM, then add a rack, level, drawer or box inside it.'),button('Create a location',()=>openLocationEditor(),'primary','plus')));
  else main.append(el('div',{class:'notice'},'No sublocations yet. Add one here if you want to divide this space into shelves, levels or boxes.'));
}
function renderBackup(main) {
  main.append(el('header',{class:'topbar'},el('h1',{},'Keep it with you'),el('p',{class:'subtitle'},'Your inventory, ready to back up or move.')));
  main.append(accountPanel());
  const exportPanel=el('section',{class:'panel'},icon('backup'),el('h2',{},'Save a backup'),el('p',{},'One file containing every item, location, quantity and note. Save it to Files or iCloud Drive, or move it to another device.'),button('Prepare backup',prepareBackup,'primary','backup'));
  if(state.lastBackupAt)exportPanel.append(el('p',{class:'footer-note'},'Last prepared: '+new Date(state.lastBackupAt).toLocaleString()+'. Remember to save the file.'));
  if(ui.backup) {
    const a=el('a',{class:'btn block backup-download',href:ui.backup.url,download:ui.backup.file.name},icon('backup'),'Download backup file');exportPanel.append(a);
    if(navigator.canShare?.({files:[ui.backup.file]}))exportPanel.append(button('Save / share backup',async()=>{try{await navigator.share({files:[ui.backup.file],title:'Parts Pocket backup'});}catch(error){if(error.name!=='AbortError')toast(errorMessage(error));}},'block backup-download','backup'));
    exportPanel.append(el('p',{class:'footer-note'},'Prepared '+ui.backup.file.name+' · '+(ui.backup.file.size/1048576).toFixed(1)+' MB. This is a snapshot; prepare a new backup after making changes.'));
  }
  const fileInput=el('input',{type:'file',accept:'.json,application/json',class:'file-input','aria-label':'Choose inventory backup',onchange:event=>{const file=event.target.files[0];if(file)importBackup(file);event.target.value='';}});
  const importPanel=el('section',{class:'panel'},icon('restore'),el('h2',{},'Restore or move inventory'),el('p',{},'Choose a Parts Pocket backup from another device or an earlier saved copy. You can review its contents before replacing this inventory.'),fileInput,button('Choose backup file',()=>fileInput.click(),'','restore'));
  main.append(el('div',{class:'backup-grid'},exportPanel,importPanel),el('div',{class:'notice warning',style:'margin-top:20px'},account?'Changes sync when connected. Keep a separate backup too: deleting something also removes it from your other devices.':'This inventory is saved on this device. Connect GitHub sync, or use a backup to move it. Clearing browser data can erase unsynced records.'));
  const instructions=el('section',{class:'panel install-panel'},icon('phone'),el('h2',{},'Put it on your iPhone'),el('ol',{},el('li',{},'Open the hosted app address in Safari.'),el('li',{},'Tap Share, then Add to Home Screen.'),el('li',{},'Turn on Open as Web App if shown, then tap Add.'),el('li',{},'Open Parts Pocket from its new icon before adding your inventory.')),el('p',{},'After the first full load, the installed app can work offline. Use the same app icon each time. Connect to your private inventory on each device, or move it using a backup.'),el('div',{class:'notice'},offlineReady?'Offline files are ready on this browser.':location.protocol==='file:'?'This is the portable computer copy. iPhone installation needs the hosted version at a secure web address.':offlineFailed?'Offline setup could not finish. Connect to the internet and reopen the app to try again.':window.isSecureContext?'Preparing offline files. Keep this page open for a moment.':'This preview works online. Offline installation needs the app hosted at a secure HTTPS address.'),el('a',{class:'help-link',href:'https://support.apple.com/guide/iphone/iphea86e5236/ios',target:'_blank',rel:'noopener noreferrer',style:'display:inline-block;margin-top:15px'},'Apple’s home-screen instructions'));
  main.append(instructions,el('p',{class:'footer-note'},'Parts Pocket 2.0 · Text inventory · Optional private sync'));
}
async function prepareBackup() {
  if(busy||switchingAccount)return;const context=accountContext();busy=true;toast('Preparing your inventory…');
  try {
    const original=await S.readInventory(context.db);checkContext(context);
    const data={format:'parts-pocket',version:1,state:M.textInventory(original),photos:[]},stamp=new Date().toISOString(),filename='Parts-Pocket-'+stamp.slice(0,10)+'-'+stamp.slice(11,19).replace(/:/g,'')+'.json';
    const file=new File([JSON.stringify({...data,exportedAt:stamp})],filename,{type:'application/json'});
    const saved=await S.commitInventory(context.db,original.revision,{...original,lastBackupAt:stamp});checkContext(context);
    if(ui.backup)URL.revokeObjectURL(ui.backup.url);ui.backup={file,url:URL.createObjectURL(file)};
    // Timestamp means prepared, never claims that a download completed.
    state=saved;
    channel?.postMessage('changed');render();toast('Backup ready. Download it or save it to Files.');
  } catch(error){if(context.generation===accountGeneration){toast(errorMessage(error));try{await reloadState();render();}catch{}}}
  finally{if(context.generation===accountGeneration)busy=false;}
}
async function importBackup(file) {
  if(switchingAccount)return;const context=accountContext(),revision=state.revision,count=state.items.length;
  try {
    toast('Checking backup contents…');
    const raw=JSON.parse(await file.text());checkContext(context);if(raw.format!=='parts-pocket'||raw.version!==1)throw new Error('Choose a Parts Pocket backup.');const backup={format:'parts-pocket',version:1,state:M.textInventory(raw.state),photos:[]};
    if(!await confirmAction('Restore this backup?',file.name+' contains '+backup.state.items.length+' item entries, '+backup.state.locations.length+' locations. Photos in older backups are not imported. This replaces the '+count+' item entries currently in this inventory.'+(account?' It will also sync this replacement to your other devices.':'')+' Save a backup first if you want to keep the current copy.','Replace inventory',true))return;
    checkContext(context);
    if(busy)throw new Error('Please wait for the current save to finish.');busy=true;
    try {const saved=await S.restoreInventory(context.db,revision,backup);checkContext(context);state=saved;ui.selected.clear();ui.location=null;ui.browse=null;globalError='';channel?.postMessage('changed');scheduleSync();render();toast('Inventory restored');}
    finally{if(context.generation===accountGeneration)busy=false;}
  }catch(error){if(context.generation===accountGeneration)toast(error instanceof SyntaxError?'This file is not a valid JSON backup.':errorMessage(error));}
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
function editorForm(m,saveLabel,onSubmit) {
  const openedAccount=accountGeneration,openedDb=db;
  const form=el('form',{}),error=el('div',{class:'notice error form-error',role:'alert',hidden:true});
  const submit=el('button',{type:'submit',class:'btn primary',form:'form-'+C.uid()},saveLabel);form.id=submit.getAttribute('form');
  m.body.append(form);form.append(error);m.foot.append(button('Cancel',()=>m.d.close()),submit);
  form.addEventListener('submit',async event=> {
    event.preventDefault();if(submit.disabled)return;submit.disabled=true;error.hidden=true;
    try {if(switchingAccount||openedAccount!==accountGeneration||openedDb!==db)throw new Error('The account changed. Reopen this form.');await onSubmit();m.d.close();}catch(err){error.textContent=errorMessage(err);error.hidden=false;error.scrollIntoView({block:'nearest'});}finally{submit.disabled=false;}
  });return {form,submit,error};
}
function openItemEditor(id=null) {
  if(switchingAccount)return;const generation=accountGeneration,base=state,revision=state.revision,item=base.items.find(x=>x.id===id),m=dialog(item?'Edit item':'Add an item');
  const name=textInput(item?.name??'','e.g. Valve cover Cleveland black');name.required=true;
  const quantity=el('input',{type:'number',inputmode:'numeric',min:item?0:1,max:Number.MAX_SAFE_INTEGER,step:1,value:item?.quantity??1,required:true});
  const aliases=textInput(item?.aliases??'','e.g. rocker cover, 351C, engine',500),description=textArea(item?.description??'','e.g. At the back right side of the rack');
  const dest=destinationWidget(item?.locationId??ui.location,base);
  const edit=editorForm(m,item?'Save changes':'Save item',async()=> {
    const qty=Number(quantity.value);
    if(item&&qty===0){if(!await confirmAction('Remove this item?',item.name+' has zero quantity. Saving will delete the item.','Delete item',true))throw new Error('Deletion cancelled. Use a quantity of 1 or more to keep the item.');await save(C.adjustQuantity(base,id,-item.quantity,true),[],revision,generation);toast('Item removed');return;}
    const target=dest.value();
    await save(C.saveItem(target.state,{id:id||C.uid(),name:name.value,quantity:qty,locationId:target.id,aliases:aliases.value,description:description.value,photos:item?.photos??[]}),[],revision,generation);toast(item?'Item updated':'Item added');
  });
  edit.form.append(field('Item name',name),el('div',{class:'field-grid'},field('Other names / search tags',aliases,'Anything you might call this part.'),field('Quantity',quantity)),dest.node,field('Where exactly?',description));
}
function openLocationEditor(id=null,parentId=ui.browse) {
  if(switchingAccount)return;const generation=accountGeneration,base=state,revision=state.revision,loc=state.locations.find(x=>x.id===id),m=dialog(loc?'Edit location':'Add a location');
  const name=textInput(loc?.name??'',loc?'Location name':'e.g. GARAGE or RACK / LEVEL 2',loc?120:500);name.required=true;
  const parent=el('select',{});locationOptions(parent,true);parent.value=loc?.parentId??parentId??'';parent.disabled=!!loc;
  const notes=textArea(loc?.description??'','e.g. The tall rack next to the garage door');
  const edit=editorForm(m,loc?'Save location':'Create location',async()=> {
    const target=loc?{state:base,id:loc.id}:C.createPath(base,parent.value||null,name.value);
    if(!loc&&base.locations.some(x=>x.id===target.id))throw new Error('That location already exists. Open it to edit its notes.');
    const record=target.state.locations.find(x=>x.id===target.id);
    await save(C.saveLocation(target.state,{...record,name:loc?name.value:record.name,description:notes.value,photos:loc?.photos??[]}),[],revision,generation);toast(loc?'Location updated':'Location created');
  });
  edit.form.append(field('Inside',parent),field(loc?'Location name':'Location name or path',name,loc?'':'Use / to make several levels at once.'),field('Location notes',notes));
  if(loc)edit.form.append(button('Delete empty location',async()=> {
    try {const next=C.removeLocation(base,id);if(await confirmAction('Delete location?',C.locationPath(base,id)+' will be removed.','Delete location',true)){await save(next,[],revision,generation);m.d.close();toast('Location deleted');}}
    catch(error){edit.error.textContent=errorMessage(error);edit.error.hidden=false;}
  },'danger','trash'));
}
function openTransfer(ids) {
  if(switchingAccount)return;const generation=accountGeneration,base=state,revision=state.revision,items=base.items.filter(x=>ids.includes(x.id));if(!items.length)return;
  const m=dialog(items.length===1?'Transfer item':'Transfer '+items.length+' items'),dest=destinationWidget(null,base);
  const replace=el('input',{type:'checkbox',class:'check'}),description=textArea('','e.g. Front left, in the blue box');description.disabled=true;replace.addEventListener('change',()=>description.disabled=!replace.checked);
  const edit=editorForm(m,'Transfer '+items.length+(items.length===1?' item':' items'),async()=> {
    const target=dest.value(),next=C.transferItems(target.state,ids,target.id,{replaceDescription:replace.checked,description:description.value});
    ui.selected.clear();ui.selecting=false;await save(next,[],revision,generation);toast(items.length+(items.length===1?' item transferred':' items transferred'));
  });
  edit.form.append(el('p',{class:'small muted'},'Move the full quantity of each selected item.'),el('div',{class:'transfer-list'},items.map(x=>el('div',{},x.name+' · Qty '+x.quantity))),dest.node,el('label',{class:'check-row'},replace,el('span',{},'Set new placement notes for all selected items')),field('New placement notes',description,'Leave the box unticked to keep each item’s existing notes.'));
}
function openItemDetail(id) {
  const item=state.items.find(x=>x.id===id);if(!item)return;const m=dialog(item.name),loc=state.locations.find(x=>x.id===item.locationId);
  m.body.append(el('span',{class:'pill blue'},'Quantity: '+item.quantity),el('div',{class:'detail-label'},'LOCATION'),el('strong',{class:'detail-notes'},C.locationPath(state,item.locationId)));
  if(item.description)m.body.append(el('div',{class:'detail-label'},'WHERE EXACTLY'),el('p',{class:'detail-notes'},item.description));
  if(item.aliases)m.body.append(el('div',{class:'detail-label'},'OTHER NAMES / TAGS'),el('p',{class:'small detail-notes muted'},item.aliases));
  if(loc)m.body.append(button('View location',()=>{m.d.close();ui.browse=loc.id;navigate('locations');},'block','folder'));
  m.foot.append(button('Transfer',()=>{m.d.close();openTransfer([id]);},'','move'),button('Edit item',()=>{m.d.close();openItemEditor(id);},'primary','edit'));
}
function syncLabel() {
  if(!account)return 'Saved on this device';
  return {syncing:'Syncing…',synced:'Synced across devices',pending:'Saved here · sync pending',offline:'Offline · saved here',conflict:'Sync needs your review',error:'Saved here · sync needs attention',checking:'Checking your inventory…'}[syncStatus]||'Saved on this device';
}
function scheduleSync() {
  if(!account)return;
  syncStatus=navigator.onLine?'pending':'offline';syncDetail='';
  clearTimeout(syncTimer);if(syncRunning){syncAgain=true;return;}
  syncTimer=setTimeout(()=>runSync(),800);
}
async function runSync(decision=null) {
  if(!account||!cloud||switchingAccount)return false;
  if(syncRunning||busy||(!decision&&document.querySelector('dialog[open]'))){syncAgain=true;return false;}
  if(!navigator.onLine){syncStatus='offline';render();return false;}
  const generation=accountGeneration,activeDb=db,user=account;
  syncRunning=true;syncAgain=false;syncStatus='syncing';syncDetail='';render();
  try {
    const result=await syncOnce({db:activeDb,remote:cloud.forUser(user.id),active:()=>generation===accountGeneration,decision});
    if(generation!==accountGeneration)return false;
    if(result.status==='conflict'){syncConflict=result;syncStatus='conflict';syncDetail='Both devices changed the same part of the inventory. Review the copies before syncing.';}
    else {syncConflict=null;await reloadState();syncStatus=M.sameInventory(state,result.state)?'synced':'pending';syncDetail='Last checked '+new Date(result.checkedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});if(result.changed)channel?.postMessage('changed');if(syncStatus==='pending')syncAgain=true;}
    render();return result;
  }catch(error){if(generation===accountGeneration){syncStatus=navigator.onLine?'error':'offline';syncDetail=errorMessage(error)+'. Your saved changes remain on this device.';render();}return false;}
  finally {syncRunning=false;if(syncAgain){syncAgain=false;clearTimeout(syncTimer);syncTimer=setTimeout(()=>runSync(),1200);}}
}
function connectChannel() {
  channel?.close();
  if('BroadcastChannel' in window){channel=new BroadcastChannel('parts-pocket-changes-'+accountKey);channel.onmessage=async()=>{if(document.querySelector('dialog[open]')){toast('Inventory changed in another window. Reopen this form before saving.');return;}try{await reloadState();render();scheduleSync();}catch(error){toast(errorMessage(error));}};}
}
async function switchAccount(user) {
  const key=user?.id??'guest';
  if(key===accountKey){account=user;if(switchingAccount)return;if(user&&syncStatus==='error')scheduleSync();render();return;}
  const generation=++accountGeneration;clearTimeout(syncTimer);syncConflict=null;syncDetail='';syncAgain=false;
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  if(ui.backup)URL.revokeObjectURL(ui.backup.url);ui.backup=null;ui.selected.clear();ui.location=null;ui.browse=null;ui.query='';ui.selecting=false;ui.collapsed.clear();
  busy=true;switchingAccount=true;account=user;accountKey=key;state=C.emptyState();syncStatus=user?'checking':'local';let opened=false;render();
  try {
    const nextDb=await S.openDatabase(user?cloud.databaseName(user.id):'parts-pocket-v1');
    if(generation!==accountGeneration){nextDb.close();return;}
    const nextState=await S.readInventory(nextDb);
    if(generation!==accountGeneration){nextDb.close();return;}
    const oldDb=db;db=nextDb;state=nextState;oldDb?.close();connectChannel();globalError='';opened=true;
  }catch(error){if(generation===accountGeneration)app.replaceChildren(el('main',{class:'loading'},brand(),el('p',{},'Could not open this account: '+errorMessage(error)),button('Try again',()=>location.reload(),'primary')));}
  finally{if(generation===accountGeneration){busy=!opened;switchingAccount=!opened;if(opened)render();}}
  if(user&&opened)scheduleSync();
}
function accountPanel() {
  const panel=el('section',{class:'panel account-panel'},icon('shield'),el('h2',{},'Use it on every device'));
  if(!cloud)panel.append(el('p',{},'This portable copy saves on this device. Open the hosted app address for automatic syncing between your phone and laptop.'));
    else if(!account)panel.append(el('p',{},'Connect this device to your private GitHub inventory. Use the same connection on your iPhone and laptop to share items, locations and quantities.'),button('Connect GitHub sync',()=>openAuth(),'primary'));
  else {
    panel.append(el('p',{class:'account-email'},account.name||'Private inventory connected'),el('strong',{role:'status'},syncLabel()),...(syncDetail?[el('p',{class:'small muted detail-notes'},syncDetail)]:[]),
      el('div',{class:'row wrap',style:'margin-top:16px'},button(syncStatus==='syncing'?'Syncing…':'Sync now',()=>runSync(),'primary'),syncConflict?button('Review changes',openSyncReview,'warning'):null,button('Reconnect',()=>openAuth(),'quiet'),button('Disconnect',signOut,'quiet')));
    if(!state.items.length&&!state.locations.length)panel.append(button('Copy this device’s local inventory into my account',importDeviceInventory,'block compact quiet'));
    const recovery=el('details',{class:'recovery-tools'},el('summary',{},'Recover a copy from the last sync review'),el('p',{class:'small muted'},'The two copies from your last conflict decision are kept on this device. Download one, then restore it if needed.'),button('Download device copy',()=>downloadRecovery('local'),'compact quiet'),button('Download cloud copy',()=>downloadRecovery('remote'),'compact quiet'));panel.append(recovery);
  }
  if(authNotice)panel.append(el('div',{class:'notice',style:'margin-top:16px'},authNotice));
  return panel;
}
function openAuth() {
  const m=dialog('Connect your private inventory'),key=el('input',{type:'password',autocomplete:'off',autocapitalize:'none',spellcheck:'false',required:true,placeholder:'github_pat_…'});
  m.body.append(el('p',{},'This connects to '+cloud.repository+'. The access key stays on this device and is sent only to GitHub.'),el('p',{class:'small muted'},'Connect once on your iPhone and once on your laptop. Keep the key in your password manager; do not send it in chat.'));
  const edit=editorForm(m,'Connect inventory',async()=>{const user=await cloud.connect(key.value);key.value='';authNotice='';await switchAccount(user);scheduleSync();toast('Connected. Checking your inventory…');});
  edit.form.append(field('Private inventory access key',key));
  const keyURL='https://github.com/settings/personal-access-tokens/new?name=Parts+Pocket&description=Sync+my+private+text+inventory&target_name=Kolce-coder&contents=write';
  edit.form.append(el('details',{},el('summary',{},'How to get an access key'),el('ol',{class:'small'},el('li',{},'Create a fine-grained personal access token on GitHub.'),el('li',{},'Choose Only select repositories, then parts-pocket-data.'),el('li',{},'Give Contents read and write access. Leave other permissions off.'),el('li',{},'Generate it, save it in your password manager, and paste it above.')),el('a',{href:keyURL,target:'_blank',rel:'noopener noreferrer',class:'help-link'},'Open GitHub key setup')));
}
async function signOut() {
  if(busy||syncRunning||switchingAccount){toast('Wait for the current save or sync to finish.');return;}
  const context=accountContext();
  try{
    const snap=await S.readSyncSnapshot(context.db);checkContext(context);
    if(!M.sameInventory(snap.state,snap.meta.base)&&!await confirmAction('Disconnect with changes pending?','Some changes have not reached your other devices yet. They remain saved here for the next time you connect.','Disconnect'))return;
    checkContext(context);cloud.disconnect();await switchAccount(null);toast('Disconnected. Showing this device’s separate local inventory.');
  }catch(error){toast(errorMessage(error));}
}
async function importDeviceInventory() {
  if(!account||switchingAccount||state.items.length||state.locations.length)return;const context=accountContext(),revision=state.revision;
  const guest=await S.openDatabase();let data;try{data=M.textInventory(await S.readInventory(guest));}finally{guest.close();}
  try{checkContext(context);}catch{return;}
  if(!data.items.length&&!data.locations.length){toast('There is no separate local inventory to copy.');return;}
  if(await confirmAction('Copy local inventory to your account?',data.items.length+' items and '+data.locations.length+' locations will be added to your private account and synced to your other devices.','Copy & sync'))try{checkContext(context);await save(data,[],revision,context.generation);toast('Copied. Syncing your inventory…');}catch(error){toast(errorMessage(error));}
}
async function downloadRecovery(source) {
  if(switchingAccount)return;const context=accountContext();
  try{const data=await S.exportRecovery(context.db,source);checkContext(context);const text={...data,state:M.textInventory(data.state),photos:[]},file=new File([JSON.stringify(text)],'Parts-Pocket-recovery-'+source+'.json',{type:'application/json'});if(ui.backup)URL.revokeObjectURL(ui.backup.url);ui.backup={file,url:URL.createObjectURL(file)};render();toast('Recovery copy ready. Use Download backup file below.');}catch(error){if(context.generation===accountGeneration)toast(errorMessage(error));}
}
function openSyncReview() {
  const conflict=syncConflict;if(!conflict)return;
  const context=accountContext();
  const m=dialog('Review changes on both devices');
  m.body.append(el('p',{},'Both copies are saved. Choose which complete inventory should be used across your devices. A recovery copy of each will be kept here.'),el('div',{class:'backup-grid'},el('section',{class:'notice'},el('strong',{},'This device'),el('p',{},conflict.local.items.length+' items · '+conflict.local.locations.length+' locations')),el('section',{class:'notice'},el('strong',{},'Cloud / other device'),el('p',{},conflict.remote.state.items.length+' items · '+conflict.remote.state.locations.length+' locations'))));
  if(conflict.structural)m.body.append(el('p',{class:'notice warning'},conflict.structural));
  if(conflict.conflicts.length)m.body.append(el('ul',{class:'conflict-list'},conflict.conflicts.map(c=>el('li',{},el('strong',{},c.name+' — '+(c.field==='record'?'edited or deleted':c.field)),el('p',{class:'small detail-notes'},'This device: '+displayConflict(c.local)+'\nCloud: '+displayConflict(c.remote))))));
  if(!conflict.structural&&conflict.conflicts.length&&conflict.conflicts.every(c=>c.field==='quantity')) {
    const quantities=new Map();
    m.body.append(el('p',{class:'notice'},'Both devices changed the quantity. Even matching numbers may represent two separate adjustments. Enter the actual number remaining below.'));
    const edit=editorForm(m,'Save checked quantities',async()=>{
      checkContext(context);const resolutions=Object.fromEntries([...quantities].map(([key,input])=>[key,Number(input.value)]));
      if(Object.values(resolutions).some(x=>x===0)&&!await confirmAction('Delete zero-quantity items?','Items with an actual quantity of zero will be deleted from the synced inventory.','Delete zero items',true))throw new Error('Deletion cancelled.');
      checkContext(context);const result=await runSync({source:'merge',resolutions,localRevision:conflict.local.revision,remoteRevision:conflict.remote.revision});
      if(!result||result.status!=='synced')throw new Error(syncDetail||'Sync could not finish. Try again.');
    });
    for(const c of conflict.conflicts){const input=el('input',{type:'number',inputmode:'numeric',min:0,max:Number.MAX_SAFE_INTEGER,step:1,required:true});quantities.set(c.kind+':'+c.id+':quantity',input);edit.form.append(field('Actual quantity: '+c.name,input,'Enter 0 only if you want to delete this item.'));}
    return;
  }
  for(const [source,label] of [['local','Use this device’s copy'],['remote','Use cloud copy']])m.foot.append(button(label,async()=>{
    if(!await confirmAction('Use this complete copy?','The '+(source==='local'?'cloud':'device')+' inventory will be replaced with the '+(source==='local'?'device':'cloud')+' copy. The two recovery files will be available in Sync & backup.','Use this copy',true))return;
    try{checkContext(context);}catch{return;}m.d.close();await runSync({source,localRevision:conflict.local.revision,remoteRevision:conflict.remote.revision});
  },source==='remote'?'primary':''));
}
function displayConflict(value){if(value===null)return 'Deleted';if(typeof value==='object')return value.name?value.name+' · quantity '+(value.quantity??'—'):JSON.stringify(value);return String(value);}
async function start() {
  try {
    cloud=location.protocol==='file:'?null:createCloud();account=cloud?.account?.()??null;accountKey=account?.id??'guest';syncStatus=account?(navigator.onLine?'checking':'offline'):'local';
    db=await S.openDatabase(account?cloud.databaseName(account.id):'parts-pocket-v1');await reloadState();render();
    connectChannel();
    document.addEventListener('visibilitychange',async()=>{if(!document.hidden&&!busy&&!document.querySelector('dialog[open]'))try{await reloadState();render();runSync();}catch(error){toast(errorMessage(error));}});
    window.addEventListener('online',()=>runSync());window.addEventListener('offline',()=>{if(account){syncStatus='offline';render();}});
    setInterval(()=>{if(!document.hidden)runSync();},30000);
    window.addEventListener('storage',event=>{if(cloud&&event.key===CONNECTION_KEY){const user=cloud.reload();switchAccount(user).then(()=>{if(user)scheduleSync();});}});
    if(account)scheduleSync();
    if('serviceWorker' in navigator&&location.protocol!=='file:'&&window.isSecureContext) {
      navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;render();}).catch(()=>{offlineReady=false;offlineFailed=true;render();});
    }
  }catch(error) {app.replaceChildren(el('main',{class:'loading'},brand(),el('h1',{style:'margin-top:30px'},'Your inventory could not be opened'),el('p',{},errorMessage(error)),el('p',{},'Try reopening the app in Safari, Chrome or Edge. Existing data has not been replaced.'),button('Try again',()=>location.reload(),'primary')));}
}
start();
