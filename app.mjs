import createModule from './assets/verovio-module.mjs';
import {VerovioToolkit} from './assets/verovio.mjs';
import {makeTimeline,groupAt,noteStep,loopBounds} from './timeline.mjs';
import {PianoAudio} from './audio.mjs';
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
const readRecent=()=>{try{return JSON.parse(localStorage.getItem('v26-recent-scores'))||{}}catch{return{}}};
const state={lang:localStorage.getItem('v26-lang')||'fr',mode:'continuous',playing:false,group:0,base:0,rate:1,loop:null,waitHits:new Set(),systems:[],notesById:new Map(),measuresById:new Map(),catalog:[],token:0,pair:-1,voices:new Set(),veilSetting:localStorage.getItem('v26-veil-color')||'#ec4a7b',veilColor:'#ec4a7b',veilMeasure:null,recent:readRecent()};
const audio=new PianoAudio();let toolkit,raf,loopTimer,waitTimer,loading=false,midiAccess,midiPollTimer=null,midiPollCount=0,midiConnecting=false,midiConnected=false,midiAccessStateHandler=null;
const midiInputBindings=new Map(),handledMidiEvents=new WeakSet();
const translations={
 fr:{open:'Ouvrir',night:'Nuit',day:'Jour',continuous:'Défilement continu',wait:'Attendre la note',play:'▶ Lire',pause:'Ⅱ Pause',start:'⏮ Début',tempo:'Tempo',connect:'Connecter le Casio',connected:'MIDI connecté',keyboard:'Clavier',loop:'Boucle',from:'Début',to:'Fin',enable:'Activer',exit:'Quitter',gap:'Pause',welcome:'Votre partition, en musique.',choose:'Choisissez un MusicXML pour commencer.',loading:'Préparation de la partition…',piano:'Piano virtuel',touch:'Touchez les touches pour jouer',helpTitle:'Un lecteur autonome',helpText:'Ouvrez le MusicXML préparé par votre convertisseur. Le son et le curseur suivent les mêmes notes. Le PDF et le MIDI ne sont pas nécessaires.',helpKeys:'Espace : lecture / pause. ← et → : note précédente / suivante, avec son. ↑ et ↓ : tempo ±5 BPM. Cliquez sur une note pour vous y placer.',helpLoop:'Choisissez les mesures de début et de fin, puis Activez la boucle. Quitter retire la sélection. Les numéros entre parenthèses indiquent un passage répété.',helpLocal:'Les morceaux ouverts sont conservés sur cet appareil. Pour les publier sur GitHub, utilisez ajouter-partition.cmd puis envoyez le dossier complet.',close:'Fermer',measure:'Mesure',system:'Systèmes',ready:'Prêt à jouer',correct:'Correct',wrong:'Note différente',await:'Jouez les notes indiquées',finished:'Morceau terminé',loopPause:'Reprise dans',unsupported:'Web MIDI indisponible dans ce navigateur.',searching:'Recherche du Casio…',noMidi:'Aucun clavier MIDI détecté',denied:'Connexion MIDI refusée',error:'Impossible de lire ce MusicXML',remove:'Retirer ce morceau local ?',local:'local',emptyLibrary:'Ouvrir un MusicXML…'},
 en:{open:'Open',night:'Night',day:'Day',continuous:'Continuous',wait:'Wait for note',play:'▶ Play',pause:'Ⅱ Pause',start:'⏮ Start',tempo:'Tempo',connect:'Connect Casio',connected:'MIDI connected',keyboard:'Keyboard',loop:'Loop',from:'From',to:'To',enable:'Enable',exit:'Exit loop',gap:'Pause',welcome:'Your score, brought to life.',choose:'Choose a MusicXML file to begin.',loading:'Preparing your score…',piano:'Virtual piano',touch:'Tap the keys to play',helpTitle:'A standalone reader',helpText:'Open the MusicXML prepared by your converter. Audio and cursor follow the same notes. No PDF or MIDI file is required.',helpKeys:'Space: play / pause. ← and →: previous / next note, with sound. ↑ and ↓: tempo ±5 BPM. Click a note to move there.',helpLoop:'Choose the first and last measures, then Enable the loop. Exit loop clears the selection. Numbers in parentheses identify repeated passes.',helpLocal:'Opened scores are saved on this device. To publish them on GitHub, use ajouter-partition.cmd and upload the entire folder.',close:'Close',measure:'Measure',system:'Systems',ready:'Ready to play',correct:'Correct',wrong:'Different note',await:'Play the indicated notes',finished:'Piece complete',loopPause:'Restart in',unsupported:'Web MIDI is unavailable in this browser.',searching:'Searching for Casio…',noMidi:'No MIDI keyboard detected',denied:'MIDI connection denied',error:'Unable to read this MusicXML',remove:'Remove this local score?',local:'local',emptyLibrary:'Open a MusicXML file…'}
};
const tr=key=>translations[state.lang][key]||key;
function translate(){document.documentElement.lang=state.lang==='en'?'en-US':'fr';document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=tr(e.dataset.i18n));$('lang').textContent=state.lang==='fr'?'EN':'FR';$('theme').textContent=tr(document.body.classList.contains('night')?'day':'night');$('mode').textContent=tr(state.mode);$('play').textContent=tr(state.playing?'pause':'play');$('loop').textContent=tr(state.loop?'exit':'enable');$('midi').textContent=tr(midiConnected?'connected':'connect');updateTarget();}
function feedback(text,kind=''){$('feedback').textContent=text;$('feedback').className=kind}
const noteName=p=>(state.lang==='en'?['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B']:['Do','Do♯','Ré','Ré♯','Mi','Fa','Fa♯','Sol','Sol♯','La','La♯','Si'])[p%12]+(Math.floor(p/12)-1);
const clock=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
function svgElement(tag,attrs={}){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
function xmlId(el){return el.getAttribute('xml:id')||el.getAttribute('id')}

// Interpret metronome notation for engines that require an explicit sound tempo.
// This does not validate or correct the score: its musical content is unchanged.
function scoreText(text){
 const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.querySelector('parsererror'))throw Error(tr('error'));
 const units={maxima:32,long:16,breve:8,whole:4,half:2,quarter:1,eighth:.5,'16th':.25,'32nd':.125,'64th':.0625};
 for(const direction of doc.querySelectorAll('direction')){
  const met=direction.querySelector('metronome'),per=Number(met?.querySelector('per-minute')?.textContent),unit=units[met?.querySelector('beat-unit')?.textContent];
  if(per>0&&unit&&!direction.querySelector('sound[tempo]')){const dots=met.querySelectorAll('beat-unit-dot').length;let sound=direction.querySelector('sound');if(!sound){sound=doc.createElement('sound');direction.append(sound)}sound.setAttribute('tempo',String(per*unit*(2-2**(-dots))))}
 }
 return new XMLSerializer().serializeToString(doc);
}
function sanitize(svg){
 svg.querySelectorAll('script,foreignObject').forEach(e=>e.remove());
 for(const e of svg.querySelectorAll('*'))for(const a of [...e.attributes])if(a.name.startsWith('on')||((a.localName==='href')&&!a.value.startsWith('#')))e.removeAttributeNode(a);
 return svg;
}
function relativeBox(el,root){const b=el.getBBox(),matrix=root.getScreenCTM().inverse().multiply(el.getScreenCTM());const corners=[[b.x,b.y],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));return{x:corners[0].x,y:corners[0].y,width:corners[1].x-corners[0].x,height:corners[1].y-corners[0].y}}
async function engrave(){
 state.systems=[];state.notesById=new Map();state.measuresById=new Map();
 const mei=new DOMParser().parseFromString(toolkit.getMEI(),'application/xml');
 [...mei.querySelectorAll('measure')].forEach((m,i)=>state.measuresById.set(xmlId(m),{id:xmlId(m),label:m.getAttribute('n')||String(i+1),ordinal:i}));
 const staging=document.createElement('div');staging.style.cssText='position:fixed;left:-20000px;top:0;width:1100px;visibility:hidden';document.body.append(staging);
 try{
  for(let page=1;page<=toolkit.getPageCount();page++){
   const parsed=sanitize(new DOMParser().parseFromString(toolkit.renderToSVG(page),'image/svg+xml').documentElement);
   const defs=parsed.querySelector('defs');
   for(const original of parsed.querySelectorAll('g.system')){
    const svg=svgElement('svg',{xmlns:NS,viewBox:'0 0 22000 32000',width:1100,height:1600});
    if(defs)svg.append(defs.cloneNode(true));
    const style=svgElement('style');style.textContent='text,tspan{font-family:Times New Roman,serif}.tempo,.ending,.fing{font-weight:bold}.dir,.dynam,.mNum{font-style:italic}path{stroke:currentColor}';svg.append(style);
    const system=original.cloneNode(true);svg.append(system);staging.append(svg);
    const bounds=system.getBBox();
    const staffLines=[...system.querySelectorAll('g.staff > path')].map(p=>relativeBox(p,svg)).filter(b=>b.width>500&&b.height<2);
    const top=staffLines.length?Math.min(...staffLines.map(b=>b.y))-220:bounds.y;
    const bottom=staffLines.length?Math.max(...staffLines.map(b=>b.y))+300:bounds.y+bounds.height;
    const padding=180,x=Math.min(bounds.x,0)-padding,y=Math.min(bounds.y,top)-padding,w=Math.max(bounds.x+bounds.width,19500)-x+padding,h=Math.max(bounds.y+bounds.height,bottom)-y+padding;
    const model={svg,index:state.systems.length,top,bottom,box:{x,y,w,h},measures:[],cursor:null,veil:null};
    for(const m of system.querySelectorAll('g.measure')){
     const id=m.id,meta=state.measuresById.get(id);if(!meta)continue;
     const b=relativeBox(m,svg);Object.assign(meta,{system:model.index,box:b});model.measures.push(meta);
    }
    for(const note of system.querySelectorAll('g.note,g.rest,g.mRest')){
     const meta=state.measuresById.get(note.closest('g.measure')?.id);const head=note.querySelector('.notehead')||note;const b=relativeBox(head,svg);
     state.notesById.set(note.id,{id:note.id,el:note,system:model.index,x:b.x+b.width/2,measure:meta});
    }
    model.veil=svgElement('rect',{class:'measure-veil',x:0,y:top,width:0,height:bottom-top,visibility:'hidden'});svg.insertBefore(model.veil,system);
    model.cursor=svgElement('line',{class:'score-cursor',y1:top,y2:bottom,x1:0,x2:0,visibility:'hidden'});svg.append(model.cursor);
    svg.setAttribute('viewBox',`${x} ${y} ${w} ${h}`);svg.removeAttribute('width');svg.removeAttribute('height');svg.style.width='100%';svg.style.height='auto';
    svg.addEventListener('click',event=>{const note=event.target.closest('g.note,g.rest,g.mRest');if(!note)return;const choices=state.timeline.groups.map((g,i)=>g.ids.includes(note.id)?i:-1).filter(i=>i>=0);if(choices.length)seek(choices.find(i=>i>=state.group)??choices[0],true)});
    state.systems.push(model);svg.remove();
   }
  }
 }finally{staging.remove()}
}
async function loadScore(record){
 stop();loading=true;const token=++state.token;setBusy(true);$('empty').hidden=true;
 try{
  let data=record.data;
  if(!data){const response=await fetch(record.xml_url);if(!response.ok)throw Error(`HTTP ${response.status}`);data=await response.arrayBuffer()}
  if(token!==state.token)return;
  toolkit?.destroy?.();toolkit=new VerovioToolkit(await modulePromise);
  toolkit.setOptions({pageWidth:2100,pageHeight:3000,scale:40,breaks:'auto',header:'none',footer:'none',svgViewBox:true,adjustPageHeight:true,spacingStaff:14,spacingSystem:14});
  const compressed=(record.filename||record.xml_url||'').toLowerCase().endsWith('.mxl');
  const ok=compressed?toolkit.loadZipDataBuffer(data):toolkit.loadData(scoreText(typeof data==='string'?data:new TextDecoder().decode(data)));
  if(!ok)throw Error(tr('error'));
  await engrave();
  const aliasCache=new Map(),alias=id=>{if(!aliasCache.has(id))aliasCache.set(id,toolkit.getNotatedIdForElement(id)||id);return aliasCache.get(id)};
  const mei=new DOMParser().parseFromString(toolkit.getMEI(),'application/xml');
  const ties=new Map([...mei.getElementsByTagName('tie')].map(t=>[t.getAttribute('startid')?.slice(1),t.getAttribute('endid')?.slice(1)]));
  const timeline=makeTimeline(toolkit.renderToTimemap({includeMeasures:true,includeRests:true}),id=>toolkit.getMIDIValuesForElement(id)?.pitch,alias,ties);
  if(!state.systems.length||!timeline.groups.length)throw Error(tr('error'));
  state.timeline=timeline;state.record=record;state.group=0;state.base=0;state.rate=1;state.loop=null;state.pair=-1;
  state.tempo=timeline.tempo;$('tempo').max=String(Math.max(300,Math.ceil(state.tempo)));$('tempo').value=String(Math.round(state.tempo));$('tempoValue').textContent=Math.round(state.tempo)+' BPM';
  const counts=new Map();for(const measure of timeline.measures){const meta=state.measuresById.get(measure.id);measure.meta=meta;const n=(counts.get(measure.id)||0)+1;counts.set(measure.id,n);measure.label=(meta?.label??String(measure.index+1))+(n>1?` (${n})`:'')}
  for(const group of timeline.groups){if(group.measure?.startX!==undefined)continue;const first=group.ids.map(id=>state.notesById.get(id)).find(Boolean);if(first)group.measure.startX=first.x}
  for(const select of [$('loopFrom'),$('loopTo')])select.replaceChildren(...timeline.measures.map(m=>new Option(m.label,String(m.index))));
  $('loop').classList.remove('active');$('loop').textContent=tr('enable');buildPiano();updateTarget();feedback(tr('ready'));document.title=(record.name||'MusicXML')+' · Lecteur v28';
 }catch(error){console.error(error);state.timeline=null;state.systems=[];state.pair=-1;$('systems').replaceChildren();$('empty').hidden=false;feedback(tr('error')+' — '+error.message,'bad')}
 finally{if(token===state.token){loading=false;setBusy(false)}}
}
function setBusy(on){$('loading').hidden=!on;for(const id of ['play','start','prev','next','loop','library','open'])$(id).disabled=on}

