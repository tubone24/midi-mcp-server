/**
 * Generates a standalone preview HTML page with embedded composition data.
 * This is used for the HTTP /preview endpoint and for writing standalone HTML files.
 * Unlike the MCP App HTML (which communicates via ext-apps protocol), this page
 * works independently in any browser.
 */
export function getPreviewHtml(compositionJson?: string, midiBase64?: string): string {
  const embeddedData = compositionJson ?? 'null';
  const embeddedMidi = midiBase64 ? `"${midiBase64}"` : 'null';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MIDI Preview</title>
<style>
:root { --bg:#fff; --text:#1a1a2e; --surface:#f8f9fa; --border:#dee2e6; --primary:#4361ee; --primary-hover:#3a56d4; --error:#ef476f; }
@media(prefers-color-scheme:dark){:root{--bg:#1a1a2e;--text:#e8e8e8;--surface:#16213e;--border:#0f3460;--primary:#4361ee;--primary-hover:#5a7bff;--error:#ef476f;}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);padding:16px;max-width:900px;margin:0 auto}
h2{font-size:1.2rem;margin-bottom:12px}
.controls{display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
button{background:var(--primary);color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:.9rem;cursor:pointer;transition:background .2s}
button:hover{background:var(--primary-hover)} button:disabled{opacity:.5;cursor:not-allowed} button.stop{background:var(--error)}
.tempo-display{font-size:.85rem;opacity:.7;margin-left:auto}
#notation{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;min-height:200px;overflow-x:auto;margin-bottom:16px}
.track-info{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:8px;font-size:.85rem}
.track-info .tn{font-weight:600} .track-info .td{opacity:.7;margin-left:8px}
.progress-bar{width:100%;height:4px;background:var(--border);border-radius:2px;margin-bottom:16px;overflow:hidden}
.progress-bar .fill{height:100%;background:var(--primary);border-radius:2px;transition:width .1s linear;width:0}
.status{font-size:.8rem;opacity:.6;text-align:center;margin-top:8px}
.error{color:var(--error);font-weight:600}
.dl{margin-top:12px} .dl a{color:var(--primary);text-decoration:none;font-size:.85rem} .dl a:hover{text-decoration:underline}
</style>
</head>
<body>
<h2 id="title">MIDI Preview</h2>
<div class="controls">
  <button id="bp" disabled>Play</button>
  <button id="bs" class="stop" disabled>Stop</button>
  <span class="tempo-display" id="td"></span>
</div>
<div class="progress-bar"><div class="fill" id="pf"></div></div>
<div id="notation"><p class="status">Loading...</p></div>
<div id="tl"></div>
<div class="dl"><a id="dl" style="display:none" download="composition.mid">Download MIDI</a></div>
<div class="status" id="st"></div>
<script>
var EC=${embeddedData}, EM=${embeddedMidi};

function dB(d){if(typeof d==='number'){var m={0.125:.125,0.25:.25,0.5:.5,1:1,2:2,4:4};return m[d]||1}var s=String(d);if(s.indexOf('dd')===0)return(4/parseInt(s.slice(2)))*1.75;if(s.indexOf('d')===0)return(4/parseInt(s.slice(1)))*1.5;if(s.indexOf('T')===0)return(4/parseInt(s.slice(1)))*(2/3);var n=parseInt(s);return(!isNaN(n)&&n>0)?4/n:1}
function m2f(m){return 440*Math.pow(2,(m-69)/12)}
function n2m(n){var M={C:0,D:2,E:4,F:5,G:7,A:9,B:11},r=n.match(/^([A-Ga-g])([#b]?)(-?\\d+)$/);if(!r)return 60;var s=M[r[1].toUpperCase()]||0;if(r[2]==='#')s+=1;if(r[2]==='b')s-=1;return(parseInt(r[3])+1)*12+s}
var CI={'': [0,4,7],maj:[0,4,7],m:[0,3,7],min:[0,3,7],dim:[0,3,6],aug:[0,4,8],'7':[0,4,7,10],maj7:[0,4,7,11],M7:[0,4,7,11],m7:[0,3,7,10],dim7:[0,3,6,9],m7b5:[0,3,6,10],sus2:[0,2,7],sus4:[0,5,7],'6':[0,4,7,9],'9':[0,4,7,10,14],add9:[0,4,7,14],power:[0,7],'5':[0,7]};
function pC(c){var r=c.match(/^([A-Ga-g])([#b]?)(\\d)?(.*)$/);if(!r)return[60];var rt=n2m(r[1]+(r[2]||'')+(r[3]||'4'));return(CI[r[4]]||[0,4,7]).map(function(i){return rt+i})}
function rP(p,c){if(c)return pC(c);if(Array.isArray(p))return p;return[p]}

var ctx=null,playing=false,nodes=[],sT=0,dur=0,af=null,pCb=null;
function initA(){if(!ctx)ctx=new(window.AudioContext||window.webkitAudioContext)();if(ctx.state==='suspended')ctx.resume()}
function playC(comp){stopP();initA();var bpm=comp.bpm||120,bd=60/bpm;sT=ctx.currentTime+.1;var me=0;
comp.tracks.forEach(function(tr,ti){var cb=0;tr.notes.forEach(function(n){var nb;if(n.beat!==undefined)nb=n.beat-1;else if(n.startTime!==undefined)nb=n.startTime;else nb=cb;var db=dB(n.duration),ps=rP(n.pitch,n.chord),v=(n.velocity||100)/127;
ps.forEach(function(p){var mi=typeof p==='string'?n2m(p):p,fr=m2f(mi),ss=sT+nb*bd,ds=db*bd;var o=ctx.createOscillator(),g=ctx.createGain();var wf=['sine','triangle','square','sawtooth'];o.type=wf[ti%4];o.frequency.setValueAtTime(fr,ss);g.gain.setValueAtTime(0,ss);g.gain.linearRampToValueAtTime(v*.3,ss+.02);g.gain.exponentialRampToValueAtTime(.001,ss+ds);o.connect(g);g.connect(ctx.destination);o.start(ss);o.stop(ss+ds+.05);nodes.push(o);if(ss+ds>me)me=ss+ds});
if(n.beat===undefined&&n.startTime===undefined)cb+=db})});
dur=me-sT;playing=true;uP();setTimeout(function(){if(playing)stopP()},(dur+.5)*1000)}
function stopP(){playing=false;if(af)cancelAnimationFrame(af);nodes.forEach(function(n){try{n.stop()}catch(e){}});nodes=[];if(pCb)pCb(0)}
function uP(){if(!playing||!ctx)return;var e=ctx.currentTime-sT,p=Math.min(e/dur,1);if(pCb)pCb(p);if(p<1)af=requestAnimationFrame(uP)}

function render(comp,el){el.innerHTML='';var ts=comp.tracks||[];if(!ts.length){el.innerHTML='<p class="status">No tracks</p>';return}
var mn=127,mx=0,tb=0,rt=ts.map(function(t,ti){var cb=0,ns=t.notes.map(function(n){var b;if(n.beat!==undefined)b=n.beat-1;else if(n.startTime!==undefined)b=n.startTime;else b=cb;var d=dB(n.duration),ps=rP(n.pitch,n.chord);ps.forEach(function(p){var m=typeof p==='string'?n2m(p):p;if(m<mn)mn=m;if(m>mx)mx=m});var e=b+d;if(e>tb)tb=e;if(n.beat===undefined&&n.startTime===undefined)cb+=d;return{b:b,d:d,ps:ps,v:n.velocity||100,ti:ti}});return{name:t.name||'Track '+(ti+1),notes:ns}});
var pr=Math.max(mx-mn+1,12),pd=2,em=mn-pd,er=pr+pd*2,nh=10,bw=60,lm=50,tm=20;var sw=lm+tb*bw+40,sh=tm+er*nh+20;
var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width',sw);svg.setAttribute('height',sh);svg.setAttribute('viewBox','0 0 '+sw+' '+sh);
var dk=window.matchMedia('(prefers-color-scheme:dark)').matches,gc=dk?'#2a2a4a':'#e9ecef',tc=dk?'#aaa':'#666';
for(var i=0;i<=tb;i++){var x=lm+i*bw,l=document.createElementNS('http://www.w3.org/2000/svg','line');l.setAttribute('x1',x);l.setAttribute('y1',tm);l.setAttribute('x2',x);l.setAttribute('y2',sh-20);l.setAttribute('stroke',i%4===0?(dk?'#444':'#adb5bd'):gc);l.setAttribute('stroke-width',i%4===0?'1.5':'0.5');svg.appendChild(l);if(i%4===0){var txt=document.createElementNS('http://www.w3.org/2000/svg','text');txt.setAttribute('x',x);txt.setAttribute('y',sh-5);txt.setAttribute('fill',tc);txt.setAttribute('font-size','9');txt.setAttribute('text-anchor','middle');txt.textContent=Math.floor(i/4)+1;svg.appendChild(txt)}}
for(var p=em;p<=em+er;p++){if(p%12===0){var y=tm+(em+er-p)*nh;var t2=document.createElementNS('http://www.w3.org/2000/svg','text');t2.setAttribute('x',lm-5);t2.setAttribute('y',y+4);t2.setAttribute('fill',tc);t2.setAttribute('font-size','9');t2.setAttribute('text-anchor','end');t2.textContent='C'+(Math.floor(p/12)-1);svg.appendChild(t2);var l2=document.createElementNS('http://www.w3.org/2000/svg','line');l2.setAttribute('x1',lm);l2.setAttribute('y1',y);l2.setAttribute('x2',sw-40);l2.setAttribute('y2',y);l2.setAttribute('stroke',gc);l2.setAttribute('stroke-width','0.5');svg.appendChild(l2)}}
var cs=['#4361ee','#e63946','#06d6a0','#ff9f1c','#9d4edd','#118ab2','#ef476f','#ffd166'];
rt.forEach(function(t,ti){var c=cs[ti%8];t.notes.forEach(function(n){n.ps.forEach(function(p){var m=typeof p==='string'?n2m(p):p,x=lm+n.b*bw,w=Math.max(n.d*bw-2,4),y=tm+(em+er-m)*nh-nh/2;var r=document.createElementNS('http://www.w3.org/2000/svg','rect');r.setAttribute('x',x);r.setAttribute('y',y);r.setAttribute('width',w);r.setAttribute('height',nh-1);r.setAttribute('rx','2');r.setAttribute('fill',c);r.setAttribute('opacity',0.4+(n.v/127)*0.6);svg.appendChild(r)})})});
el.appendChild(svg)}

var curComp=null,bp=document.getElementById('bp'),bs=document.getElementById('bs'),pf=document.getElementById('pf'),nd=document.getElementById('notation'),tl=document.getElementById('tl'),td=document.getElementById('td'),st=document.getElementById('st'),dl=document.getElementById('dl'),ti=document.getElementById('title');
pCb=function(p){pf.style.width=(p*100)+'%';if(p>=1){bp.disabled=false;bs.disabled=true}};
bp.onclick=function(){if(curComp){playC(curComp);bp.disabled=true;bs.disabled=false}};
bs.onclick=function(){stopP();bp.disabled=false;bs.disabled=true;pf.style.width='0%'};

function load(comp,midi){try{curComp=comp;render(comp,nd);tl.innerHTML='';(comp.tracks||[]).forEach(function(t,i){var d=document.createElement('div');d.className='track-info';var nm=t.name||'Track '+(i+1),ins=t.instrument!==undefined?' (GM:'+t.instrument+')':'',nc=t.notes?t.notes.length:0;d.innerHTML='<span class="tn">'+nm+'</span><span class="td">'+ins+' - '+nc+' notes</span>';tl.appendChild(d)});td.textContent=(comp.bpm||120)+' BPM';bp.disabled=false;st.textContent='Ready to play';if(midi){dl.href='data:audio/midi;base64,'+midi;dl.style.display='inline-block'}}catch(e){nd.innerHTML='<p class="error">Error: '+e.message+'</p>'}}

if(EC)load(EC,EM);
else{nd.innerHTML='<p class="status">No MIDI data yet. Use the create_midi tool first, then refresh.</p>'}
</script>
</body>
</html>`;
}
