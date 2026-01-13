/* Player mesh creation and controller (movement, pointer handling, rolling, alignment) */
export function createPlayerMesh(){
  const PLAYER_RADIUS = 0.6;
  const sphGeo = new THREE.SphereGeometry(PLAYER_RADIUS, 24, 16);
  const sphMat = new THREE.MeshStandardMaterial({color:0xeeeeee, metalness:0.08, roughness:0.8});
  const mesh = new THREE.Mesh(sphGeo, sphMat);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

export class PlayerController {
  constructor(mesh, deps){
    this.mesh = mesh;
    this.sampleTerrain = deps.sampleTerrain;
    this.sampleNormal = deps.sampleNormal;
    this.explored = deps.explored;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.targetPos = null;
    this.PLAYER_RADIUS = 0.6;
    // initialize position on terrain
    const h0 = this.sampleTerrain(0,0);
    this.mesh.position.set(0, h0 + this.PLAYER_RADIUS, 0);
  }
  get position(){ return this.mesh.position; }

  onPointerDown(evt, camera, chunkManager){
    const canvas = document.getElementById('three-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left) / rect.width * 2 - 1;
    const y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    this.mouse.set(x,y);
    this.raycaster.setFromCamera(this.mouse, camera);
    const meshes = Array.from(chunkManager.chunks.values());
    const intersects = this.raycaster.intersectObjects(meshes, true);
    if(intersects.length>0){
      const p = intersects[0].point;
      this.targetPos = new THREE.Vector3(p.x, p.y + this.PLAYER_RADIUS, p.z);
    } else {
      const planeY = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
      const pt = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(planeY, pt);
      if(pt) this.targetPos = new THREE.Vector3(pt.x, this.sampleTerrain(pt.x, pt.z)+this.PLAYER_RADIUS, pt.z);
    }
  }

  applyRolling(deltaMove){
    if(deltaMove.lengthSq() < 1e-6) return;
    const radius = this.PLAYER_RADIUS;
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), deltaMove).normalize();
    const angle = deltaMove.length() / radius;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    this.mesh.quaternion.premultiply(q);
  }

  update(dt, chunkManager){
    if(this.targetPos){
      const toTarget = new THREE.Vector3().subVectors(this.targetPos, this.mesh.position);
      const horizontal = new THREE.Vector3(toTarget.x, 0, toTarget.z);
      const dist = horizontal.length();
      if(dist > 0.15){
        const speed = 12;
        const move = horizontal.normalize().multiplyScalar(speed * dt);
        if(move.length() > dist) move.setLength(dist);
        const newX = this.mesh.position.x + move.x;
        const newZ = this.mesh.position.z + move.z;
        const newY = chunkManager.getHeightAt(newX, newZ) + this.PLAYER_RADIUS;
        const prev = this.mesh.position.clone();
        this.mesh.position.set(newX, newY, newZ);
        const deltaMove = new THREE.Vector3().subVectors(this.mesh.position, prev);
        this.applyRolling(deltaMove);
      } else {
        this.targetPos = null;
      }
    } else {
      const h = chunkManager.getHeightAt(this.mesh.position.x, this.mesh.position.z) + 2.2;
      this.mesh.position.y = THREE.MathUtils.lerp(this.mesh.position.y, h, 0.08);
    }

    // align to normal
    const normal = this.sampleNormal(this.mesh.position.x, this.mesh.position.z);
    const fromUp = new THREE.Vector3(0,1,0);
    const targetQuat = new THREE.Quaternion().setFromUnitVectors(fromUp, normal);
    this.mesh.quaternion.slerp(targetQuat, Math.min(1, dt * 6));
  }
}