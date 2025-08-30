/* Robust 'room loaded' detection + drag & drop + disabled buttons until ready */
const $ = (s, d=document) => d.querySelector(s);
const $$ = (s, d=document) => [...d.querySelectorAll(s)];

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
const repoLink = $("#repoLink");
const btnAutoFloor = $("#btnAutoFloor");
const btnAIDetect = $("#btnAIDetect");
const statusEl = $("#status");
$("#year").textContent = new Date().getFullYear();

let roomLoaded = false;
function setButtonsEnabled(on){
  [btnExportImage,btnSaveConfig,btnLoadConfigProxy,btnResetPoints,btnMeasure,btnSetScale,btnAutoFloor,btnAIDetect].forEach(b=> b.disabled=!on);
}

repoLink.textContent = location.hostname.includes("github.io") ? "View Source" : "GitHub Pages Help";
repoLink.href = location.hostname.includes("github.io") ? "https://github.com" : "https://docs.github.com/en/pages/quickstart";

let points = [];
let dragging = null;
let measuring = false;
let measurePts = null;
let ppi = null;

let gl, program, posBuffer, uvBuffer, tex;
let currentTextureImage = null;

const DEMO_TEXTURES = [
  { name: "Oak Light", src: "assets/textures/oak_light.png" },
  { name: "Oak Warm", src: "assets/textures/oak_warm.png" },
  { name: "Walnut Dark", src: "assets/textures/walnut_dark.png" },
  { name: "Stone Grey", src: "assets/textures/stone_grey.png" }
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

function loadImage(srcOrFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    if (srcOrFile instanceof File) {
      const url = URL.createObjectURL(srcOrFile);
      img.src = url;
    } else {
      img.src = srcOrFile;
    }
  });
}

function setCanvasSizeToImage() {
  glCanvas.width = roomImg.naturalWidth;
  glCanvas.height = roomImg.naturalHeight;
  overlay.setAttribute("viewBox", `0 0 ${roomImg.naturalWidth} ${roomImg.naturalHeight}`);
  overlay.setAttribute("width", roomImg.naturalWidth);
  overlay.setAttribute("height", roomImg.naturalHeight);
}

function fitImage() { stage.scrollTop = 0; stage.scrollLeft = 0; roomImg.style.maxWidth = "100%"; }
function oneToOne() { roomImg.style.maxWidth = `${roomImg.naturalWidth}px`; }

