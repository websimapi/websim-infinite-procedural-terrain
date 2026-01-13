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
const SEGMENTS = 256;       // high subdivision count for detailed mesh (more expensive)
const VERT_SPACING = CHUNK_SIZE / SEGMENTS;
const PLAYER_RADIUS = 0.45; // smaller, life-like human scale relative to the larger terrain
const VISIBLE_RADIUS = 2;   // 2 => 5x5 grid for smoother streaming of a larger world
const GRID = VISIBLE_RADIUS*2+1;
const NOISE_SCALE = 0.002;  // lower frequency for broader, more rolling features
const OCTAVES = 5;          // multiple octaves for richer terrain detail
const HEIGHT_SCALE = 50;    // reduced vertical exaggeration for more realistic relief

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
  renderer = new THREE.WebGLRenderer({canvas, antialias:true});
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
  const sphGeo = new THREE.SphereGeometry(PLAYER_RADIUS, 48, 36);
  const sphMat = new THREE.MeshStandardMaterial({color:0xeeeeee, metalness:0.1, roughness:0.7});
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
    // plane centered at chunk center
    const geo = new THREE.PlaneBufferGeometry(CHUNK_SIZE, CHUNK_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI/2);
    const pos = geo.attributes.position;
    const vertexCount = pos.count;
    // We'll build a height grid, smooth it (two-pass blur) for softer transitions, then assign colors.
    const resolution = SEGMENTS + 1;
    const heights = new Float32(vertexCount); // temp typed array
    // populate heights
    for(let i=0;i<vertexCount;i++){
      const vx = pos.getX(i) + cx*CHUNK_SIZE;
      const vz = pos.getZ(i) + cz*CHUNK_SIZE;
      heights[i] = sampleTerrain(vx, vz);
    }
    // two-pass smoothing kernel (box blur) across the grid to soften harsh vertex jumps
    const smoothed = new Float32(vertexCount);
    const getIndex = (gx,gz) => gz * resolution + gx;
    for(let pass=0; pass<2; pass++){
      for(let gz=0; gz<resolution; gz++){
        for(let gx=0; gx<resolution; gx++){
          let sum = 0, cnt = 0;
          for(let oz=-1; oz<=1; oz++){
            for(let ox=-1; ox<=1; ox++){
              const nx = gx + ox, nz = gz + oz;
              if(nx>=0 && nx<resolution && nz>=0 && nz<resolution){
                sum += heights[getIndex(nx,nz)];
                cnt++;
              }
            }
          }
          smoothed[getIndex(gx,gz)] = sum / cnt;
        }
      }
      // swap buffers for next pass
      for(let i=0;i<vertexCount;i++) heights[i] = smoothed[i];
    }
    // apply smoothed heights and compute colors
    const colors = new Float32Array(vertexCount*3);
    for(let i=0;i<vertexCount;i++){
      pos.setY(i, heights[i]);
      const col = colorForHeight(heights[i]);
      colors[i*3]=col.r; colors[i*3+1]=col.g; colors[i*3+2]=col.b;
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
    mesh.frustumCulled = true;
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
  // Fullscreen top-down map: each chunk becomes a square
  mapCanvas.width = window.innerWidth;
  mapCanvas.height = window.innerHeight;
  const ctx = mapCanvas.getContext('2d');
  ctx.clearRect(0,0,mapCanvas.width,mapCanvas.height);
  // Determine range to show: show radius 12 chunks around player
  const player = playerSphere.position;
  const pcx = Math.floor(player.x / CHUNK_SIZE);
  const pcz = Math.floor(player.z / CHUNK_SIZE);
  const RANGE = 12;
  const size = Math.min(mapCanvas.width, mapCanvas.height) * 0.9;
  const chunkPx = size / (RANGE*2+1);
  const ox = mapCanvas.width/2 - (chunkPx*(RANGE+0.5));
  const oy = mapCanvas.height/2 - (chunkPx*(RANGE+0.5));

  // background fog
  ctx.fillStyle = 'rgba(10,10,10,0.7)';
  ctx.fillRect(0,0,mapCanvas.width,mapCanvas.height);

  // draw chunks
  for(let dz=-RANGE; dz<=RANGE; dz++){
    for(let dx=-RANGE; dx<=RANGE; dx++){
      const cx = pcx + dx, cz = pcz + dz;
      const key = `${cx},${cz}`;
      const x = ox + (dx+RANGE)*chunkPx;
      const y = oy + (dz+RANGE)*chunkPx;
      if(explored.has(key)){
        // sample central height for color
        const cxWorld = (cx+0.5)*CHUNK_SIZE;
        const czWorld = (cz+0.5)*CHUNK_SIZE;
        const h = sampleTerrain(cxWorld, czWorld);
        const c = colorForHeight(h);
        ctx.fillStyle = `rgb(${(c.r*255)|0},${(c.g*255)|0},${(c.b*255)|0})`;
      } else {
        ctx.fillStyle = 'rgba(20,20,30,0.6)'; // fog-of-war
      }
      ctx.fillRect(x,y,chunkPx,chunkPx);
    }
  }
  // player marker
  const px = ox + (RANGE + (player.x/CHUNK_SIZE - pcx)) * chunkPx;
  const py = oy + (RANGE + (player.z/CHUNK_SIZE - pcz)) * chunkPx;
  ctx.beginPath();
  ctx.fillStyle = 'white';
  ctx.arc(px, py, Math.max(4, chunkPx*0.12), 0, Math.PI*2);
  ctx.fill();
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