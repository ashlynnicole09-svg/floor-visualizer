/* Floor Visualizer — pure static app using WebGL for perspective‑correct tiling.
 * Features:
 *  - Upload room photo
 *  - Click 4 corners of floor (clockwise), drag handles to refine
 *  - Upload/select texture (auto power‑of‑two resize for GL REPEAT)
 *  - Measure known distance to set pixels-per-inch
 *  - Adjust plank size, angle, opacity, exposure, contrast
 *  - Export PNG, Save/Load session (JSON)
 */

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
const chkSeamless = $("#chkSeamless");
const textureGrid = $("#textureGrid");
const btnExportImage = $("#btnExportImage");
const btnLoadDemo = $("#btnLoadDemo");
const btnFit = $("#btnFit");
const btn1x = $("#btn1x");
const btnSaveConfig = $("#btnSaveConfig");
const btnLoadConfig = $("#btnLoadConfig");
const btnLoadConfigProxy = $("#btnLoadConfigProxy");
const repoLink = $("#repoLink");
$("#year").textContent = new Date().getFullYear();

repoLink.textContent = location.hostname.includes("github.io") ? "View Source" : "GitHub Pages Help";
repoLink.href = location.hostname.includes("github.io")
  ? "https://github.com"
  : "https://docs.github.com/en/pages/quickstart";

// State
let points = []; // [{x,y}, ... 4]
let dragging = null; // index
let measuring = false;
let measurePts = null; // [{x,y},{x,y}]
let ppi = null; // pixels per inch

// WebGL setup
let gl, program, posBuffer, uvBuffer, tex, texSize = 512;
let currentTextureImage = null;
let uniforms = {};
let vao = null;

// Demo textures to list
const DEMO_TEXTURES = [
  { name: "Oak Light", src: "assets/textures/oak_light.png" },
  { name: "Oak Warm", src: "assets/textures/oak_warm.png" },
  { name: "Walnut Dark", src: "assets/textures/walnut_dark.png" },
  { name: "Stone Grey", src: "assets/textures/stone_grey.png" }
];

