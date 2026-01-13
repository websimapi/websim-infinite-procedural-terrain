/* ChunkManager extracted and slightly adapted to accept dependencies */
import { colorForHeight } from './terrain.js';

export class ChunkManager {
  constructor(opts = {}){
    this.scene = opts.scene;
    this.sampleTerrain = opts.sampleTerrain;
    this.explored = opts.explored;
    this.chunks = new Map();
    // constants reused from original main file (kept as globals in main.js context)
    this.CHUNK_SIZE = 1200;
    this.SEGMENTS = 128;
    this.VERT_SPACING = this.CHUNK_SIZE / this.SEGMENTS;
  }
  key(cx,cz){ return `${cx},${cz}`; }

  updateChunksForPlayer(pos){
    const pcx = Math.floor(pos.x / this.CHUNK_SIZE);
    const pcz = Math.floor(pos.z / this.CHUNK_SIZE);
    const VISIBLE_RADIUS = 2;
    const needed = new Set();
    for(let dz=-VISIBLE_RADIUS; dz<=VISIBLE_RADIUS; dz++){
      for(let dx=-VISIBLE_RADIUS; dx<=VISIBLE_RADIUS; dx++){
        const cx = pcx + dx, cz = pcz + dz;
        needed.add(this.key(cx,cz));
        const k = this.key(cx,cz);
        if(!this.chunks.has(k)){
          const mesh = this.createChunk(cx,cz);
          this.chunks.set(k, mesh);
          this.scene.add(mesh);
          this.explored.add(k);
        }
      }
    }
    for(const k of Array.from(this.chunks.keys())){
      if(!needed.has(k)){
        const m = this.chunks.get(k);
        this.scene.remove(m);
        disposeMesh(m);
        this.chunks.delete(k);
      }
    }
  }

  createChunk(cx, cz){
    const geo = new THREE.PlaneBufferGeometry(this.CHUNK_SIZE, this.CHUNK_SIZE, this.SEGMENTS, this.SEGMENTS);
    geo.rotateX(-Math.PI/2);
    const pos = geo.attributes.position;
    const vertexCount = pos.count;
    const colors = new Float32Array(vertexCount * 3);
    const smoothOffset = Math.max(0.5, this.VERT_SPACING * 0.9);
    for(let i=0;i<vertexCount;i++){
      const wx = pos.getX(i) + cx * this.CHUNK_SIZE;
      const wz = pos.getZ(i) + cz * this.CHUNK_SIZE;
      let sumH = 0, cnt = 0;
      for(let oz=-1; oz<=1; oz++){
        for(let ox=-1; ox<=1; ox++){
          const sx = wx + ox * smoothOffset;
          const sz = wz + oz * smoothOffset;
          sumH += this.sampleTerrain(sx, sz);
          cnt++;
        }
      }
      const h = sumH / cnt;
      pos.setY(i, h);
      const base = colorForHeight(h);
      // simple tinting heuristic
      const tintNoise = (new Simplex(Date.now() & 65535)).noise2d(wx * 0.0008, wz * 0.0008);
      const bm = (tintNoise + 1) * 0.5;
      let tint = {r:1,g:1,b:1};
      if(bm < 0.25) tint = {r:0.85,g:1.0,b:0.85};
      else if(bm < 0.5) tint = {r:1.0,g:0.95,b:0.85};
      else if(bm < 0.78) tint = {r:0.9,g:0.85,b:0.78};
      else tint = {r:0.95,g:0.98,b:1.0};
      const altFactor = Math.min(1, Math.max(0, (h - 10) / 18));
      const blend = (a,b,t)=> a*(1-t)+b*t;
      const rr = blend(base.r, tint.r, 0.45 * (1 - altFactor) + 0.35 * altFactor);
      const gg = blend(base.g, tint.g, 0.45 * (1 - altFactor) + 0.35 * altFactor);
      const bb = blend(base.b, tint.b, 0.45 * (1 - altFactor) + 0.35 * altFactor);
      colors[i*3] = rr; colors[i*3+1] = gg; colors[i*3+2] = bb;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors:true, flatShading:false, metalness:0, roughness:1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.position.set(cx*this.CHUNK_SIZE,0,cz*this.CHUNK_SIZE);
    mesh.frustumCulled = false;
    mesh.userData = {cx,cz};
    return mesh;
  }

  getHeightAt(x,z){
    return this.sampleTerrain(x,z);
  }
}

// minimal dispose helper
function disposeMesh(m){
  if(m.geometry) m.geometry.dispose();
  if(m.material) m.material.dispose();
}

// We need Simplex for chunk tinting; import here to avoid cyclic load
import { Simplex } from './noise.js';