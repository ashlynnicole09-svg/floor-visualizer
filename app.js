
// --- bootguard v4.1 ---
(function(){
  function write(id, msg){ try{ var el=document.getElementById(id); if(el) el.textContent = msg; }catch(e){} }
  function ready(fn){ if(document.readyState === 'complete' || document.readyState === 'interactive'){ setTimeout(fn, 0); } else { document.addEventListener('DOMContentLoaded', fn); } }
  ready(function(){
    write('status','booting…');
    try {
      // proceed to original app.js below
/* v4-full: WebGL + HUD + debug export */
const $ = (s, d=document) => d.querySelector(s);
const $$ = (s, d=document) => [...d.querySelectorAll(s)];
const version = "v4-full";

const roomInput = $("#roomInput");
const roomImg = $("#roomImg");
const stage = $("#stage");
const overlay = $("#overlay");
const glCanvas = $("#glCanvas");
const floorPoly = $("#floorPoly");
const handlesG = $("#handles");
const measureLine = $("#measureLine");
const btnResetPoints = $("#btnResetPoints");
const btnMeasure = $("#btnMeasure");
const knownDistance = $("#knownDistance");
const btnSetScale = $("#btnSetScale");
const ppiOut = $("#ppiOut");
const chkGuides = $("#chkGuides");
const plankLen = $("#plankLen");
const plankWid = $("#plankWid");
const angle = $("#angle");
const opacity = $("#opacity");
const exposure = $("#exposure");
const contrast = $("#contrast");
const texInput = $("#texInput");
const textureGrid = $("#textureGrid");
const btnExportImage = $("#btnExportImage");
const btnLoadDemo = $("#btnLoadDemo");
const btnFit = $("#btnFit");
const btn1x = $("#btn1x");
const btnSaveConfig = $("#btnSaveConfig");
const btnLoadConfig = $("#btnLoadConfig");
const btnLoadConfigProxy = $("#btnLoadConfigProxy");
const btnAutoFloor = $("#btnAutoFloor");
const btnCopyDebug = $("#btnCopyDebug");
const btnDownloadDebug = $("#btnDownloadDebug");
const statusEl = $("#status");
const roomLoadedTxt = $("#roomLoadedTxt");
const glTxt = $("#glTxt");
const pointsTxt = $("#pointsTxt");
const canvasTxt = $("#canvasTxt");
const imgTxt = $("#imgTxt");
const lastEvtTxt = $("#lastEvtTxt");
const logEl = $("#log");
$("#year").textContent = new Date().getFullYear();

let roomLoaded = false;
function setButtonsEnabled(on){
  [btnExportImage,btnSaveConfig,btnLoadConfigProxy,btnResetPoints,btnMeasure,btnSetScale,btnAutoFloor].forEach(b=> b.disabled=!on);
}

let points = [];
let dragging = null;
let measuring = false;
let measurePts = null;
let ppi = null;

let gl, program, posBuffer, uvBuffer, tex;

const DEMO_TEXTURES = [
  { name: "Oak Light", src: "assets/textures/oak_light.png" },
  { name: "Oak Warm", src: "assets/textures/oak_warm.png" },
  { name: "Walnut Dark", src: "assets/textures/walnut_dark.png" }
];
function buildTextureGrid() {
  DEMO_TEXTURES.forEach((t) => {
    const div = document.createElement("div");
    div.className = "tex";
    div.title = t.name;
    const img = document.createElement("img");
    img.src = t.src;
    div.appendChild(img);
    div.addEventListener("click", async () => {
      $$(".texture-grid .tex").forEach(el => el.classList.remove("active"));
      div.classList.add("active");
      const image = await loadImage(t.src);
      setTexture(image);
    });
    textureGrid.appendChild(div);
  });
}
buildTextureGrid();

const dbg = {
  events: [],
  logs: [],
  snapshot() {
    return {
      version,
      roomLoaded,
      points,
      img: { w: roomImg.naturalWidth||0, h: roomImg.naturalHeight||0 },
      canvas: { w: glCanvas.width||0, h: glCanvas.height||0 },
      gl: !!gl,
      ua: navigator.userAgent,
      ts: Date.now()
    };
  }
};
function pushLog(msg){ const line = `[${new Date().toLocaleTimeString()}] ${msg}`; dbg.logs.push(line); logEl.textContent = dbg.logs.slice(-200).join("\\n"); }

function logStatus() {
  statusEl.textContent = `ok (${version})`;
  roomLoadedTxt.textContent = String(roomLoaded);
  glTxt.textContent = gl ? "ready" : "no-webgl";
  pointsTxt.textContent = String(points.length);
  canvasTxt.textContent = `${glCanvas.width}×${glCanvas.height}`;
  imgTxt.textContent = `${roomImg.naturalWidth||0}×${roomImg.naturalHeight||0}`;
}

function loadImage(srcOrFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => { pushLog("Image load error"); reject(e); };
    if (srcOrFile instanceof File) {
      const url = URL.createObjectURL(srcOrFile);
      img.src = url;
    } else {
      img.src = srcOrFile;
    }
  });
}

function setCanvasSizeToImage() {
  if (!roomImg.naturalWidth || !roomImg.naturalHeight) return;
  glCanvas.width = roomImg.naturalWidth;
  glCanvas.height = roomImg.naturalHeight;
  overlay.setAttribute("viewBox", `0 0 ${roomImg.naturalWidth} ${roomImg.naturalHeight}`);
  overlay.setAttribute("width", roomImg.naturalWidth);
  overlay.setAttribute("height", roomImg.naturalHeight);
  logStatus();
}

function fitImage() { stage.scrollTop = 0; stage.scrollLeft = 0; roomImg.style.maxWidth = "100%"; }
function oneToOne() { roomImg.style.maxWidth = `${roomImg.naturalWidth}px`; }

function initGL() {
  try {
    gl = glCanvas.getContext("webgl");
    if (!gl) { glTxt.textContent = "webgl-unavailable"; alert("WebGL not supported."); return; }
    const vs = `attribute vec2 a_pos;attribute vec2 a_uv;uniform vec2 u_resolution;varying vec2 v_uv;void main(){vec2 z=a_pos/u_resolution;vec2 clip=z*2.0-1.0;gl_Position=vec4(clip*vec2(1.0,-1.0),0.0,1.0);v_uv=a_uv;}`;
    const fs = `precision mediump float;uniform sampler2D u_tex;uniform float u_opacity;uniform float u_exposure;uniform float u_contrast;varying vec2 v_uv;void main(){vec4 c=texture2D(u_tex,v_uv);c.rgb*=u_exposure;c.rgb=(c.rgb-0.5)*u_contrast+0.5;gl_FragColor=vec4(c.rgb,u_opacity);}`;
    function makeShader(t,src){const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);return s;}
    const prog=gl.createProgram(), vsO=makeShader(gl.VERTEX_SHADER,vs), fsO=makeShader(gl.FRAGMENT_SHADER,fs);
    gl.attachShader(prog,vsO);gl.attachShader(prog,fsO);gl.linkProgram(prog);
    program=prog;
    const a_pos=gl.getAttribLocation(program,"a_pos"), a_uv=gl.getAttribLocation(program,"a_uv");
    posBuffer=gl.createBuffer(); uvBuffer=gl.createBuffer();
    gl.enableVertexAttribArray(a_pos); gl.bindBuffer(gl.ARRAY_BUFFER,posBuffer); gl.vertexAttribPointer(a_pos,2,gl.FLOAT,false,0,0);
    gl.enableVertexAttribArray(a_uv);  gl.bindBuffer(gl.ARRAY_BUFFER,uvBuffer);  gl.vertexAttribPointer(a_uv,2,gl.FLOAT,false,0,0);
    window._u={res:gl.getUniformLocation(prog,"u_resolution"), op:gl.getUniformLocation(prog,"u_opacity"), ex:gl.getUniformLocation(prog,"u_exposure"), ct:gl.getUniformLocation(prog,"u_contrast")};
    tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([200,200,200,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  } catch (e) { pushLog("GL init error: " + e.message); alert("WebGL init failed."); }
  logStatus();
}

function uploadTexture(image){
  try {
    const pot=n=>2**Math.round(Math.log2(n));
    const size=Math.max(64,Math.min(2048,pot(Math.max(image.width,image.height))));
    const c=document.createElement("canvas"); c.width=c.height=size;
    const ctx=c.getContext("2d"); const pattern=ctx.createPattern(image,"repeat");
    ctx.fillStyle=pattern; ctx.fillRect(0,0,size,size);
    gl.bindTexture(gl.TEXTURE_2D,tex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c); gl.generateMipmap(gl.TEXTURE_2D);
  } catch(e){ pushLog("uploadTexture error: " + e.message); }
}
function setTexture(image){ uploadTexture(image); render(); }

function avg(a,b){return (a+b)*0.5;}
function computeGeometryAndUV(){
  if(points.length!==4) return null;
  const [p0,p1,p2,p3]=points;
  const edge=(A,B)=>Math.hypot(B.x-A.x,B.y-A.y);
  const widthPx=avg(edge(p0,p1),edge(p3,p2)), heightPx=avg(edge(p1,p2),edge(p0,p3));
  const ppiVal=ppi||50; const plankLenPx=(parseFloat(plankLen.value)||48)*ppiVal; const plankWidPx=(parseFloat(plankWid.value)||7)*ppiVal;
  const repeatsU=Math.max(1.0,widthPx/Math.max(8,plankLenPx)); const repeatsV=Math.max(1.0,heightPx/Math.max(8,plankWidPx));
  const theta=(parseFloat(angle.value)||0)*Math.PI/180;
  let u0=0,v0=0,u1=repeatsU,v1=0,u2=repeatsU,v2=repeatsV,u3=0,v3=repeatsV;
  const cx=repeatsU*0.5, cy=repeatsV*0.5, rot=(u,v)=>{const x=u-cx,y=v-cy;return [x*Math.cos(theta)-y*Math.sin(theta)+cx,x*Math.sin(theta)+y*Math.cos(theta)+cy];};
  [u0,v0]=rot(u0,v0); [u1,v1]=rot(u1,v1); [u2,v2]=rot(u2,v2); [u3,v3]=rot(u3,v3);
  const pos=new Float32Array([p0.x,p0.y,p1.x,p1.y,p2.x,p2.y,p0.x,p0.y,p2.x,p2.y,p3.x,p3.y]);
  const uv=new Float32Array([u0,v0,u1,v1,u2,v2,u0,v0,u2,v2,u3,v3]);
  return {pos,uv};
}
function render(){
  logStatus();
  if(!gl || points.length!==4){ drawGuides(); return; }
  gl.viewport(0,0,glCanvas.width,glCanvas.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.uniform2f(window._u.res,glCanvas.width,glCanvas.height);
  gl.uniform1f(window._u.op,(parseFloat(opacity.value)||90)/100.0);
  gl.uniform1f(window._u.ex,(parseFloat(exposure.value)||100)/100.0);
  gl.uniform1f(window._u.ct,(parseFloat(contrast.value)||100)/100.0);
  const geo=computeGeometryAndUV(); if(!geo) return;
  const a_pos=gl.getAttribLocation(program,"a_pos"); const a_uv=gl.getAttribLocation(program,"a_uv");
  gl.bindBuffer(gl.ARRAY_BUFFER,posBuffer); gl.bufferData(gl.ARRAY_BUFFER,geo.pos,gl.DYNAMIC_DRAW); gl.vertexAttribPointer(a_pos,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,uvBuffer);  gl.bufferData(gl.ARRAY_BUFFER,geo.uv, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(a_uv, 2,gl.FLOAT,false,0,0);
  gl.drawArrays(gl.TRIANGLES,0,6);
  drawGuides();
}
function drawGuides(){
  const ptsStr = points.map(p=>`${p.x},${p.y}`).join(" ");
  floorPoly.setAttribute("points",ptsStr);
  handlesG.innerHTML="";
  points.forEach((p,i)=>{
    const c=document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx",p.x); c.setAttribute("cy",p.y); c.setAttribute("data-idx",i); handlesG.appendChild(c);
  });
}

function stageCoord(e){
  const rect = glCanvas.getBoundingClientRect();
  const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
  const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);
  const x = (clientX - rect.left) * (glCanvas.width / Math.max(1,rect.width));
  const y = (clientY - rect.top) * (glCanvas.height / Math.max(1,rect.height));
  return {x,y};
}
function nearestHandle(pt, maxDist=16){
  let best=-1,bestD=maxDist;
  points.forEach((p,i)=>{const d=Math.hypot(p.x-pt.x,p.y-pt.y); if(d<bestD){best=i; bestD=d;}});
  return best;
}

// HUD dots to visualize pointer events
function dotFromClient(clientX, clientY, color){
  const sRect = stage.getBoundingClientRect();
  const x = clientX - sRect.left, y = clientY - sRect.top;
  const d=document.createElement("div"); d.style.cssText=`position:absolute;left:${x-3}px;top:${y-3}px;width:6px;height:6px;border-radius:50%;background:${color};opacity:.9;z-index:5;pointer-events:none`;
  stage.appendChild(d); setTimeout(()=>d.remove(), 1200);
}

function onPointerDown(e){
  const pt=stageCoord(e);
  lastEvtTxt.textContent = `down @ ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  dbg.events.push({type:"down",pt,ts:Date.now()}); dotFromClient(e.clientX, e.clientY, "#5cff76"); // green
  if(!roomLoaded){ alert("Upload a room photo first."); return; }
  if(measuring){
    if(!measurePts){ measurePts=[pt]; measureLine.classList.remove("hidden"); measureLine.setAttribute("x1",pt.x); measureLine.setAttribute("y1",pt.y); measureLine.setAttribute("x2",pt.x); measureLine.setAttribute("y2",pt.y); }
    else if(measurePts.length===1){ measurePts.push(pt); measureLine.setAttribute("x2",pt.x); measureLine.setAttribute("y2",pt.y); measuring=false; }
    return;
  }
  const idx=nearestHandle(pt,16);
  if(idx!==-1){ dragging=idx; overlay.setPointerCapture && overlay.setPointerCapture(e.pointerId||0); return; }
  if(points.length<4){ points.push(pt); render(); }
}
function onPointerMove(e){
  const pt=stageCoord(e);
  lastEvtTxt.textContent = `move @ ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  if(dragging==null && !(measuring && measurePts && measurePts.length===1)) return;
  dbg.events.push({type:"move",pt,ts:Date.now()}); dotFromClient(e.clientX, e.clientY, "#ffd966"); // yellow
  if(dragging!=null){ points[dragging]=pt; render(); }
  else if(measuring && measurePts && measurePts.length===1){ measureLine.setAttribute("x2",pt.x); measureLine.setAttribute("y2",pt.y); }
}
function onPointerUp(e){
  const pt=stageCoord(e);
  lastEvtTxt.textContent = `up @ ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  dbg.events.push({type:"up",pt,ts:Date.now()});
  if(dragging!=null){ dragging=null; overlay.releasePointerCapture && overlay.releasePointerCapture(e.pointerId||0); }
}
overlay.addEventListener("pointerdown", onPointerDown);
overlay.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

// Enable UI after load
function enableUIAfterLoad(){
  roomLoaded = true;
  setButtonsEnabled(true);
  setCanvasSizeToImage();
  fitImage();
  logStatus();
  pushLog("Photo loaded");
}
roomInput.addEventListener("change", async (e)=>{
  const f=e.target.files[0]; if(!f) return;
  try {
    const img=await loadImage(f);
    roomImg.src=img.src;
    roomImg.onload = enableUIAfterLoad;
  } catch(e) { pushLog("roomInput load error"); }
});

// Drag & Drop
["dragenter","dragover"].forEach(ev=> stage.addEventListener(ev, e=>{ e.preventDefault(); stage.classList.add("dragover"); }));
["dragleave","drop"].forEach(ev=> stage.addEventListener(ev, e=>{ e.preventDefault(); stage.classList.remove("dragover"); }));
stage.addEventListener("drop", async (e)=>{
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if(!f) return;
  const img = await loadImage(f);
  roomImg.src = img.src;
  roomImg.onload = enableUIAfterLoad;
});

// Demo image
btnLoadDemo.addEventListener("click", ()=>{
  const demo=document.createElement("canvas"); demo.width=1400; demo.height=900;
  const g=demo.getContext("2d"); const grad=g.createLinearGradient(0,0,0,demo.height); grad.addColorStop(0,"#2b3545"); grad.addColorStop(0.5,"#222b38"); grad.addColorStop(1,"#1a2230");
  g.fillStyle=grad; g.fillRect(0,0,demo.width,demo.height);
  g.fillStyle="#3a4454"; g.fillRect(0,0,demo.width,demo.height*0.6);
  g.fillStyle="#2a2f3a"; g.fillRect(0,demo.height*0.6,demo.width,demo.height*0.4);
  roomImg.src = demo.toDataURL("image/png");
  roomImg.onload = enableUIAfterLoad;
});

// Texture uploads
texInput.addEventListener("change", async (e)=>{
  const f=e.target.files[0]; if(!f) return; const img=await loadImage(f); setTexture(img);
});

// Buttons
btnResetPoints.addEventListener("click", ()=>{ points=[]; measurePts=null; measureLine.classList.add("hidden"); render(); });
btnMeasure.addEventListener("click", ()=>{ measuring=true; measurePts=null; measureLine.classList.add("hidden"); });
btnSetScale.addEventListener("click", ()=>{
  if(!measurePts || measurePts.length!==2){ alert("Draw a measurement line first."); return; }
  const px = Math.hypot(measurePts[1].x - measurePts[0].x, measurePts[1].y - measurePts[0].y);
  const inches = parseFloat(knownDistance.value||0);
  if(!inches || inches<=0){ alert("Enter inches > 0."); return; }
  ppi = px / inches; ppiOut.textContent = `PPI: ${ppi.toFixed(2)}`; render();
});
btnExportImage.addEventListener("click", ()=>{
  if(!roomLoaded){ alert("Upload a room photo first."); return; }
  const out=document.createElement("canvas"); out.width=roomImg.naturalWidth; out.height=roomImg.naturalHeight;
  const ctx=out.getContext("2d"); ctx.drawImage(roomImg,0,0,out.width,out.height); ctx.drawImage(glCanvas,0,0);
  const a=document.createElement("a"); a.href=out.toDataURL("image/png"); a.download="floor-visualizer.png"; a.click();
});
btnFit.addEventListener("click", fitImage);
btn1x.addEventListener("click", oneToOne);
btnSaveConfig.addEventListener("click", ()=>{
  if(!roomLoaded || points.length!==4){ alert("Need a room photo and 4 points first."); return; }
  const cfg={ points, ppi, controls:{ plankLen: plankLen.value, plankWid: plankWid.value, angle: angle.value, opacity: opacity.value, exposure: exposure.value, contrast: contrast.value } };
  const blob=new Blob([JSON.stringify(cfg,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="floor-visualizer-session.json"; a.click();
});

btnAutoFloor.addEventListener("click", ()=>{
  if(!roomLoaded){ alert("Upload a room photo first."); return; }
  const w=roomImg.naturalWidth, h=roomImg.naturalHeight;
  points=[{x:w*0.18,y:h*0.68},{x:w*0.82,y:h*0.68},{x:w*0.98,y:h*0.98},{x:w*0.02,y:h*0.98}];
  render();
});

// Debug export
btnCopyDebug.addEventListener("click", async ()=>{
  const payload = { ...dbg.snapshot(), logs: dbg.logs, events: dbg.events.slice(-200) };
  const text = JSON.stringify(payload, null, 2);
  try { await navigator.clipboard.writeText(text); alert("Debug copied to clipboard. Paste it here in chat."); }
  catch { alert("Could not copy. Use Download Debug instead."); }
});
btnDownloadDebug.addEventListener("click", ()=>{
  const payload = { ...dbg.snapshot(), logs: dbg.logs, events: dbg.events.slice(-200) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "visualizer-debug.json"; a.click();
});

// WebGL minimal setup at start
let posBuffer, uvBuffer;
function initGLAndStatus(){ initGL(); setButtonsEnabled(false); statusEl.textContent = "ready"; logStatus(); }
initGLAndStatus();

      // end original app.js
      write('status','ok (boot ok)');
      console.log('[visualizer] app.js boot ok');
    } catch(err){
      console.error('[visualizer] boot error:', err);
      write('status','boot error');
      var log = document.getElementById('log');
      if(log){ log.textContent += "\n[boot error] " + (err && err.message ? err.message : String(err)); }
      alert("Visualizer boot error: " + (err && err.message ? err.message : String(err)));
    }
  });
})();
// --- end bootguard ---
