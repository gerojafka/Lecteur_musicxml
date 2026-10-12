// Verovio's timemap is the only clock: sound, score and repeats share its IDs.
export function makeTimeline(map, pitchFor, notatedId=id=>id, ties=new Map()) {
  const notes=[],groups=[],measures=[],active=new Map();let measure=null;
  for(const event of map){
    const time=event.tstamp/1000;
    for(const id of event.off||[]){const note=active.get(id);if(note){note.end=time;active.delete(id)}}
    if(event.measureOn){measure={id:notatedId(event.measureOn),time,index:measures.length};measures.push(measure)}
    const attacks=[];
    for(const id of event.on||[]){const pitch=pitchFor(id);if(!Number.isFinite(pitch))continue;const n={id:notatedId(id),pitch,start:time,end:time+.2};notes.push(n);attacks.push(n);active.set(id,n)}
    if(attacks.length||(event.restsOn||[]).length||event.measureOn){groups.push({time,notes:attacks,ids:[...new Set([...(event.on||[]),...(event.restsOn||[])].map(notatedId))],measure,tempo:event.tempo})}
  }
  const continuations=new Set();
  for(const first of notes){
    if(continuations.has(first))continue;
    let current=first;const visited=new Set();
    while(ties.has(current.id)&&!visited.has(current)){
      visited.add(current);
      const next=notes.find(n=>n.id===ties.get(current.id)&&n.pitch===current.pitch&&Math.abs(n.start-current.end)<.002&&!continuations.has(n)&&n!==current);
      if(!next)break;
      first.end=next.end;continuations.add(next);current=next;
    }
  }
  for(const group of groups)group.notes=group.notes.filter(n=>!continuations.has(n));
  const duration=Math.max(0,...map.map(e=>e.tstamp/1000),...notes.map(n=>n.end));
  for(let i=0;i<measures.length;i++)measures[i].end=measures[i+1]?.time??duration;
  return{notes:notes.filter(n=>!continuations.has(n)),groups,measures,duration,tempo:map.find(e=>e.tempo)?.tempo||120};
}
export function groupAt(groups,time){let lo=0,hi=groups.length;while(lo<hi){const m=(lo+hi)>>1;if(groups[m].time<=time+1e-6)lo=m+1;else hi=m}return Math.max(0,lo-1)}
export function noteStep(groups,index,delta){let i=index;do{i+=delta}while(i>=0&&i<groups.length&&!groups[i].notes.length);return Math.max(0,Math.min(groups.length-1,i))}
export function loopBounds(measures,from,to){const a=Math.max(0,Math.min(measures.length-1,from));const b=Math.max(a,Math.min(measures.length-1,to));return{start:measures[a].time,end:measures[b].end,from:a,to:b}}