function showPair(systemIndex){
 const first=Math.floor(systemIndex/2)*2;if(first===state.pair)return;state.pair=first;const host=$('systems');host.replaceChildren();
 const pair=state.systems.slice(first,first+2);host.classList.toggle('single',pair.length===1);
 for(const model of pair){const slot=document.createElement('div');slot.className='system-slot';slot.append(model.svg);host.append(slot)}fitSystems();
}
function fitSystems(){for(const slot of $('systems').children){const svg=slot.querySelector('svg'),b=svg.viewBox.baseVal;const scale=Math.min(slot.clientWidth/b.width,slot.clientHeight/b.height);svg.style.width=b.width*scale+'px';svg.style.height=b.height*scale+'px'}}
function updateTarget(){
 const group=state.timeline?.groups[state.group];if(!group)return;
 let note=group.ids.map(id=>state.notesById.get(id)).find(Boolean),meta=group.measure?.meta||state.measuresById.get(group.measure?.id);
 if(!note&&meta?.system!==undefined)note={system:meta.system,x:meta.box.x+100};
 if(note){showPair(note.system);for(const model of state.systems){model.cursor.setAttribute('visibility','hidden');model.veil.setAttribute('visibility','hidden')}const model=state.systems[note.system];model.cursor.setAttribute('x1',note.x);model.cursor.setAttribute('x2',note.x);model.cursor.setAttribute('visibility','visible');paintVeil(model,meta,note.x,group.measure);$('score').dataset.system=note.system;$('score').dataset.note=group.ids[0]||''}
 for(const el of document.querySelectorAll('.current-note'))el.classList.remove('current-note');for(const id of group.ids)state.notesById.get(id)?.el.classList.add('current-note');
 $('position').textContent=tr('measure')+' '+(group.measure?.label||meta?.label||'—')+' · '+tr('system')+' '+(state.pair+1)+'–'+Math.min(state.pair+2,state.systems.length);
 $('clock').textContent=clock(group.time)+' / '+clock(state.timeline.duration);paintKeyboard();paintLoop();
}
function paintVeil(model,meta,cursorX,measure){
 if(!meta)return;const measureKey=measure?.index??meta.ordinal;
 if(state.veilMeasure!==measureKey){state.veilMeasure=measureKey;state.veilColor=state.veilSetting==='random'?['#ec4a7b','#4a90e2','#35a77a','#d99425','#8b6bd9'][Math.floor(Math.random()*5)]:state.veilSetting}
 const startX=Math.max(meta.box.x,measure?.startX??cursorX),width=Math.max(0,Math.min(meta.box.width,cursorX-startX));
 model.veil.setAttribute('x',startX);model.veil.setAttribute('width',width);model.veil.setAttribute('fill',state.veilColor);model.veil.setAttribute('visibility','visible');
}
function paintLoop(){
 const selected=new Set(state.loop?state.timeline.measures.slice(state.loop.from,state.loop.to+1).map(m=>m.id):[]);
 for(const model of state.systems){model.svg.querySelectorAll('.loop-shade').forEach(e=>e.remove());for(const m of model.measures){if(!selected.has(m.id))continue;const r=svgElement('rect',{class:'loop-shade',x:m.box.x,y:model.top,width:m.box.width,height:model.bottom-model.top});model.svg.insertBefore(r,model.cursor)}}
}
function currentTime(){return state.playing&&state.mode==='continuous'?state.base+(audio.ctx.currentTime-state.started)*state.rate:state.base}
function stop(){clearTimeout(loopTimer);clearTimeout(waitTimer);loopTimer=null;waitTimer=null;if(state.playing&&state.mode==='continuous')state.base=currentTime();state.playing=false;state.loopWaiting=false;cancelAnimationFrame(raf);audio.silence();state.waitHits.clear();$('play').textContent=tr('play')}
function seek(index,hear=false){stop();if(!state.timeline)return;state.group=Math.max(0,Math.min(state.timeline.groups.length-1,index));state.base=state.timeline.groups[state.group].time;updateTarget();if(hear)audition()}
async function audition(){await audio.unlock();state.timeline?.groups[state.group]?.notes.forEach(n=>audio.play(n.pitch,0,Math.min(1.5,Math.max(.25,(n.end-n.start)/state.rate))))}
function firstPlayable(index){while(index<state.timeline.groups.length-1&&!state.timeline.groups[index].notes.length)index++;return index}
async function play(){
 if(!state.timeline||loading)return;await audio.unlock();
 rememberPlayed(state.record);
 if(state.base>=state.timeline.duration-.001)seek(0);
 if(state.loop&&(state.base<state.loop.start||state.base>=state.loop.end))seek(groupAt(state.timeline.groups,state.loop.start));
 state.waitHits.clear();state.playing=true;$('play').textContent=tr('pause');
 if(state.mode==='wait'){state.group=firstPlayable(state.group);state.base=state.timeline.groups[state.group].time;updateTarget();feedback(tr('await'));return}
 state.started=audio.ctx.currentTime;state.nextNote=state.timeline.notes.findIndex(n=>n.start>=state.base-.00001);if(state.nextNote<0)state.nextNote=state.timeline.notes.length;
 tick();
}
function tick(){
 if(!state.playing||state.mode!=='continuous')return;
 const time=currentTime(),end=state.loop?.end??state.timeline.duration;
 if(time>=end-.00001){if(state.loop){loopPause();return}stop();state.base=0;state.group=0;updateTarget();feedback(tr('finished'));return}
 const nextGroup=groupAt(state.timeline.groups,time);if(nextGroup!==state.group){state.group=nextGroup;updateTarget()}
 while(state.nextNote<state.timeline.notes.length){const n=state.timeline.notes[state.nextNote];if(n.start>=end-1e-6||n.start>time+.09*state.rate)break;state.nextNote++;if(n.end<time)continue;audio.play(n.pitch,audio.ctx.currentTime+Math.max(0,(n.start-time)/state.rate),Math.max(.03,(Math.min(end,n.end)-Math.max(n.start,time))/state.rate))}
 $('clock').textContent=clock(time)+' / '+clock(state.timeline.duration);raf=requestAnimationFrame(tick);
}
function loopPause(){stop();state.loopWaiting=true;state.base=state.loop.start;state.group=groupAt(state.timeline.groups,state.base);updateTarget();let left=Number($('gap').value);feedback(tr('loopPause')+' '+left+' s');loopTimer=setTimeout(()=>{state.loopWaiting=false;play()},left*1000)}
function setTempo(value){const wasPlaying=state.playing;stop();const max=Number($('tempo').max);const bpm=Math.max(5,Math.min(max,value));$('tempo').value=String(bpm);$('tempoValue').textContent=bpm+' BPM';state.rate=bpm/(state.tempo||120);if(wasPlaying)play()}
function changeLoop(){if(!state.timeline)return;const was=state.playing;stop();let a=Number($('loopFrom').value),b=Number($('loopTo').value);if(b<a){b=a;$('loopTo').value=String(b)}state.loop=loopBounds(state.timeline.measures,a,b);$('loop').classList.add('active');$('loop').textContent=tr('exit');seek(groupAt(state.timeline.groups,state.loop.start));paintLoop();if(was)play()}
function clearLoop(){clearTimeout(loopTimer);state.loopWaiting=false;state.loop=null;$('loop').classList.remove('active');$('loop').textContent=tr('enable');paintLoop();feedback(tr('ready'))}

