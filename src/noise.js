/* Compact Simplex noise exported as a module. (moved verbatim from original main.js) */
export class Simplex {
  constructor(seed=0){
    this.p = new Uint8Array(256);
    for(let i=0;i<256;i++) this.p[i]=i;
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
    const F2 = 0.366025403;
    const G2 = 0.211324865;
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