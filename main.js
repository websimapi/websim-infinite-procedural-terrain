/*
  Refactored entry module: wire up the smaller modules and initialize app.
  Large function implementations have been moved to separate files for clarity.
*/

// Tombstones for removed code (keeps history / makes it clear where things moved)
 // removed: class Simplex() { ... }  -- moved to ./src/noise.js
 // removed: function sampleTerrain() { ... }  -- moved to ./src/terrain.js
 // removed: class ChunkManager { ... }  -- moved to ./src/chunkManager.js
 // removed: function drawMap() { ... }  -- moved to ./src/mapOverlay.js
 // removed: onPointerDown, applyRolling, updateCamera, animate, init()  -- split into ./src/player.js + main control flow

// Import modules (they rely on global THREE for brevity)
import { Simplex } from './src/noise.js';
import { sampleTerrain, sampleNormal, colorForHeight, NOISE_SCALE, OCTAVES, HEIGHT_SCALE } from './src/terrain.js';
import { ChunkManager } from './src/chunkManager.js';
import { PlayerController, createPlayerMesh } from './src/player.js';
import { MapOverlay } from './src/mapOverlay.js';

// Re-used DOM refs & constants (kept small)
const canvas = document.getElementById('three-canvas');
const mapCanvas = document.getElementById('map-canvas');
const mapBtn = document.getElementById('map-btn');

const RENDER_W = () => canvas.clientWidth;
const RENDER_H = () => canvas.clientHeight;

let renderer, scene, camera;
let chunkManager;
let player;
let mapOverlay;
let simplex = new Simplex(Date.now() & 65535);
let clock = new THREE.Clock();
let explored = new Set();

function init(){
  renderer = new THREE.WebGLRenderer({canvas, antialias:false});
  renderer.setPixelRatio(Math.min(1, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = false;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8d8ff);

  camera = new THREE.PerspectiveCamera(60, RENDER_W()/RENDER_H(), 0.1, 1000);
  camera.position.set(0,20,40);

  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(100,120,50);
  dir.castShadow = false;
  scene.add(dir);

  // create player and controller
  const playerMesh = createPlayerMesh();
  scene.add(playerMesh);
  player = new PlayerController(playerMesh, { sampleTerrain, sampleNormal, explored });

  // chunk manager
  chunkManager = new ChunkManager({ scene, sampleTerrain, explored });

  // map overlay helper
  mapOverlay = new MapOverlay({ canvas: mapCanvas, sampleTerrain, simplex, explored, player });

  // events
  window.addEventListener('resize', onResize);
  canvas.addEventListener('pointerdown', (e)=> player.onPointerDown(e, camera, chunkManager));
  mapBtn.addEventListener('click', ()=> mapOverlay.toggle());
  window.addEventListener('keydown', (e)=>{ if(e.key.toLowerCase()==='m') mapOverlay.toggle(); });

  chunkManager.updateChunksForPlayer(player.position);
  onResize();
  animate();
}

function updateCamera(dt){
  // small follow behavior
  const cameraOffset = new THREE.Vector3(0,30,-60);
  const desired = new THREE.Vector3().copy(player.position).add(cameraOffset);
  camera.position.lerp(desired, 0.12);
  camera.lookAt(player.position);
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  player.update(dt, chunkManager);
  chunkManager.updateChunksForPlayer(player.position);
  updateCamera(dt);

  if(mapOverlay.visible) mapOverlay.draw();

  renderer.setSize(RENDER_W(), RENDER_H(), false);
  camera.aspect = RENDER_W()/RENDER_H();
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

function onResize(){
  if(renderer) renderer.setSize(RENDER_W(), RENDER_H(), false);
  if(camera){ camera.aspect = RENDER_W()/RENDER_H(); camera.updateProjectionMatrix(); }
  mapCanvas.width = window.innerWidth;
  mapCanvas.height = window.innerHeight;
}

init();