function buildPiano(){
 const pitches=state.timeline?.notes.map(n=>n.pitch)||[48,84];const low=Math.max(21,Math.floor((Math.min(...pitches)-3)/12)*12),high=Math.min(108,Math.ceil((Math.max(...pitches)+3)/12)*12);
 $('piano').replaceChildren();let whites=0;
 for(let pitch=low;pitch<=high;pitch++){
  const black=[1,3,6,8,10].includes(pitch%12),left=black?whites*32-10:whites++*32;
  const key=document.createElement('button');key.className='key '+(black?'black':'white');key.dataset.pitch=pitch;key.style.left=left+'px';key.setAttribute('aria-label',noteName(pitch));
  if(pitch%12===0){const label=document.createElement('span');label.className='c-label';label.textContent=noteName(pitch);key.append(label)}
  key.onpointerdown=e=>{e.preventDefault();key.setPointerCapture(e.pointerId);inputNote(pitch,100)};key.onpointerup=key.onpointercancel=()=>releaseNote(pitch);$('piano').append(key);
 }$('piano').style.width=whites*32+'px';
}
function paintKeyboard(){
 const expected=new Set(state.timeline?.groups[state.group]?.notes.map(n=>n.pitch)||[]);$('piano').querySelectorAll('.note-name').forEach(n=>n.remove());
 for(const key of $('piano').querySelectorAll('.key')){const pitch=+key.dataset.pitch;key.classList.toggle('expected',expected.has(pitch));key.setAttribute('aria-label',noteName(pitch));if(key.querySelector('.c-label'))key.querySelector('.c-label').textContent=noteName(pitch);if(expected.has(pitch)){const name=document.createElement('span');name.className='note-name';name.textContent=noteName(pitch);key.append(name)}}
}
async function inputNote(pitch,velocity=90){
 // Start audio without waiting for iPadOS: a suspended AudioContext must not block note recognition.
 void audio.unlock().then(()=>audio.play(pitch,0,2,velocity)).catch(error=>console.warn('Audio indisponible pour la note MIDI',error));
 const key=$('piano').querySelector(`[data-pitch="${pitch}"]`);key?.classList.add('pressed');
 const group=state.timeline?.groups[state.group];if(!group)return;const expected=new Set(group.notes.map(n=>n.pitch));
 const correct=expected.has(pitch);feedback(tr(correct?'correct':'wrong')+' · '+noteName(pitch),correct?'good':'bad');if(!correct){key?.classList.add('wrong');setTimeout(()=>key?.classList.remove('wrong'),300)}
 if(state.mode==='wait'&&state.playing&&correct&&!waitTimer){state.waitHits.add(pitch);if([...expected].every(p=>state.waitHits.has(p))){waitTimer=setTimeout(()=>{waitTimer=null;state.waitHits.clear();let next=firstPlayable(state.group+1);if(state.loop&&(next>=state.timeline.groups.length||state.timeline.groups[next].time>=state.loop.end)){loopPause();return}if(next>=state.timeline.groups.length){stop();state.base=0;state.group=0;updateTarget();feedback(tr('finished'));return}state.group=next;state.base=state.timeline.groups[next].time;updateTarget();feedback(tr('await'))},140)}}
}
function releaseNote(pitch){audio.release(pitch);$('piano').querySelector(`[data-pitch="${pitch}"]`)?.classList.remove('pressed')}
// Read MIDIInputMap objects as well as arrays and legacy MIDIWeb polyfills.
function listMidiInputs(access=midiAccess){
 const collection=access?.inputs;if(!collection)return[];
 const result=[],seen=new Set(),add=input=>{if(!input||typeof input!=='object'||seen.has(input)||input.state==='disconnected')return;seen.add(input);result.push(input)};
 try{
  if(typeof collection.values==='function'){
   const iterator=collection.values();
   if(iterator&&typeof iterator.next==='function'){let item=iterator.next();while(!item.done){add(item.value);item=iterator.next()}}
   else if(iterator&&typeof iterator[Symbol.iterator]==='function')for(const input of iterator)add(input);
  }
 }catch{}
 if(result.length===0&&typeof collection.forEach==='function')try{collection.forEach(input=>add(input))}catch{}
 if(result.length===0&&Array.isArray(collection))collection.forEach(add);
 if(result.length===0&&typeof collection==='object'){
  try{for(const input of Object.values(collection)){if(input&&typeof input==='object'&&(input.name||input.id||'onmidimessage'in input||typeof input.addEventListener==='function'))add(input)}}catch{}
 }
 return result;
}
function handleMidiMessage(event,input){
 if(!event||!event.data)return;
 // Some MIDIWeb bridges dispatch through both onmidimessage and addEventListener.
 if(typeof event==='object'){if(handledMidiEvents.has(event))return;handledMidiEvents.add(event)}
 const data=event.data,status=Number(data[0]),pitch=Number(data[1]),velocity=data.length>2?Number(data[2]):64,command=status&0xf0;
 if(!Number.isFinite(status)||!Number.isInteger(pitch)||pitch<0||pitch>127)return;
 if(command===0x90&&velocity>0){void inputNote(pitch,velocity).catch(error=>console.warn('Erreur de lecture de la note MIDI',error))}
 else if(command===0x80||(command===0x90&&velocity===0))releaseNote(pitch);
}
function bindMidiInput(input){
 if(midiInputBindings.has(input))return;
 const handler=event=>handleMidiMessage(event,input);let propertyBound=false,listenerBound=false;
 try{input.onmidimessage=handler;propertyBound=true}catch{}
 try{if(typeof input.addEventListener==='function'){input.addEventListener('midimessage',handler);listenerBound=true}}catch{}
 midiInputBindings.set(input,{handler,propertyBound,listenerBound});
}
function unbindMidiInput(input,binding){
 try{if(binding.propertyBound&&input.onmidimessage===binding.handler)input.onmidimessage=null}catch{}
 try{if(binding.listenerBound&&typeof input.removeEventListener==='function')input.removeEventListener('midimessage',binding.handler)}catch{}
 midiInputBindings.delete(input);
}
function stopMidiPolling(){if(midiPollTimer!==null){clearInterval(midiPollTimer);midiPollTimer=null}}
function refreshMidiInputs(){
 const inputs=listMidiInputs(),active=new Set(inputs);
 for(const[input,binding]of midiInputBindings)if(!active.has(input))unbindMidiInput(input,binding);
 inputs.forEach(bindMidiInput);midiConnected=inputs.length>0;
 const names=inputs.map((input,index)=>input.name||input.manufacturer||`Périphérique MIDI ${index+1}`);
 $('midiState').textContent=names.join(' · ')||(midiPollTimer!==null?tr('searching'):tr('noMidi'));
 $('midi').textContent=tr(midiConnected?'connected':'connect');
 if(midiConnected)stopMidiPolling();
 return inputs.length;
}
function startMidiPolling(){
 stopMidiPolling();midiPollCount=0;
 if(refreshMidiInputs()>0)return;
 midiPollTimer=setInterval(()=>{
  midiPollCount++;
  const found=refreshMidiInputs();
  if(found||midiPollCount>=10){stopMidiPolling();if(!found)refreshMidiInputs()}
 },1500);
 refreshMidiInputs();
}
async function connectMidi({auto=false}={}){
 if(midiConnecting)return;
 if(!navigator.requestMIDIAccess){$('midiState').textContent=tr('unsupported');if(!auto)feedback(tr('unsupported'),'bad');return}
 midiConnecting=true;$('midiState').textContent=tr('searching');
 try{
  let access;
  // MIDIWeb works best with SysEx enabled; fall back for browsers that deny it.
  try{access=await navigator.requestMIDIAccess({sysex:true})}
  catch(sysexError){access=await navigator.requestMIDIAccess({sysex:false})}
  if(midiAccess&&midiAccessStateHandler){try{if(midiAccess.onstatechange===midiAccessStateHandler)midiAccess.onstatechange=null}catch{};try{midiAccess.removeEventListener?.('statechange',midiAccessStateHandler)}catch{}}
  midiAccess=access;
  const onStateChange=()=>{if(refreshMidiInputs()===0&&midiPollTimer===null)startMidiPolling()};
  midiAccessStateHandler=onStateChange;
  try{midiAccess.onstatechange=onStateChange}catch{}
  try{midiAccess.addEventListener?.('statechange',onStateChange)}catch{}
  startMidiPolling();
 }catch(error){
  midiConnected=false;$('midi').textContent=tr('connect');$('midiState').textContent=tr('denied');
  if(!auto)feedback(tr('denied'),'bad');
  console.warn('Connexion MIDI impossible',error);
 }finally{midiConnecting=false}
}

