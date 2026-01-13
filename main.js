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
  // Top-down HD map optimized for mobile: use devicePixelRatio, cache height grid, and reduce LOS steps.
  mapCanvas.width = window.innerWidth;
  mapCanvas.height = window.innerHeight;
  const ctx = mapCanvas.getContext('2d');

  const player = playerSphere.position;

  const RANGE = 4; // chunks radius shown
  const worldHalf = (RANGE + 0.5) * CHUNK_SIZE;
  const worldMinX = player.x - worldHalf;
  const worldMinZ = player.z - worldHalf;
  const worldSize = worldHalf * 2;

  // use DPR to produce crisper map on HD screens but cap for perf
  // adaptive DPR with mobile-aware caps for performance
  const DPR = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
  // baseSize relative to viewport but keep map render area modest for mobile
  const baseSize = Math.min(mapCanvas.width, mapCanvas.height) * 0.62;
  // allow higher internal resolution for sharper maps on modern devices but cap to preserve memory/CPU
  const MAP_PIX = Math.min(1536, Math.max(360, Math.floor(baseSize * DPR)));
  const imgW = MAP_PIX, imgH = MAP_PIX;

  // offscreen for faster pixel ops
  const off = document.createElement('canvas');
  off.width = imgW; off.height = imgH;
  const offCtx = off.getContext('2d');
  const img = offCtx.createImageData(imgW, imgH);
  const data = img.data;

  const lightDir = new THREE.Vector3(0.6, 0.8, 0.4).normalize();
  const eyeHeight = Math.max(6, player.y + 1.2);
  const maxViewDistance = worldHalf * 1.0;

  // Precompute heights for every map texel once (faster than repeated nearby sampling)
  const heightGrid = new Float32Array(imgW * imgH);
  for(let py=0; py<imgH; py++){
    const v = py / (imgH - 1);
    const wz = worldMinZ + v * worldSize;
    for(let px=0; px<imgW; px++){
      const u = px / (imgW - 1);
      const wx = worldMinX + u * worldSize;
      heightGrid[py * imgW + px] = sampleTerrain(wx, wz);
    }
  }

  // Render by reading grid and approximating normals from neighboring cells
  for(let py=0; py<imgH; py++){
    for(let px=0; px<imgW; px++){
      const idxCell = py * imgW + px;
      const u = px / (imgW - 1);
      const v = py / (imgH - 1);
      const wx = worldMinX + u * worldSize;
      const wz = worldMinZ + v * worldSize;
      const h = heightGrid[idxCell];

      // approximate normal using finite differences on the grid
      const sx = Math.max(0, px-1), ex = Math.min(imgW-1, px+1);
      const sy = Math.max(0, py-1), ey = Math.min(imgH-1, py+1);
      const hL = heightGrid[py * imgW + sx];
      const hR = heightGrid[py * imgW + ex];
      const hU = heightGrid[ey * imgW + px];
      const hD = heightGrid[sy * imgW + px];
      const worldDX = ( (ex - sx) / imgW ) * worldSize;
      const worldDZ = ( (ey - sy) / imgH ) * worldSize;
      const dx = (hR - hL) / Math.max(0.0001, worldDX);
      const dz = (hU - hD) / Math.max(0.0001, worldDZ);
      const nx = -dx, ny = 1, nz = -dz;
      const nlen = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      const n = {x: nx/nlen, y: ny/nlen, z: nz/nlen};

      // color + biome
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

      // shading
      const shade = Math.max(0, (n.x*lightDir.x + n.y*lightDir.y + n.z*lightDir.z)) * 0.9 + 0.1;
      let r = Math.min(1, rr * shade);
      let g = Math.min(1, gg * shade);
      let b = Math.min(1, bb * shade);

      // LOS: reduced steps for performance but still effective
      const dxp = wx - player.x;
      const dzp = wz - player.z;
      const horizDist = Math.sqrt(dxp*dxp + dzp*dzp);
      let occluded = false, losVisibility = 1.0;
      if(horizDist > 0.001 && horizDist <= maxViewDistance){
        const steps = Math.max(8, Math.min(24, Math.ceil((horizDist / Math.max(4, CHUNK_SIZE/6)) * 8)));
        for(let s=1; s<steps; s++){
          const t = s / steps;
          const sxw = player.x + dxp * t;
          const szw = player.z + dzp * t;
          // map sample into grid indices for quick lookup where possible
          const iu = Math.floor(((sxw - worldMinX) / worldSize) * (imgW-1));
          const iv = Math.floor(((szw - worldMinZ) / worldSize) * (imgH-1));
          let terrainH = h; // fallback
          if(iu >= 0 && iu < imgW && iv >= 0 && iv < imgH){
            terrainH = heightGrid[iv * imgW + iu];
          } else {
            terrainH = sampleTerrain(sxw, szw);
          }
          const targetHeightAtPoint = h + 0.6;
          const lineH = eyeHeight + (targetHeightAtPoint - eyeHeight) * t;
          if(terrainH > lineH - 0.6){
            occluded = true;
            const occluderDist = horizDist * t;
            losVisibility = Math.max(0, 1 - (1.4 * (1 - (occluderDist / Math.max(1, horizDist)))));
            break;
          }
        }
      } else if(horizDist > maxViewDistance){
        occluded = true; losVisibility = 0;
      }

      const distFog = Math.min(1, horizDist / (worldSize * 0.45));
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cz = Math.floor(wz / CHUNK_SIZE);
      const key = `${cx},${cz}`;
      const exploredFactor = explored.has(key) ? 0 : 1;
      const combinedFog = Math.min(1, distFog * 0.9 + exploredFactor * 0.6 + (occluded ? (1 - losVisibility) * 1.0 : 0));

      if(combinedFog > 0.03){
        const gray = (r + g + b) / 3;
        const fogR = blend(r, 0.12, combinedFog);
        const fogG = blend(g, 0.14, combinedFog);
        const fogB = blend(b, 0.18, combinedFog);
        r = blend(r, fogR * 0.6 + gray * 0.4, combinedFog);
        g = blend(g, fogG * 0.6 + gray * 0.4, combinedFog);
        b = blend(b, fogB * 0.6 + gray * 0.4, combinedFog);
        const dark = 1 - 0.55 * combinedFog;
        r *= dark; g *= dark; b *= dark;
      }

      // apply simple saturation and gamma (sRGB) for richer colors on canvas
      const saturate = (v, s=1.05) => {
        const mid = 0.5;
        return Math.min(1, mid + (v - mid) * s);
      };
      // convert linear to sRGB-ish gamma for display
      const toSRGB = (v) => Math.pow(Math.max(0, Math.min(1, v)), 1/2.2);
      const rr_s = toSRGB(saturate(r, 1.06));
      const gg_s = toSRGB(saturate(g, 1.02));
      const bb_s = toSRGB(saturate(b, 1.00));
      const idx = idxCell * 4;
      data[idx] = (rr_s * 255) | 0;
      data[idx+1] = (gg_s * 255) | 0;
      data[idx+2] = (bb_s * 255) | 0;
      data[idx+3] = 255;
    }
  }

  // composite to visible canvas with a dark translucent background
  ctx.clearRect(0,0,mapCanvas.width,mapCanvas.height);
  ctx.fillStyle = 'rgba(6,8,12,0.78)';
  ctx.fillRect(0,0,mapCanvas.width,mapCanvas.height);

  // draw offscreen image centered and scaled
  offCtx.putImageData(img, 0, 0);
  const drawSize = Math.min(mapCanvas.width, mapCanvas.height) * 0.8;
  const dxPos = (mapCanvas.width - drawSize) / 2;
  const dyPos = (mapCanvas.height - drawSize) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, imgW, imgH, dxPos, dyPos, drawSize, drawSize);

  // faint chunk grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const chunksAcross = RANGE*2+1;
  const cell = drawSize / chunksAcross;
  for(let i=0;i<=chunksAcross;i++){
    const px = dxPos + i * cell;
    ctx.beginPath(); ctx.moveTo(px, dyPos); ctx.lineTo(px, dyPos + drawSize); ctx.stroke();
    const py = dyPos + i * cell;
    ctx.beginPath(); ctx.moveTo(dxPos, py); ctx.lineTo(dxPos + drawSize, py); ctx.stroke();
  }

  // player marker & orientation
  const relX = (player.x - worldMinX) / worldSize;
  const relZ = (player.z - worldMinZ) / worldSize;
  const markX = dxPos + relX * drawSize;
  const markY = dyPos + relZ * drawSize;
  ctx.beginPath();
  ctx.fillStyle = 'white';
  ctx.arc(markX, markY, Math.max(6, drawSize * 0.02), 0, Math.PI*2);
  ctx.fill();

  const fwd = new THREE.Vector3(0,0,1).applyQuaternion(playerSphere.quaternion);
  const arrowScale = Math.max(8, drawSize * 0.035);
  ctx.beginPath();
  ctx.moveTo(markX + fwd.x * arrowScale, markY + fwd.z * arrowScale);
  ctx.lineTo(markX - fwd.x * arrowScale * 0.4 + fwd.z * arrowScale * 0.25, markY - fwd.z * arrowScale * 0.4 + fwd.x * arrowScale * 0.25);
  ctx.lineTo(markX - fwd.x * arrowScale * 0.4 - fwd.z * arrowScale * 0.25, markY - fwd.z * arrowScale * 0.4 - fwd.x * arrowScale * 0.25);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `${Math.max(12, drawSize*0.025)}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('Top-down (zoomed)', mapCanvas.width - 12, mapCanvas.height - 12);
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