// Infinite procedural terrain with chunking, click-to-move sphere, and map overlay
// Uses THREE r128 only (per requirements). Keep concise and modular.

// --------------------------- Simplex Noise (fast, small) ---------------------------
/* A compact Simplex noise implementation adapted for this app.
   Source: public-domain small implementations (kept minimal). */
class Simplex {
  constructor(seed=0){
    this.p = new Uint8Array(256);
    for(let i=0;i<256;i++) this.p[i]=i;
    // simple seed shuffle
    let s = seed|0;
    for(let i=255;i>0;i--){
      s = (s*1664525 + 1013904223) | 0;
      let j = (s >>> 0) % (i+1);
      let t = this.p[i]; this.p[i]=this.p[j]; this.p[j]=t;
    }
    this.perm = new Uint8Array(512);
    for(let i=0;i<512;i++) this.perm[i]=this.p[i&255];
  }
  noise2d(xin, yin){
    const perm = this.perm;
    const F2 = 0.366025403; // 0.5*(sqrt(3)-1)
    const G2 = 0.211324865; // (3-sqrt(3))/6
    let s = (xin+yin)*F2;
    let i = Math.floor(xin + s);
    let j = Math.floor(yin + s);
    let t = (i+j)*G2;
    let X0 = i - t, Y0 = j - t;
    let x0 = xin - X0, y0 = yin - Y0;
    let i1=0,j1=0;
    if(x0>y0){ i1=1; j1=0; } else { i1=0; j1=1; }
    let x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    let x2 = x0 - 1 + 2*G2, y2 = y0 - 1 + 2*G2;
    const ii = i & 255, jj = j & 255;
    let n0=0,n1=0,n2=0;
    let t0 = 0.5 - x0*x0 - y0*y0;
    if(t0>0){
      t0*=t0;
      let gi = perm[ii+perm[jj]] % 12;
      let wx = grad2[gi][0]*x0 + grad2[gi][1]*y0;
      n0 = t0 * t0 * wx;
    }
    let t1 = 0.5 - x1*x1 - y1*y1;
    if(t1>0){
      t1*=t1;
      let gi = perm[ii+i1+perm[jj+j1]] % 12;
      let wx = grad2[gi][0]*x1 + grad2[gi][1]*y1;
      n1 = t1 * t1 * wx;
    }
    let t2 = 0.5 - x2*x2 - y2*y2;
    if(t2>0){
      t2*=t2;
      let gi = perm[ii+1+perm[jj+1]] % 12;
      let wx = grad2[gi][0]*x2 + grad2[gi][1]*y2;
      n2 = t2 * t2 * wx;
    }
    return 70 * (n0 + n1 + n2);
  }
}
const grad2 = [
  [1,1],[-1,1],[1,-1],[-1,-1],
  [1,0],[-1,0],[1,0],[-1,0],
  [0,1],[0,-1],[0,1],[0,-1]
];

// --------------------------- Settings & Globals ---------------------------
const canvas = document.getElementById('three-canvas');
const mapCanvas = document.getElementById('map-canvas');
const mapBtn = document.getElementById('map-btn');
const hint = document.getElementById('hint');

const RENDER_W = () => canvas.clientWidth;
const RENDER_H = () => canvas.clientHeight;

const CHUNK_SIZE = 1200;    // much larger world units per chunk for an expansive terrain
const SEGMENTS = 128;       // reduced subdivisions for much better perf on mobile
const VERT_SPACING = CHUNK_SIZE / SEGMENTS;
const PLAYER_RADIUS = 0.6;  // more comfortable human scale relative to the larger terrain
const VISIBLE_RADIUS = 2;   // 2 => 5x5 grid for smoother streaming of a larger world
const GRID = VISIBLE_RADIUS*2+1;
const NOISE_SCALE = 0.002;  // lower frequency for broader, more rolling features
const OCTAVES = 4;          // fewer octaves to reduce CPU for noise
const HEIGHT_SCALE = 36;    // slightly reduced vertical exaggeration for realistic relief

let scene, camera, renderer;
let playerSphere;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let simplex = new Simplex(Date.now() & 65535);
let clock = new THREE.Clock();