let database;
function db(){return database??=new Promise((resolve,reject)=>{const request=indexedDB.open('musicxml-reader-v26',1);request.onupgradeneeded=()=>request.result.createObjectStore('scores',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function storedScores(){try{const d=await db();return await new Promise((resolve,reject)=>{const r=d.transaction('scores').objectStore('scores').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}catch{return[]}}
async function persist(record){try{const d=await db();await new Promise((resolve,reject)=>{const tx=d.transaction('scores','readwrite');tx.objectStore('scores').put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}catch{feedback(state.lang==='fr'?'Morceau ouvert pour cette séance uniquement.':'Score opened for this session only.')}}
function sortCatalog(){state.catalog=state.catalog.map((record,index)=>({record,index})).sort((a,b)=>(state.recent[b.record.id]||0)-(state.recent[a.record.id]||0)||a.index-b.index).map(({record})=>record)}
function refreshOptions(selectedId=$('library').value){$('library').replaceChildren(...state.catalog.map(r=>new Option(r.name+(r.data?' · '+tr('local'):''),r.id)));if(state.catalog.some(r=>r.id===selectedId))$('library').value=selectedId;if(!state.catalog.length)$('library').append(new Option(tr('emptyLibrary'),''))}
function rememberPlayed(record){if(!record?.id)return;state.recent[record.id]=Date.now();localStorage.setItem('v26-recent-scores',JSON.stringify(state.recent));sortCatalog();refreshOptions(record.id)}
async function openFiles(files){const records=[];for(const file of files){const record={id:'local-'+file.name,name:file.name.replace(/\.(musicxml|xml|mxl)$/i,''),filename:file.name,data:await file.arrayBuffer()};await persist(record);const old=state.catalog.findIndex(r=>r.id===record.id);if(old>=0)state.catalog[old]=record;else state.catalog.push(record);records.push(record)}refreshOptions();if(records.length){$('library').value=records[0].id;await loadScore(records[0])}}

$('play').onclick=()=>state.playing||state.loopWaiting?stop():play();$('start').onclick=()=>{seek(0);feedback(tr('ready'))};$('prev').onclick=()=>state.timeline&&seek(noteStep(state.timeline.groups,state.group,-1),true);$('next').onclick=()=>state.timeline&&seek(noteStep(state.timeline.groups,state.group,1),true);
$('mode').onclick=()=>{stop();state.mode=state.mode==='continuous'?'wait':'continuous';$('mode').textContent=tr(state.mode);feedback(tr(state.mode==='wait'?'await':'ready'))};
$('tempo').oninput=e=>setTempo(+e.target.value);$('slower').onclick=()=>setTempo(+$('tempo').value-5);$('faster').onclick=()=>setTempo(+$('tempo').value+5);
$('loop').onclick=()=>state.loop?clearLoop():changeLoop();$('loopFrom').onchange=$('loopTo').onchange=()=>{if(state.loop)changeLoop()};$('gap').oninput=()=>{$('gapValue').textContent=$('gap').value+' s'};
$('veilColor').value=['#ec4a7b','#4a90e2','#35a77a','#d99425','#8b6bd9','random'].includes(state.veilSetting)?state.veilSetting:'custom';$('veilCustomColor').value=state.veilSetting==='random'?'#ec4a7b':state.veilSetting;
function setVeilColor(value){state.veilSetting=value;state.veilMeasure=null;localStorage.setItem('v26-veil-color',value);updateTarget()}
$('veilColor').onchange=e=>{if(e.target.value==='random')setVeilColor('random');else if(e.target.value!=='custom'){$('veilCustomColor').value=e.target.value;setVeilColor(e.target.value)}};$('veilCustomColor').oninput=e=>{$('veilColor').value='custom';setVeilColor(e.target.value)};
$('midi').onclick=connectMidi;$('pianoToggle').onclick=()=>{document.body.classList.toggle('no-piano');$('pianoToggle').setAttribute('aria-pressed',String(!document.body.classList.contains('no-piano')));fitSystems()};
$('lang').onclick=()=>{state.lang=state.lang==='fr'?'en':'fr';localStorage.setItem('v26-lang',state.lang);translate();refreshOptions()};$('theme').onclick=()=>{document.body.classList.toggle('night');localStorage.setItem('v26-theme',document.body.classList.contains('night')?'night':'day');translate()};document.body.classList.toggle('night',localStorage.getItem('v26-theme')==='night');
$('open').onclick=()=>$('files').click();$('files').onchange=async()=>{await openFiles([...$('files').files]);$('files').value=''};$('library').onchange=()=>{const record=state.catalog.find(r=>r.id===$('library').value);if(record)loadScore(record)};
$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||$('helpDialog').open||e.ctrlKey||e.metaKey||e.altKey)return;if(e.repeat)return;const action={' ':()=>$('play').click(),ArrowLeft:()=>$('prev').click(),ArrowRight:()=>$('next').click(),ArrowUp:()=>$('faster').click(),ArrowDown:()=>$('slower').click()};if(action[e.key]){e.preventDefault();action[e.key]()}});
window.addEventListener('resize',fitSystems);new ResizeObserver(fitSystems).observe($('score'));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.playing)stop()});
translate();buildPiano();void connectMidi({auto:true});const modulePromise=createModule();
try{const response=await fetch('./library.json');if(response.ok){const data=await response.json();state.catalog=Array.isArray(data)?data:data.sessions||[]}state.catalog.push(...await storedScores());sortCatalog();refreshOptions();if(state.catalog.length)await loadScore(state.catalog[0])}catch(error){feedback(error.message,'bad')}
if('serviceWorker'in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
