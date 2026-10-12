// Geometry is measured once from full-resolution pixels, never from the viewport.
export function detectSystems(image, expected) {
  const {width:w,height:h,data}=image;
  if(!expected)throw new Error('Aucun système musical dans le MusicXML.');
  for(const threshold of [.34,.25,.18,.45]) {
    const x0=Math.floor(w*.055),x1=Math.ceil(w*.945),step=Math.max(1,Math.floor(w/800));
    const samples=Math.ceil((x1-x0)/step),rows=[];
    for(let y=0;y<h;y++) {
      let dark=0;
      for(let x=x0;x<x1;x+=step){const i=(y*w+x)*4;if(data[i]<115&&data[i+1]<115&&data[i+2]<115)dark++;}
      if(dark>samples*threshold)rows.push(y);
    }
    const lines=[];
    for(let i=0;i<rows.length;) {
      const start=rows[i];let end=start;
      while(i+1<rows.length&&rows[i+1]<=end+Math.max(2,w/850))end=rows[++i];
      lines.push((start+end)/2);i++;
    }
    const staffs=[];
    for(let i=0;i+4<lines.length;) {
      const gaps=[1,2,3,4].map(j=>lines[i+j]-lines[i+j-1]),gap=gaps.reduce((a,b)=>a+b)/4;
      if(gap>=w*.003&&gap<=w*.022&&Math.max(...gaps)-Math.min(...gaps)<=Math.max(2,gap*.28)) {
        staffs.push({top:lines[i],gap});i+=5;
      } else i++;
    }
    // A partial detection cannot be assigned to the first systems: that was the
    // cause of measure 1 being drawn on measure 11 at some display scales.
    if(staffs.length!==expected*2)continue;
    const systems=[];
    for(let i=0;i<staffs.length;i+=2) {
      const a=staffs[i],b=staffs[i+1],gap=(a.gap+b.gap)/2;
      if(b.top-a.top<gap*4.5||b.top-a.top>gap*18)break;
      systems.push({top:a.top,bassTop:b.top,bottom:b.top+b.gap*4,gap});
    }
    if(systems.length===expected)return systems;
  }
  throw new Error('Les portées du PDF ne correspondent pas toutes au MusicXML.');
}

export function layoutPair(systems,index,width,height,viewportWidth,viewportHeight) {
  const first=Math.floor(index/2)*2,last=Math.min(first+1,systems.length-1);
  const upper=systems[first],lower=systems[last],current=systems[index];
  // Include clefs, tempo, ledger lines and pedal marks while excluding neighbors.
  const cropTop=Math.max(0,upper.top-upper.gap*6);
  const cropBottom=Math.min(height,lower.bottom+lower.gap*7);
  const scale=Math.min((Math.max(40,viewportWidth)-16)/width,(Math.max(40,viewportHeight)-16)/(cropBottom-cropTop));
  const offsetY=(viewportHeight-(cropBottom-cropTop)*scale)/2-cropTop*scale;
  return {first,last,cropTop,cropBottom,scale,offsetY,
    cursorTop:current.top-current.gap*3,
    cursorBottom:current.bottom+current.gap*5.5};
}