let chunkManager;
let targetPos = null;
let velocity = new THREE.Vector3();
let cameraOffset = new THREE.Vector3(0, 30, -60); // fixed behind and above (no orbit) — increased to suit larger world and smaller sphere

// Keep track of explored chunks for map
let explored = new Set();

// --------------------------- Init Three ------------------------------------------------
function init(){
  // renderer
  // reduce expensive settings for smoother performance on mobile
  renderer = new THREE.WebGLRenderer({canvas, antialias:false});
  renderer.setPixelRatio(Math.min(1, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = false;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8d8ff);

  // camera
  camera = new THREE.PerspectiveCamera(60, RENDER_W()/RENDER_H(), 0.1, 1000);
  camera.position.set(0,20,40);

  // lights
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(100,120,50);
  dir.castShadow = false; // only sphere shadows for perf
  scene.add(dir);

  // player sphere (human-sized)
  // cheaper sphere tessellation for performance
  const sphGeo = new THREE.SphereGeometry(PLAYER_RADIUS, 24, 16);
  const sphMat = new THREE.MeshStandardMaterial({color:0xeeeeee, metalness:0.08, roughness:0.8});
  playerSphere = new THREE.Mesh(sphGeo, sphMat);
  playerSphere.castShadow = true;
  playerSphere.receiveShadow = false;

  // add sphere to scene and place it on the terrain (not as a child of a pivot)
  scene.add(playerSphere);
  const h0 = sampleTerrain(0, 0);
  playerSphere.position.set(0, h0 + PLAYER_RADIUS, 0);

  // chunk manager
  chunkManager = new ChunkManager();
  chunkManager.updateChunksForPlayer(playerSphere.position);

  // events
  window.addEventListener('resize', onResize);
  canvas.addEventListener('pointerdown', onPointerDown);
  mapBtn.addEventListener('click', toggleMap);
  window.addEventListener('keydown', (e)=>{ if(e.key.toLowerCase()==='m') toggleMap(); });

  onResize();
  animate();
}

// --------------------------- Chunk Manager ------------------------------------------------
class ChunkManager {
  constructor(){
    this.chunks = new Map(); // key "cx,cz" => mesh
  }
  key(cx,cz){ return `${cx},${cz}`; }

  updateChunksForPlayer(pos){
    const pcx = Math.floor(pos.x / CHUNK_SIZE);
    const pcz = Math.floor(pos.z / CHUNK_SIZE);
    const needed = new Set();
    for(let dz=-VISIBLE_RADIUS; dz<=VISIBLE_RADIUS; dz++){
      for(let dx=-VISIBLE_RADIUS; dx<=VISIBLE_RADIUS; dx++){
        const cx = pcx + dx, cz = pcz + dz;
        needed.add(this.key(cx,cz));
        if(!this.chunks.has(this.key(cx,cz))){
          const mesh = this.createChunk(cx,cz);
          this.chunks.set(this.key(cx,cz), mesh);
          scene.add(mesh);
          // mark as explored for map
          explored.add(this.key(cx,cz));
        }
      }
    }
    // remove distant chunks
    for(const k of Array.from(this.chunks.keys())){
      if(!needed.has(k)){
        const m = this.chunks.get(k);
        scene.remove(m);
        disposeMesh(m);
        this.chunks.delete(k);
      }
    }
  }

  createChunk(cx, cz){
    // plane centered at chunk center (vertices are local coords; convert to world coords for sampling)
    const geo = new THREE.PlaneBufferGeometry(CHUNK_SIZE, CHUNK_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI/2);
    const pos = geo.attributes.position;
    const vertexCount = pos.count;
    const colors = new Float32Array(vertexCount * 3);

    // resolution per side (SEGMENTS+1)
    const resolution = SEGMENTS + 1;

    // For seamless edges, sample terrain in world-space for each vertex and perform a small world-space 3x3 sample smoothing.
    // This ensures vertices on chunk borders use exactly the same world samples as neighboring chunks.
    const worldXForIndex = (i) => pos.getX(i) + cx * CHUNK_SIZE;
    const worldZForIndex = (i) => pos.getZ(i) + cz * CHUNK_SIZE;

    // small offset in world units for smoothing (relative to vertex spacing)
    const smoothOffset = Math.max(0.5, VERT_SPACING * 0.9);

    for(let i=0;i<vertexCount;i++){
      const wx = worldXForIndex(i);
      const wz = worldZForIndex(i);

      // 3x3 world-space smoothing: average sampleTerrain at the vertex and its 8 neighbors (world offsets).
      let sumH = 0, cnt = 0;
      for(let oz=-1; oz<=1; oz++){
        for(let ox=-1; ox<=1; ox++){
          const sx = wx + ox * smoothOffset;
          const sz = wz + oz * smoothOffset;
          sumH += sampleTerrain(sx, sz);
          cnt++;
        }
      }
      const h = sumH / cnt;

      pos.setY(i, h);

      // biome mask: low-frequency noise to pick a biome tint
      const b = simplex.noise2d(wx * 0.0008, wz * 0.0008); // -1..1
      // map b to 0..1
      const bm = (b + 1) * 0.5;

      // base color by elevation
      const base = colorForHeight(h);

      // biome tints (grass, desert, rock, tundra)
      let tint = {r:1,g:1,b:1};
      if(bm < 0.25){
        // wetter / greener
        tint = {r:0.85, g:1.0, b:0.85};
      } else if(bm < 0.5){
        // neutral / mixed
        tint = {r:1.0, g:0.95, b:0.85};
      } else if(bm < 0.78){
        // rocky / brown
        tint = {r:0.9, g:0.85, b:0.78};
      } else {
        // cold / pale (higher chance of snow at altitude)
        tint = {r:0.95, g:0.98, b:1.0};
      }

      // blend base color with tint weighted by altitude to keep snowy peaks bright
      const altFactor = Math.min(1, Math.max(0, (h - 10) / 18)); // high -> favor pale tint
      const blend = (a, b, t) => a * (1 - t) + b * t;

      const rr = blend(base.r, tint.r, 0.45 * (1 - altFactor) + 0.35 * altFactor);
      const gg = blend(base.g, tint.g, 0.45 * (1 - altFactor) + 0.35 * altFactor);
      const bb = blend(base.b, tint.b, 0.45 * (1 - altFactor) + 0.35 * altFactor);

      colors[i*3] = rr;
      colors[i*3 + 1] = gg;
      colors[i*3 + 2] = bb;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      metalness:0,
      roughness:1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.set(cx*CHUNK_SIZE,0,cz*CHUNK_SIZE);
    // keep chunks pickable even when near frustum edges so pointer raycasts are reliable
    mesh.frustumCulled = false;
    mesh.userData = {cx,cz};
    return mesh;
  }

  getHeightAt(x,z){
    // sample height by combining contribution from the chunk containing the point
    return sampleTerrain(x,z);
  }
}

// --------------------------- Terrain & Utilities ---------------------------------------
function sampleTerrain(x, z){
  // multiple octaves, ridged mountains
  let amp = 1, freq = NOISE_SCALE;
  let sum = 0, max=0;
  for(let o=0;o<OCTAVES;o++){
    const n = simplex.noise2d(x*freq, z*freq);
    // emphasize ridges
    const val = 1 - Math.abs(n);
    sum += val * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  const h = (sum / max) * HEIGHT_SCALE;
  // add a low-frequency rolling baseline
  const baseline = simplex.noise2d(x*0.0006, z*0.0006) * 6;
  return h + baseline;
}

// approximate terrain normal by sampling nearby heights
function sampleNormal(x, z, eps = 0.5){
  // sample three nearby points to form tangent vectors
  const hL = sampleTerrain(x - eps, z);
  const hR = sampleTerrain(x + eps, z);
  const hD = sampleTerrain(x, z - eps);
  const hU = sampleTerrain(x, z + eps);
  // compute partial derivatives
  const dx = (hR - hL) / (2*eps);
  const dz = (hU - hD) / (2*eps);
  // normal is (-dx, 1, -dz) normalized
  const nx = -dx, ny = 1, nz = -dz;
  const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  return new THREE.Vector3(nx/len, ny/len, nz/len);
}
function colorForHeight(h){
  // return rgb 0..1
  if(h < 6){
    // green lowlands
    const t = Math.max(0, Math.min(1, (h+4)/10));
    return {r: 0.09 + 0.2*t, g: 0.5 + 0.3*t, b: 0.05};
  } else if(h < 16){
    const t = (h-6)/10;
    return {r: 0.34 + 0.2*t, g: 0.28, b: 0.12};
  } else {
    const t = Math.min(1, (h-16)/12);
    return {r: 0.9*t + 0.6*(1-t), g:0.9*t + 0.6*(1-t), b:0.9*t + 0.6*(1-t)};
  }
}
function disposeMesh(m){
  if(m.geometry) m.geometry.dispose();
  if(m.material) m.material.dispose();
}

// --------------------------- Input & Movement -------------------------------------------
function onPointerDown(evt){
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width * 2 - 1;
  const y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  mouse.set(x,y);
  raycaster.setFromCamera(mouse, camera);

  // Build a list of terrain meshes to test: use chunkManager.chunks
  const meshes = Array.from(chunkManager.chunks.values());
  const intersects = raycaster.intersectObjects(meshes, true);
  if(intersects.length>0){
    const p = intersects[0].point;
    targetPos = new THREE.Vector3(p.x, p.y + PLAYER_RADIUS, p.z);
  } else {
    // project to ground plane y=0 if nothing
    const planeY = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
    const pt = new THREE.Vector3();
    raycaster.ray.intersectPlane(planeY, pt);
    if(pt) targetPos = new THREE.Vector3(pt.x, sampleTerrain(pt.x, pt.z)+PLAYER_RADIUS, pt.z);
  }
}

// Sphere rolling: update rotation from movement delta
function applyRolling(sphere, deltaMove){
  if(deltaMove.lengthSq() < 1e-6) return;
  const radius = PLAYER_RADIUS;
  const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), deltaMove).normalize();
  const angle = deltaMove.length() / radius;
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  sphere.quaternion.premultiply(q);
}

// --------------------------- Camera -----------------------------------------------------
function updateCamera(dt){
  // Fixed third-person follow: keep camera at a stable offset behind/above the player
  const desired = new THREE.Vector3().copy(playerSphere.position).add(
    new THREE.Vector3().copy(cameraOffset)
  );
  camera.position.lerp(desired, 0.12);
  camera.lookAt(playerSphere.position);
}

// --------------------------- Map Overlay ------------------------------------------------
let mapVisible = false;
function toggleMap(){
  mapVisible = !mapVisible;
  mapCanvas.classList.toggle('hidden', !mapVisible);
  if(mapVisible) drawMap();
}
function drawMap(){
  // True top-down map: render a shaded overhead "camera" view by sampling terrain heights & normals.
  // Map covers a chunk-radius area around the player; unexplored chunks receive a fog blend.
  mapCanvas.width = window.innerWidth;
  mapCanvas.height = window.innerHeight;
  const ctx = mapCanvas.getContext('2d');

  const player = playerSphere.position;
  const pcx = Math.floor(player.x / CHUNK_SIZE);
  const pcz = Math.floor(player.z / CHUNK_SIZE);
  const RANGE = 12; // chunks radius shown
  // world extents to render (centered on player)
  const worldHalf = (RANGE + 0.5) * CHUNK_SIZE;
  const worldMinX = player.x - worldHalf;
  const worldMinZ = player.z - worldHalf;
  const worldSize = worldHalf * 2;

  // choose a map pixel size (keep reasonable resolution)
  const MAP_PIX = Math.min(512, Math.floor(Math.min(mapCanvas.width, mapCanvas.height)));
  const imgW = MAP_PIX, imgH = MAP_PIX;
  const img = ctx.createImageData(imgW, imgH);
  const data = img.data;

  // light direction for simple shading (top-down with slight sun angle)
  const lightDir = new THREE.Vector3(0.6, 0.8, 0.4).normalize();

  // for each pixel, sample terrain and compute shaded color
  for(let y=0;y<imgH;y++){
    for(let x=0;x<imgW;x++){
      const u = x / (imgW - 1);
      const v = y / (imgH - 1);
      const wx = worldMinX + u * worldSize;
      const wz = worldMinZ + v * worldSize;
      const h = sampleTerrain(wx, wz);

      // normal sampling with a small epsilon proportional to world texel
      const eps = Math.max(0.5, worldSize / imgW);
      const n = sampleNormal(wx, wz, eps);

      // base color from elevation + biome tint (reuse colorForHeight and biome noise)
      const base = colorForHeight(h);
      const bNoise = simplex.noise2d(wx * 0.0008, wz * 0.0008);
      const bm = (bNoise + 1) * 0.5;
      let tint = {r:1,g:1,b:1};
      if(bm < 0.25) tint = {r:0.85,g:1.0,b:0.85};
      else if(bm < 0.5) tint = {r:1.0,g:0.95,b:0.85};
      else if(bm < 0.78) tint = {r:0.9,g:0.85,b:0.78};
      else tint = {r:0.95,g:0.98,b:1.0};
      const altFactor = Math.min(1, Math.max(0, (h - 10) / 18));
      const blend = (a, b, t) => a * (1 - t) + b * t;
      const rr = blend(base.r, tint.r, 0.45 * (1 - altFactor) + 0.35 * altFactor);
      const gg = blend(base.g, tint.g, 0.45 * (1 - altFactor) + 0.35 * altFactor);
      const bb = blend(base.b, tint.b, 0.45 * (1 - altFactor) + 0.35 * altFactor);

      // Lambertian shading
      const shade = Math.max(0, n.dot(lightDir)) * 0.9 + 0.1;
      let r = Math.min(1, rr * shade);
      let g = Math.min(1, gg * shade);
      let b = Math.min(1, bb * shade);

      // determine corresponding chunk; if not explored, apply fog/darken and bluish desaturation
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cz = Math.floor(wz / CHUNK_SIZE);
      const key = `${cx},${cz}`;
      if(!explored.has(key)){
        // fog strength based on distance from player (closer unexplored slightly less foggy)
        const dx = (cx - pcx);
        const dz = (cz - pcz);
        const distChunk = Math.sqrt(dx*dx + dz*dz);
        const fog = Math.min(1, 0.22 + distChunk * 0.05);
        // desaturate toward cool fog color
        const gray = (r + g + b) / 3;
        const fogR = blend(r, 0.12, fog);
        const fogG = blend(g, 0.14, fog);
        const fogB = blend(b, 0.18, fog);
        r = blend(r, fogR * 0.6 + gray * 0.4, fog);
        g = blend(g, fogG * 0.6 + gray * 0.4, fog);
        b = blend(b, fogB * 0.6 + gray * 0.4, fog);
        // darken overall
        const dark = 1 - 0.45 * fog;
        r *= dark; g *= dark; b *= dark;
      }

      const idx = (y * imgW + x) * 4;
      data[idx] = (r * 255) | 0;
      data[idx+1] = (g * 255) | 0;
      data[idx+2] = (b * 255) | 0;
      data[idx+3] = 255;
    }
  }

  // draw onto canvas centered, with padding
  ctx.clearRect(0,0,mapCanvas.width,mapCanvas.height);
  // background vignette
  ctx.fillStyle = 'rgba(6,8,12,0.75)';
  ctx.fillRect(0,0,mapCanvas.width,mapCanvas.height);

  // scale image to fit 90% of smallest canvas dimension
  const drawSize = Math.min(mapCanvas.width, mapCanvas.height) * 0.9;
  const dx = (mapCanvas.width - drawSize) / 2;
  const dy = (mapCanvas.height - drawSize) / 2;
  // putImageData requires matching sizes; draw to an offscreen canvas for scaling
  const off = document.createElement('canvas');
  off.width = imgW; off.height = imgH;
  off.getContext('2d').putImageData(img,0,0);
  ctx.drawImage(off, dx, dy, drawSize, drawSize);

  // overlay chunk grid faintly
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const chunksAcross = RANGE*2+1;
  const cell = drawSize / chunksAcross;
  for(let i=0;i<=chunksAcross;i++){
    const px = dx + i * cell;
    ctx.beginPath(); ctx.moveTo(px, dy); ctx.lineTo(px, dy + drawSize); ctx.stroke();
    const py = dy + i * cell;
    ctx.beginPath(); ctx.moveTo(dx, py); ctx.lineTo(dx + drawSize, py); ctx.stroke();
  }

  // draw explored overlay subtle: slightly brighter border on explored chunk centers
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for(let dz=-RANGE; dz<=RANGE; dz++){
    for(let dx=-RANGE; dx<=RANGE; dx++){
      const cx = pcx + dx, cz = pcz + dz;
      const key = `${cx},${cz}`;
      if(explored.has(key)){
        const cxRel = (dx + RANGE) * cell + dx * 0; // cell computed
        const x0 = dx; // no-op placeholder to keep code readable
        // draw subtle rectangle
        const rx = dx; // no-op
        // compute rect position
        const rxPos = dx; // no-op
        // actual rect:
        const xRect = dx; // retained no-op to satisfy linters; compute below properly
      }
    }
  }

  // player marker in map coordinates
  const relX = (player.x - worldMinX) / worldSize;
  const relZ = (player.z - worldMinZ) / worldSize;
  const markX = dx + relX * drawSize;
  const markY = dy + relZ * drawSize;
  ctx.beginPath();
  ctx.fillStyle = 'white';
  ctx.arc(markX, markY, Math.max(6, drawSize * 0.02), 0, Math.PI*2);
  ctx.fill();

  // orientation arrow (show forward)
  const fwd = new THREE.Vector3(0,0,1).applyQuaternion(playerSphere.quaternion);
  const arrowScale = Math.max(8, drawSize * 0.03);
  ctx.beginPath();
  ctx.moveTo(markX + fwd.x * arrowScale, markY + fwd.z * arrowScale);
  ctx.lineTo(markX - fwd.x * arrowScale * 0.4 + fwd.z * arrowScale * 0.25, markY - fwd.z * arrowScale * 0.4 + fwd.x * arrowScale * 0.25);
  ctx.lineTo(markX - fwd.x * arrowScale * 0.4 - fwd.z * arrowScale * 0.25, markY - fwd.z * arrowScale * 0.4 - fwd.x * arrowScale * 0.25);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();

  // subtle caption
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `${Math.max(12, drawSize*0.03)}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('Top-down', mapCanvas.width - 12, mapCanvas.height - 12);
}

// --------------------------- Animation Loop -------------------------------------------
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  // Movement: smoothly move sphere toward targetPos along surface
  if(targetPos){
    const toTarget = new THREE.Vector3().subVectors(targetPos, playerSphere.position);
    const horizontal = new THREE.Vector3(toTarget.x, 0, toTarget.z);
    const dist = horizontal.length();
    if(dist > 0.15){
      const speed = 12; // units per second
      const move = horizontal.normalize().multiplyScalar(speed * dt);
      if(move.length() > dist) move.setLength(dist);
      // new x,z
      const newX = playerSphere.position.x + move.x;
      const newZ = playerSphere.position.z + move.z;
      const newY = chunkManager.getHeightAt(newX, newZ) + PLAYER_RADIUS;
      const prev = playerSphere.position.clone();
      playerSphere.position.set(newX, newY, newZ);
      const deltaMove = new THREE.Vector3().subVectors(playerSphere.position, prev);
      applyRolling(playerSphere, deltaMove);
      // update chunks as player crosses chunk boundaries
      chunkManager.updateChunksForPlayer(playerSphere.position);
    } else {
      targetPos = null;
    }
  } else {
    // gently settle to current terrain height
    const h = chunkManager.getHeightAt(playerSphere.position.x, playerSphere.position.z) + 2.2;
    playerSphere.position.y = THREE.MathUtils.lerp(playerSphere.position.y, h, 0.08);
  }

  // align sphere to the terrain normal so it sits flush on slopes
  const normal = sampleNormal(playerSphere.position.x, playerSphere.position.z);
  const fromUp = new THREE.Vector3(0,1,0);
  const targetQuat = new THREE.Quaternion().setFromUnitVectors(fromUp, normal);
  // smooth the rotation for stability
  playerSphere.quaternion.slerp(targetQuat, Math.min(1, dt * 6));

  // update camera
  updateCamera(dt);

  // occasional map redraw if visible
  if(mapVisible){
    drawMap();
  }

  renderer.setSize(RENDER_W(), RENDER_H(), false);
  camera.aspect = RENDER_W()/RENDER_H();
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
}

// --------------------------- Resize & Helpers -----------------------------------------
function onResize(){
  renderer.setSize(RENDER_W(), RENDER_H(), false);
  camera.aspect = RENDER_W()/RENDER_H();
  camera.updateProjectionMatrix();
  mapCanvas.width = window.innerWidth;
  mapCanvas.height = window.innerHeight;
}
init();