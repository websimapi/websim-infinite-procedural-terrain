/* Map overlay module: handles top-down map drawing. */
export class MapOverlay {
  constructor(opts){
    this.canvas = opts.canvas;
    this.sampleTerrain = opts.sampleTerrain;
    this.simplex = opts.simplex;
    this.explored = opts.explored;
    this.player = opts.player;
    this.visible = false;
  }
  toggle(){
    this.visible = !this.visible;
    this.canvas.classList.toggle('hidden', !this.visible);
    if(this.visible) this.draw();
  }
  draw(){
    // Adapted but simplified version of the original drawMap for modularity and clarity.
    const mapCanvas = this.canvas;
    mapCanvas.width = window.innerWidth;
    mapCanvas.height = window.innerHeight;
    const ctx = mapCanvas.getContext('2d');
    const player = this.player.position;
    const CHUNK_SIZE = 1200;
    const RANGE = 4;
    const worldHalf = (RANGE + 0.5) * CHUNK_SIZE;
    const worldMinX = player.x - worldHalf;
    const worldMinZ = player.z - worldHalf;
    const worldSize = worldHalf * 2;

    const DPR = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
    const baseSize = Math.min(mapCanvas.width, mapCanvas.height) * 0.62;
    const MAP_PIX = Math.min(1024, Math.max(256, Math.floor(baseSize * DPR)));
    const imgW = MAP_PIX, imgH = MAP_PIX;

    const off = document.createElement('canvas');
    off.width = imgW; off.height = imgH;
    const offCtx = off.getContext('2d');
    const img = offCtx.createImageData(imgW, imgH);
    const data = img.data;

    // Precompute heights
    const heightGrid = new Float32Array(imgW * imgH);
    for(let py=0; py<imgH; py++){
      const v = py / (imgH - 1);
      const wz = worldMinZ + v * worldSize;
      for(let px=0; px<imgW; px++){
        const u = px / (imgW - 1);
        const wx = worldMinX + u * worldSize;
        heightGrid[py * imgW + px] = this.sampleTerrain(wx, wz);
      }
    }

    // simple shading per pixel (no LOS heavy loop to keep it mobile friendly)
    const lightDir = new THREE.Vector3(0.6, 0.8, 0.4).normalize();
    for(let py=0; py<imgH; py++){
      for(let px=0; px<imgW; px++){
        const idx = py * imgW + px;
        const u = px / (imgW - 1);
        const v = py / (imgH - 1);
        const wx = worldMinX + u * worldSize;
        const wz = worldMinZ + v * worldSize;
        const h = heightGrid[idx];
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
        const nd = {x: nx/nlen, y: ny/nlen, z: nz/nlen};
        // color
        const base = colorForHeight(h);
        const shade = Math.max(0, (nd.x*lightDir.x + nd.y*lightDir.y + nd.z*lightDir.z)) * 0.9 + 0.1;
        let r = Math.min(1, base.r * shade);
        let g = Math.min(1, base.g * shade);
        let b = Math.min(1, base.b * shade);
        const toSRGB = (v)=> Math.pow(Math.max(0, Math.min(1, v)), 1/2.2);
        const idx4 = idx * 4;
        data[idx4] = (toSRGB(r) * 255) | 0;
        data[idx4+1] = (toSRGB(g) * 255) | 0;
        data[idx4+2] = (toSRGB(b) * 255) | 0;
        data[idx4+3] = 255;
      }
    }

    offCtx.putImageData(img, 0, 0);
    ctx.clearRect(0,0,mapCanvas.width,mapCanvas.height);
    ctx.fillStyle = 'rgba(6,8,12,0.78)';
    ctx.fillRect(0,0,mapCanvas.width,mapCanvas.height);
    const drawSize = Math.min(mapCanvas.width, mapCanvas.height) * 0.8;
    const dxPos = (mapCanvas.width - drawSize) / 2;
    const dyPos = (mapCanvas.height - drawSize) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, imgW, imgH, dxPos, dyPos, drawSize, drawSize);

    // player marker
    const relX = (player.x - worldMinX) / worldSize;
    const relZ = (player.z - worldMinZ) / worldSize;
    const markX = dxPos + relX * drawSize;
    const markY = dyPos + relZ * drawSize;
    ctx.beginPath();
    ctx.fillStyle = 'white';
    ctx.arc(markX, markY, Math.max(6, drawSize * 0.02), 0, Math.PI*2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `${Math.max(12, drawSize*0.025)}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText('Top-down (zoomed)', mapCanvas.width - 12, mapCanvas.height - 12);
  }
}

// We need colorForHeight here; import without creating cycle
import { colorForHeight } from './terrain.js';