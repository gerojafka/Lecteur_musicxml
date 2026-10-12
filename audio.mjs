export class PianoAudio{
  constructor(){this.voices=new Set();this.ctx=null}
  async unlock(){this.ctx??=new (window.AudioContext||window.webkitAudioContext)();if(this.ctx.state!=='running')await this.ctx.resume();return this.ctx}
  play(pitch,when=0,duration=.65,velocity=88){
    if(!this.ctx)return;const ctx=this.ctx,t=Math.max(ctx.currentTime,when),stop=t+Math.max(.08,duration),amp=ctx.createGain();amp.connect(ctx.destination);
    const peak=.14*Math.pow(velocity/127,1.4);amp.gain.setValueAtTime(0,t);amp.gain.linearRampToValueAtTime(peak,t+.008);amp.gain.exponentialRampToValueAtTime(Math.max(.001,peak*.22),t+Math.min(.32,Math.max(.05,duration*.7)));amp.gain.setTargetAtTime(.00001,stop,.055);
    const oscillators=[1,2,3].map((harmonic,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=i?'sine':'triangle';o.frequency.value=440*2**((pitch-69)/12)*harmonic;g.gain.value=[.7,.2,.07][i];o.connect(g);g.connect(amp);o.start(t);o.stop(stop+.4);return o});
    const voice={amp,oscillators,pitch,stop};this.voices.add(voice);oscillators[0].onended=()=>{amp.disconnect();this.voices.delete(voice)};return voice;
  }
  release(pitch){if(!this.ctx)return;for(const v of this.voices)if(v.pitch===pitch){v.amp.gain.cancelScheduledValues(this.ctx.currentTime);v.amp.gain.setTargetAtTime(.00001,this.ctx.currentTime,.045)}}
  silence(){if(!this.ctx)return;for(const v of this.voices){v.amp.gain.cancelScheduledValues(this.ctx.currentTime);v.amp.gain.setValueAtTime(0,this.ctx.currentTime);for(const o of v.oscillators)try{o.stop()}catch{}}this.voices.clear()}
}