function initGL() {
  gl = glCanvas.getContext("webgl");
  if (!gl) { alert("WebGL not supported."); return; }
  const vs = `attribute vec2 a_pos;attribute vec2 a_uv;uniform vec2 u_resolution;varying vec2 v_uv;void main(){vec2 z=a_pos/u_resolution;vec2 clip=z*2.0-1.0;gl_Position=vec4(clip*vec2(1.0,-1.0),0.0,1.0);v_uv=a_uv;}`;
  const fs = `precision mediump float;uniform sampler2D u_tex;uniform float u_opacity;uniform float u_exposure;uniform float u_contrast;varying vec2 v_uv;void main(){vec4 c=texture2D(u_tex,v_uv);c.rgb*=u_exposure;c.rgb=(c.rgb-0.5)*u_contrast+0.5;gl_FragColor=vec4(c.rgb,u_opacity);}`;
  function makeShader(t,src){const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPLETE_STATUS)&&!gl.getShaderParameter(s,gl.COMPILE_STATUS))console.warn(gl.getShaderInfoLog(s));return s;}
  const prog=gl.createProgram(), vsO=makeShader(gl.VERTEX_SHADER,vs), fsO=makeShader(gl.FRAGMENT_SHADER,fs);
  gl.attachShader(prog,vsO);gl.attachShader(prog,fsO);gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))console.warn(gl.getProgramInfoLog(prog));gl.useProgram(prog);
  program=prog;
  const a_pos=gl.getAttribLocation(program,"a_pos"), a_uv=gl.getAttribLocation(program,"a_uv");
  posBuffer=gl.createBuffer(); uvBuffer=gl.createBuffer();
  gl.enableVertexAttribArray(a_pos); gl.bindBuffer(gl.ARRAY_BUFFER,posBuffer); gl.vertexAttribPointer(a_pos,2,gl.FLOAT,false,0,0);
  gl.enableVertexAttribArray(a_uv);  gl.bindBuffer(gl.ARRAY_BUFFER,uvBuffer);  gl.vertexAttribPointer(a_uv,2,gl.FLOAT,false,0,0);
  window._u={res:gl.getUniformLocation(program,"u_resolution"), op:gl.getUniformLocation(program,"u_opacity"), ex:gl.getUniformLocation(program,"u_exposure"), ct:gl.getUniformLocation(program,"u_contrast")};
  tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([200,200,200,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
}
function uploadTexture(image){
  const pot=n=>2**Math.round(Math.log2(n));
  const size=Math.max(64,Math.min(2048,pot(Math.max(image.width,image.height))));
  const c=document.createElement("canvas"); c.width=c.height=size;
  const ctx=c.getContext("2d"); const pattern=ctx.createPattern(image,"repeat");
  ctx.fillStyle=pattern; ctx.fillRect(0,0,size,size);
  gl.bindTexture(gl.TEXTURE_2D,tex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c); gl.generateMipmap(gl.TEXTURE_2D);
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
  if(points.length===0){ floorPoly.setAttribute("points",""); handlesG.innerHTML=""; return; }
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
  const x = (clientX - rect.left) * (glCanvas.width / rect.width);
  const y = (clientY - rect.top) * (glCanvas.height / rect.height);
  return {x,y};
}
function nearestHandle(pt, maxDist=16){
  let best=-1,bestD=maxDist;
  points.forEach((p,i)=>{const d=Math.hypot(p.x-pt.x,p.y-pt.y); if(d<bestD){best=i; bestD=d;}});
  return best;
}
function onPointerDown(e){
  if(!roomLoaded){ alert("Upload a room photo first."); return; }
  const pt=stageCoord(e);
  if(measuring){
    if(!measurePts){ measurePts=[pt]; measureLine.classList.remove("hidden"); measureLine.setAttribute("x1",pt.x); measureLine.setAttribute("y1",pt.y); measureLine.setAttribute("x2",pt.x); measureLine.setAttribute("y2",pt.y); }
    else if(measurePts.length===1){ measurePts.push(pt); measureLine.setAttribute("x2",pt.x); measureLine.setAttribute("y2",pt.y); measuring=false; }
    return;
  }
  const idx=nearestHandle(pt,16);
  if(idx!==-1){ dragging=idx; overlay.setPointerCapture && overlay.setPointerCapture(e.pointerId||0); return; }
  if(points.length<4){ points.push(pt); if(points.length===4) render(); else drawGuides(); }
}
function onPointerMove(e){
  if(!roomLoaded) return;
  if(dragging==null && !(measuring && measurePts && measurePts.length===1)) return;
  const pt=stageCoord(e);
  if(dragging!=null){ points[dragging]=pt; render(); }
  else if(measuring && measurePts && measurePts.length===1){ measureLine.setAttribute("x2",pt.x); measureLine.setAttribute("y2",pt.y); }
}
function onPointerUp(e){
  if(dragging!=null){ dragging=null; overlay.releasePointerCapture && overlay.releasePointerCapture(e.pointerId||0); }
}
overlay.addEventListener("pointerdown", onPointerDown);
overlay.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

function enableUIAfterLoad(){
  roomLoaded = true;
  statusEl.textContent = "Photo loaded ✓";
  setButtonsEnabled(true);
  setCanvasSizeToImage();
  fitImage();
}
roomInput.addEventListener("change", async (e)=>{
  const f=e.target.files[0]; if(!f) return;
  const img=await loadImage(f);
  roomImg.src=img.src;
  roomImg.onload = enableUIAfterLoad;
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

// Textures
function setTexture(image){ uploadTexture(image); render(); }
texInput.addEventListener("change", async (e)=>{
  const f=e.target.files[0]; if(!f) return; const img=await loadImage(f); setTexture(img);
});

// Buttons
btnResetPoints.addEventListener("click", ()=>{ points=[]; measurePts=null; measureLine.classList.add("hidden"); drawGuides(); render(); });
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
btnLoadDemo.addEventListener("click", ()=>{
  const demo=document.createElement("canvas"); demo.width=1400; demo.height=900;
  const g=demo.getContext("2d"); const grad=g.createLinearGradient(0,0,0,demo.height); grad.addColorStop(0,"#2b3545"); grad.addColorStop(0.5,"#222b38"); grad.addColorStop(1,"#1a2230");
  g.fillStyle=grad; g.fillRect(0,0,demo.width,demo.height);
  g.fillStyle="#3a4454"; g.fillRect(0,0,demo.width,demo.height*0.6);
  g.fillStyle="#2a2f3a"; g.fillRect(0,demo.height*0.6,demo.width,demo.height*0.4);
  roomImg.src = demo.toDataURL("image/png");
  roomImg.onload = enableUIAfterLoad;
});
btnFit.addEventListener("click", fitImage);
btn1x.addEventListener("click", oneToOne);
btnSaveConfig.addEventListener("click", ()=>{
  if(!roomLoaded || points.length!==4){ alert("Need a room photo and 4 points first."); return; }
  const cfg={ points, ppi, controls:{ plankLen: plankLen.value, plankWid: plankWid.value, angle: angle.value, opacity: opacity.value, exposure: exposure.value, contrast: contrast.value } };
  const blob=new Blob([JSON.stringify(cfg,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="floor-visualizer-session.json"; a.click();
});
btnLoadConfigProxy.addEventListener("click", ()=> btnLoadConfig.click());
btnLoadConfig.addEventListener("change", async (e)=>{
  const file=e.target.files[0]; if(!file) return; const text=await file.text();
  try{ const cfg=JSON.parse(text);
    if(cfg.points && cfg.points.length===4) points=cfg.points;
    ppi = cfg.ppi || ppi; if(ppi) ppiOut.textContent=`PPI: ${ppi.toFixed(2)}`;
    if(cfg.controls) for(const k of ["plankLen","plankWid","angle","opacity","exposure","contrast"]) if(cfg.controls[k]!=null) (eval(k)).value=cfg.controls[k];
    drawGuides(); render();
  }catch{ alert("Invalid session file."); }
});
btnAutoFloor.addEventListener("click", ()=>{
  if(!roomLoaded){ alert("Upload a room photo first."); return; }
  const w=roomImg.naturalWidth, h=roomImg.naturalHeight;
  points=[{x:w*0.18,y:h*0.68},{x:w*0.82,y:h*0.68},{x:w*0.98,y:h*0.98},{x:w*0.02,y:h*0.98}];
  drawGuides(); render();
});
async function detectFloorWithCV(){
  if(!roomLoaded){ alert("Upload a room photo first."); return; }
  if(!window._cvReady || typeof cv==="undefined"){ alert("OpenCV.js not loaded yet."); return; }
  const w=roomImg.naturalWidth, h=roomImg.naturalHeight;
  const scale=Math.min(800/Math.max(w,h),1), dw=Math.max(1,Math.round(w*scale)), dh=Math.max(1,Math.round(h*scale));
  const c=document.createElement("canvas"); c.width=dw; c.height=dh; const ctx=c.getContext("2d"); ctx.drawImage(roomImg,0,0,dw,dh);
  const src=cv.imread(c), gray=new cv.Mat(); cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY,0);
  const blur=new cv.Mat(); cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
  const edges=new cv.Mat(); cv.Canny(blur,edges,50,150);
  const contours=new cv.MatVector(); const hierarchy=new cv.Mat();
  cv.findContours(edges,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
  let best=null, bestScore=-1;
  for(let i=0;i<contours.size();i++){ const cnt=contours.get(i);
    const area=cv.contourArea(cnt); if(area<(dw*dh*0.05)){ cnt.delete(); continue; }
    const rect=cv.boundingRect(cnt); const bottomBias=rect.y+rect.height>=dh*0.6?1:0;
    const peri=cv.arcLength(cnt,true); const approx=new cv.Mat(); cv.approxPolyDP(cnt,approx,0.02*peri,true);
    const verts=approx.rows; const vertexScore=(verts===4)?2:(verts===5?1.4:(verts===6?1.2:1));
    const score=(area/dw/dh)*10*vertexScore + bottomBias*2;
    if(score>bestScore){ if(best) best.delete(); best=approx; bestScore=score; }
    cnt.delete();
  }
  let poly=null;
  if(best && best.rows>=4){
    const pts=[]; for(let i=0;i<best.rows;i++) pts.push({x:best.intPtr(i,0)[0], y:best.intPtr(i,0)[1]});
    const toFull=p=>({x:p.x/scale,y:p.y/scale});
    const tl=toFull(pts.reduce((a,b)=>(a.x+a.y<b.x+b.y)?a:b));
    const br=toFull(pts.reduce((a,b)=>(a.x+a.y>b.x+b.y)?a:b));
    const tr=toFull(pts.reduce((a,b)=>(a.x-b.y>b.x-b.y)?a:b));
    const bl=toFull(pts.reduce((a,b)=>(-a.x+b.y>-b.x+b.y)?a:b));
    poly=[tl,tr,br,bl]; best.delete();
  } else {
    poly=[{x:w*0.18,y:h*0.68},{x:w*0.82,y:h*0.68},{x:w*0.98,y:h*0.98},{x:w*0.02,y:h*0.98}];
  }
  if(poly){ points=poly; drawGuides(); render(); }
  src.delete(); gray.delete(); blur.delete(); edges.delete(); contours.delete(); hierarchy.delete();
}
btnAIDetect.addEventListener("click", detectFloorWithCV);

// Initialize
initGL();
setButtonsEnabled(false);
statusEl.textContent = "Upload a room photo to begin";