// Build the texture grid
function buildTextureGrid() {
  DEMO_TEXTURES.forEach((t, i) => {
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

// Utility
function loadImage(srcOrFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
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
  // keep overlay positioned
  const rect = roomImg.getBoundingClientRect();
}

function fitImage() {
  // make the image fit container width
  stage.scrollTop = 0;
  stage.scrollLeft = 0;
  roomImg.style.maxWidth = "100%";
}

function oneToOne() {
  roomImg.style.maxWidth = `${roomImg.naturalWidth}px`;
}

// WebGL helpers
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    throw new Error("Shader compile error");
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    throw new Error("Program link error");
  }
  return prog;
}

function initGL() {
  gl = glCanvas.getContext("webgl");
  if (!gl) {
    alert("WebGL not supported in this browser.");
    return;
  }
  const vs = `
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform vec2 u_resolution;
varying vec2 v_uv;
void main() {
  // convert from pixels to clipspace
  vec2 zeroToOne = a_pos / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clip = zeroToTwo - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_uv = a_uv;
}`;
  const fs = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_opacity;
uniform float u_exposure;
uniform float u_contrast;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  // simple exposure/contrast
  c.rgb *= u_exposure;
  c.rgb = (c.rgb - 0.5) * u_contrast + 0.5;
  gl_FragColor = vec4(c.rgb, u_opacity);
}`;
  program = createProgram(gl, vs, fs);
  gl.useProgram(program);
  // Look up locations
  uniforms.resolution = gl.getUniformLocation(program, "u_resolution");
  uniforms.opacity = gl.getUniformLocation(program, "u_opacity");
  uniforms.exposure = gl.getUniformLocation(program, "u_exposure");
  uniforms.contrast = gl.getUniformLocation(program, "u_contrast");

  const a_pos = gl.getAttribLocation(program, "a_pos");
  const a_uv = gl.getAttribLocation(program, "a_uv");

  posBuffer = gl.createBuffer();
  uvBuffer = gl.createBuffer();

  gl.enableVertexAttribArray(a_pos);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

  gl.enableVertexAttribArray(a_uv);
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);

  // texture
  tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // initialize with 1x1
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200,200,200,255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function uploadTexture(image) {
  // ensure power-of-two by drawing into canvas
  const pot = (n) => 2**Math.round(Math.log2(n));
  const size = Math.max(64, Math.min(2048, pot(Math.max(image.width, image.height))));
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  // fill by tiling the image to reduce stretching
  const pattern = ctx.createPattern(image, "repeat");
  ctx.fillStyle = pattern;
  ctx.fillRect(0,0,size,size);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  texSize = size;
}

function setTexture(image) {
  currentTextureImage = image;
  uploadTexture(image);
  render();
}

function avg(a,b){return (a+b)*0.5;}

function computeGeometryAndUV() {
  if (points.length !== 4) return null;
  // positions (two triangles) p0->p1->p2->p3 clockwise
  const p0 = points[0], p1 = points[1], p2 = points[2], p3 = points[3];

  // Approximate "plane width" as average of top & bottom edge lengths
  const edgeLen = (pA, pB) => Math.hypot(pB.x - pA.x, pB.y - pA.y);
  const widthPx = avg(edgeLen(p0,p1), edgeLen(p3,p2));
  const heightPx = avg(edgeLen(p1,p2), edgeLen(p0,p3));

  // Pixels per inch
  const ppiVal = ppi || 50; // default fallback
  const plankLenPx = (parseFloat(plankLen.value)||48) * ppiVal;
  const plankWidPx = (parseFloat(plankWid.value)||7) * ppiVal;

  // repeats across quad
  const repeatsU = Math.max(1.0, widthPx / Math.max(8, plankLenPx));
  const repeatsV = Math.max(1.0, heightPx / Math.max(8, plankWidPx));

  // angle in radians applied in UV space
  const theta = (parseFloat(angle.value)||0) * Math.PI/180;

  // base UVs before rotation
  let u0=0, v0=0;
  let u1=repeatsU, v1=0;
  let u2=repeatsU, v2=repeatsV;
  let u3=0, v3=repeatsV;

  // rotate UVs around center
  const cx = repeatsU*0.5, cy = repeatsV*0.5;
  function rot(u,v){
    const x=u-cx, y=v-cy;
    const ru = x*Math.cos(theta)-y*Math.sin(theta)+cx;
    const rv = x*Math.sin(theta)+y*Math.cos(theta)+cy;
    return [ru,rv];
  }
  [u0,v0]=rot(u0,v0);
  [u1,v1]=rot(u1,v1);
  [u2,v2]=rot(u2,v2);
  [u3,v3]=rot(u3,v3);

  // Interleave into two triangles (0,1,2) and (0,2,3)
  const pos = new Float32Array([
    p0.x,p0.y,  p1.x,p1.y,  p2.x,p2.y,
    p0.x,p0.y,  p2.x,p2.y,  p3.x,p3.y
  ]);
  const uv = new Float32Array([
    u0,v0,  u1,v1,  u2,v2,
    u0,v0,  u2,v2,  u3,v3
  ]);

  return { pos, uv };
}

function render() {
  if (!gl || points.length!==4) {
    // draw guides only
    drawGuides();
    return;
  }
  gl.viewport(0,0,glCanvas.width, glCanvas.height);
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.uniform2f(uniforms.resolution, glCanvas.width, glCanvas.height);
  gl.uniform1f(uniforms.opacity, (parseFloat(opacity.value)||90) / 100.0);
  gl.uniform1f(uniforms.exposure, (parseFloat(exposure.value)||100) / 100.0);
  gl.uniform1f(uniforms.contrast, (parseFloat(contrast.value)||100) / 100.0);

  const geo = computeGeometryAndUV();
  if (!geo) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geo.uv, gl.DYNAMIC_DRAW);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  drawGuides();
}

// Draw guides/handles using SVG
function drawGuides() {
  if (points.length===0) {
    floorPoly.setAttribute("points","");
    handlesG.innerHTML="";
    return;
  }
  const ptsStr = points.map(p => `${p.x},${p.y}`).join(" ");
  floorPoly.setAttribute("points", ptsStr);
  floorPoly.style.display = chkGuides.checked ? "block" : "none";
  handlesG.innerHTML = "";
  if (!chkGuides.checked) return;
  points.forEach((p,i)=>{
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", p.x);
    c.setAttribute("cy", p.y);
    c.setAttribute("data-idx", i);
    handlesG.appendChild(c);
  });
}

function stageCoord(evt) {
  const rect = glCanvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (glCanvas.width / rect.width);
  const y = (evt.clientY - rect.top) * (glCanvas.height / rect.height);
  return {x,y};
}

// Event handling for placing points and dragging
overlay.addEventListener("mousedown", (e)=>{
  const pt = stageCoord(e);
  if (measuring) {
    if (!measurePts) {
      measurePts = [pt];
      measureLine.classList.remove("hidden");
      measureLine.setAttribute("x1", pt.x); measureLine.setAttribute("y1", pt.y);
      measureLine.setAttribute("x2", pt.x); measureLine.setAttribute("y2", pt.y);
    } else if (measurePts.length===1) {
      measurePts.push(pt);
      measureLine.setAttribute("x2", pt.x); measureLine.setAttribute("y2", pt.y);
      measuring = false;
    }
    return;
  }
  // Check if dragging handle
  const idx = nearestHandle(pt, 12);
  if (idx !== -1) {
    dragging = idx;
    return;
  }
  // Add point (limit to 4)
  if (points.length<4) {
    points.push(pt);
    if (points.length===4) render();
    else drawGuides();
  }
});

overlay.addEventListener("mousemove", (e)=>{
  const pt = stageCoord(e);
  if (dragging!=null) {
    points[dragging] = pt;
    render();
  } else if (measuring && measurePts && measurePts.length===1) {
    measureLine.setAttribute("x2", pt.x); measureLine.setAttribute("y2", pt.y);
  }
});

window.addEventListener("mouseup", ()=>{ dragging = null; });

function nearestHandle(pt, maxDist=10) {
  let best = -1, bestD = maxDist;
  points.forEach((p,i)=>{
    const d = Math.hypot(p.x-pt.x, p.y-pt.y);
    if (d < bestD) { best=i; bestD=d; }
  });
  return best;
}

// Controls
btnResetPoints.addEventListener("click", ()=>{
  points = [];
  measurePts = null;
  measureLine.classList.add("hidden");
  drawGuides();
  render();
});

btnMeasure.addEventListener("click", ()=>{
  measuring = true;
  measurePts = null;
  measureLine.classList.add("hidden");
});

btnSetScale.addEventListener("click", ()=>{
  if (!measurePts || measurePts.length!==2) {
    alert("Draw a measurement line first (click start and end).");
    return;
  }
  const px = Math.hypot(measurePts[1].x - measurePts[0].x, measurePts[1].y - measurePts[0].y);
  const inches = parseFloat(knownDistance.value||0);
  if (!inches || inches<=0) { alert("Enter a valid inch value."); return; }
  ppi = px / inches;
  ppiOut.textContent = `PPI: ${ppi.toFixed(2)}`;
  render();
});

chkGuides.addEventListener("change", drawGuides);

[plankLen, plankWid, angle, opacity, exposure, contrast].forEach(inp=>{
  inp.addEventListener("input", render);
});

texInput.addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  const img = await loadImage(file);
  setTexture(img);
});

btnExportImage.addEventListener("click", exportPNG);

function exportPNG() {
  if (!roomImg.src) { alert("Upload a room photo first."); return; }
  const out = document.createElement("canvas");
  out.width = roomImg.naturalWidth;
  out.height = roomImg.naturalHeight;
  const ctx = out.getContext("2d");
  // draw photo
  ctx.drawImage(roomImg, 0, 0, out.width, out.height);
  // draw webgl content
  ctx.drawImage(glCanvas, 0, 0);
  const url = out.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = "floor-visualizer.png";
  a.click();
}

btnLoadDemo.addEventListener("click", async ()=>{
  // a simple included demo room (base64 tiny) — we will embed a placeholder data URL (solid dark gradient)
  // Using a generated gradient image for demo
  const demo = new Image();
  demo.onload = ()=>{
    roomImg.src = demo.src;
    roomImg.onload = ()=>{
      setCanvasSizeToImage();
      fitImage();
      // set 4 default points (a trapezoid)
      const w = roomImg.naturalWidth, h = roomImg.naturalHeight;
      points = [
        {x: w*0.18, y: h*0.72},
        {x: w*0.82, y: h*0.72},
        {x: w*0.98, y: h*0.98},
        {x: w*0.02, y: h*0.98}
      ];
      drawGuides();
      render();
    };
  };
  // Create gradient image dynamically
  const c = document.createElement("canvas");
  c.width = 1400; c.height = 900;
  const gctx = c.getContext("2d");
  const grad = gctx.createLinearGradient(0,0,0,c.height);
  grad.addColorStop(0, "#2b3545");
  grad.addColorStop(0.5, "#222b38");
  grad.addColorStop(1, "#1a2230");
  gctx.fillStyle = grad; gctx.fillRect(0,0,c.width,c.height);
  // draw "wall"
  gctx.fillStyle="#3a4454";
  gctx.fillRect(0,0,c.width, c.height*0.6);
  // draw "floor" as plain to visualize
  gctx.fillStyle="#2a2f3a"; gctx.fillRect(0, c.height*0.6, c.width, c.height*0.4);
  demo.src = c.toDataURL("image/png");
});

btnFit.addEventListener("click", fitImage);
btn1x.addEventListener("click", oneToOne);

btnSaveConfig.addEventListener("click", ()=>{
  if (!roomImg.src || points.length!==4) { alert("Need a room photo and 4 points first."); return; }
  const cfg = {
    points, ppi, controls: {
      plankLen: plankLen.value, plankWid: plankWid.value, angle: angle.value,
      opacity: opacity.value, exposure: exposure.value, contrast: contrast.value
    }
  };
  const blob = new Blob([JSON.stringify(cfg, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "floor-visualizer-session.json"; a.click();
});

btnLoadConfigProxy.addEventListener("click", ()=> btnLoadConfig.click());
btnLoadConfig.addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const cfg = JSON.parse(text);
    if (cfg.points && cfg.points.length===4) {
      points = cfg.points;
    }
    ppi = cfg.ppi || ppi;
    if (ppi) ppiOut.textContent = `PPI: ${ppi.toFixed(2)}`;
    if (cfg.controls) {
      for (const k of ["plankLen","plankWid","angle","opacity","exposure","contrast"]) {
        if (cfg.controls[k]!=null) (eval(k)).value = cfg.controls[k];
      }
    }
    drawGuides(); render();
  } catch(err) {
    alert("Invalid session file.");
  }
});

roomInput.addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  const img = await loadImage(file);
  roomImg.src = img.src;
  roomImg.onload = ()=>{
    setCanvasSizeToImage();
    fitImage();
    render();
  };
});

window.addEventListener("resize", ()=>{
  // keep overlay size in sync (SVG is viewBox-based so OK); WebGL canvas is fixed to image size
});

// Initialize
initGL();
drawGuides();
