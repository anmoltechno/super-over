// Draws the match in 3D with WebGL: the engine (Scene3DCodec) sends the camera, the ball, every
// player's joints and the effects as numbers each frame; this builds the ground they play on,
// lights it, and adds the glow of the floodlights.
import * as THREE from './vendor/three.js';
import { buildVenue } from './venue3d.js?v=3e8390bab3';
import { Figures } from './figures3d.js?v=3e8390bab3';

const BALL_RADIUS = 0.036;
const HALF_WIDTH = 1.525, STUMPS_Y = 10.06;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/// Rings, discs and bars painted on the grass: the bowler's target, where it pitched, who's chasing.
class Decals {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.bars = [];
    this.usedRings = 0;
    this.usedBars = 0;
    this.plane = new THREE.PlaneGeometry(2, 2);
    this.unit = new THREE.PlaneGeometry(1, 1);
  }

  begin() {
    this.usedRings = 0;
    this.usedBars = 0;
  }

  /// A ring of `radius` and `width` meters (and its middle filled to `fill`), on the ground.
  ring(x, y, radius, width, color, alpha, fill = 0, boost = 1) {
    let mesh = this.rings[this.usedRings];
    if (!mesh) {
      const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uInner: { value: 0.8 }, uFill: { value: 0 }, uBoost: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */`
          uniform vec3 uColor; uniform float uAlpha, uInner, uFill, uBoost; varying vec2 vUv;
          void main() {
            float r = length(vUv), w = fwidth(r) * 1.5;
            float edge = smoothstep(uInner - w, uInner, r) * (1.0 - smoothstep(1.0 - w, 1.0, r));
            float a = max(edge, uFill * (1.0 - smoothstep(uInner - w, uInner, r))) * uAlpha;
            if (a < 0.004) discard;
            gl_FragColor = vec4(uColor * uBoost, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      mesh = new THREE.Mesh(this.plane, material);
      mesh.renderOrder = -10;
      this.rings.push(mesh);
      this.scene.add(mesh);
    }
    this.usedRings += 1;
    mesh.visible = true;
    mesh.position.set(x, y, 0.02);
    mesh.scale.set(radius, radius, 1);
    const u = mesh.material.uniforms;
    u.uColor.value.setHex(color);
    u.uAlpha.value = alpha;
    u.uInner.value = Math.max(0, 1 - width / radius);
    u.uFill.value = fill;
    u.uBoost.value = boost;
  }

  /// A flat bar from (ax, ay) to (bx, by), `width` meters wide.
  bar(ax, ay, bx, by, width, color, alpha) {
    let mesh = this.bars[this.usedBars];
    if (!mesh) {
      mesh = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      mesh.renderOrder = -11;
      this.bars.push(mesh);
      this.scene.add(mesh);
    }
    this.usedBars += 1;
    mesh.visible = true;
    const dx = bx - ax, dy = by - ay;
    mesh.position.set((ax + bx) / 2, (ay + by) / 2, 0.018);
    mesh.rotation.z = Math.atan2(dy, dx);
    mesh.scale.set(Math.hypot(dx, dy), width, 1);
    mesh.material.color.setHex(color);
    mesh.material.opacity = alpha;
  }

  end() {
    for (let i = this.usedRings; i < this.rings.length; i++) this.rings[i].visible = false;
    for (let i = this.usedBars; i < this.bars.length; i++) this.bars[i].visible = false;
  }
}

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.3 }, uGrain: { value: 0.02 }, uTime: { value: 0 }, uSaturation: { value: 1.12 }, uContrast: { value: 1.05 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVignette, uGrain, uTime, uSaturation, uContrast; varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      vec2 d = (vUv - 0.5) * vec2(1.0, 1.1);
      c.rgb *= mix(1.0 - uVignette, 1.0, smoothstep(0.82, 0.25, length(d)));
      c.rgb += (hash(vUv * 1400.0 + fract(uTime) * 91.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
    }`,
};

export class Scene3D {
  /// A renderer on `canvas`, or null where WebGL 2 isn't to be had.
  static create(canvas, grounds, options = {}) {
    try {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return null;
      return new Scene3D(canvas, grounds, options);
    } catch (error) {
      console.warn('3D renderer unavailable:', error);
      return null;
    }
  }

  constructor(canvas, grounds, { quality = null } = {}) {
    this.grounds = grounds;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, alpha: false, powerPreference: 'high-performance' });
    // A shader this device can't compile would leave part of the ground undrawn: the page then
    // goes back to the flat renderer.
    this.failed = null;
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      this.failed = `shader: ${gl.getProgramInfoLog(program) || gl.getShaderInfoLog(fragment) || gl.getShaderInfoLog(vertex) || 'would not link'}`;
    };
    const gl = this.renderer.getContext();
    // Light brighter than white (lamps, LED stumps) needs a float buffer to bloom from.
    this.hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(0x060c1a, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.venue = null;
    this.venueIndex = -1;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.pinned = quality !== null;
    const phone = matchMedia('(pointer: coarse)').matches;
    this.quality = quality ?? Number(localStorage.getItem('superover.quality') ?? (phone ? 1 : 2));
    this.slow = 0;
    this.frames = 0;
    this.time = 0;

    this.figures = new Figures(this.scene);
    this.decals = new Decals(this.scene);
    this.ballColors = [new THREE.Color(0xb3202a), new THREE.Color(0xf4f2ec), new THREE.Color(0xf0569a)];
    this.buildBall();
    this.buildTrail();
    this.buildParticles();
    this.buildBlobs();
    this.composer = null;
  }

  // MARK: The ball

  buildBall() {
    const group = new THREE.Group();
    this.ballMaterial = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.0 });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.ballMaterial));
    this.seamMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    // The seam is the great circle square to the ball's own x axis, with a row of stitches either side.
    for (const [offset, tube] of [[0, 0.05], [0.13, 0.025], [-0.13, 0.025]]) {
      const radius = Math.sqrt(1 - offset * offset) * 1.005;
      const seam = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 28), this.seamMaterial);
      seam.rotation.y = Math.PI / 2;
      seam.position.x = offset;
      group.add(seam);
    }
    this.ball = group;
    this.scene.add(group);
    const glow = glowTexture();
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.3, fog: false }));
    this.scene.add(this.halo);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({ color: 0x020a04, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 }));
    this.ballShadow.renderOrder = -9;
    this.scene.add(this.ballShadow);
    this.glow = glow;
  }

  buildTrail() {
    const max = 44;
    const g = new THREE.BufferGeometry();
    this.trailPositions = new Float32Array(max * 2 * 3);
    this.trailAlphas = new Float32Array(max * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.trailAlphas, 1).setUsage(THREE.DynamicDrawUsage));
    const indices = [];
    for (let i = 0; i < max - 1; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(indices);
    this.trailMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: 'attribute float aAlpha; varying float vAlpha; void main() { vAlpha = aAlpha; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uColor; varying float vAlpha; void main() { gl_FragColor = vec4(uColor, vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.trail = new THREE.Mesh(g, this.trailMaterial);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 3;
    this.scene.add(this.trail);
  }

  buildParticles() {
    const max = 1300;
    const g = new THREE.BufferGeometry();
    this.pPosition = new Float32Array(max * 3);
    this.pColor = new Float32Array(max * 4);
    this.pShape = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPosition, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.pColor, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.pShape, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      // Colour arrives premultiplied; a particle with no alpha left adds its light instead of covering.
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uScale: { value: 1000 } },
      vertexShader: /* glsl */`
        attribute vec4 aColor; attribute vec3 aShape; uniform float uScale;
        varying vec4 vColor; varying vec3 vShape;
        void main() {
          vColor = aColor;
          vShape = aShape;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aShape.x * uScale / max(0.1, -mv.z), 1.5, 220.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec4 vColor; varying vec3 vShape;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float a;
          if (vShape.y > 2.5 && vShape.y < 3.5) {
            // Confetti: a scrap of paper tumbling.
            float c = cos(vShape.z), s = sin(vShape.z);
            vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
            q.y /= max(0.25, abs(cos(vShape.z * 1.7)));
            a = step(abs(q.x), 0.8) * step(abs(q.y), 0.55);
          } else {
            float r = length(p);
            a = smoothstep(1.0, vShape.y > 1.5 ? 0.0 : 0.45, r);
          }
          if (a < 0.01) discard;
          float additive = step(1.5, vShape.y) * (1.0 - step(2.5, vShape.y)) + step(3.5, vShape.y);
          gl_FragColor = vec4(vColor.rgb * vColor.a * a * mix(1.0, 3.5, additive), vColor.a * a * (1.0 - additive));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.particles = new THREE.Points(g, this.particleMaterial);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 8;
    this.scene.add(this.particles);
    this.particleTint = new THREE.Color();
  }

  /// A soft dark patch under every player, so their feet sit on the grass.
  buildBlobs() {
    const material = new THREE.MeshBasicMaterial({ map: this.glow, color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), material, 24);
    this.blobs.frustumCulled = false;
    this.blobs.renderOrder = -25;
    this.scene.add(this.blobs);
    this.blobMatrix = new THREE.Matrix4();
  }

  // MARK: Size and quality

  resize(width, height, dpr) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.applyQuality();
  }

  applyQuality() {
    const cap = [1.25, 1.6, 2][this.quality] ?? 2;
    const ratio = Math.min(this.dpr, cap);
    this.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.composer = null;
    }
    if (this.quality >= 1) {
      const w = Math.round(this.width * ratio), h = Math.round(this.height * ratio);
      const target = new THREE.WebGLRenderTarget(w, h, { samples: this.quality >= 2 ? 4 : 2, type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, stencilBuffer: true });
      this.composer = new THREE.EffectComposer(this.renderer, target);
      this.composer.setPixelRatio(1);
      this.composer.setSize(w, h);
      this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
      this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.5, 0.6, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new THREE.OutputPass());
      this.grade = new THREE.ShaderPass(GRADE);
      this.composer.addPass(this.grade);
      this.applyLook();
    }
  }

  applyLook() {
    if (!this.venue || !this.bloom) return;
    const [strength, radius, threshold] = this.venue.palette.bloom;
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
    this.grade.uniforms.uVignette.value = this.venue.palette.night ? 0.42 : 0.26;
  }

  /// Drops a level when frames are taking too long (and remembers it for next time).
  watch(dt) {
    if (this.pinned || this.quality === 0) return;
    this.frames += 1;
    if (this.frames < 120) return;
    if (dt > 1 / 34) this.slow += 1;
    else this.slow = Math.max(0, this.slow - 0.5);
    if (this.slow > 80) {
      this.slow = 0;
      this.frames = 0;
      this.quality -= 1;
      localStorage.setItem('superover.quality', String(this.quality));
      this.applyQuality();
    }
  }

  // MARK: A frame

  setVenue(index) {
    if (index === this.venueIndex) return;
    if (this.venue) {
      this.scene.remove(this.venue.group);
      this.venue.dispose();
    }
    this.venueIndex = index;
    this.venue = buildVenue(this.grounds[index], index);
    this.scene.add(this.venue.group);
    this.scene.fog = this.venue.fog;
    this.figures.setShadows(this.venue.shadows);
    const pal = this.venue.palette;
    this.figures.rim.value.copy(pal.night ? new THREE.Color(0.3, 0.36, 0.5) : pal.sunColor.clone().multiplyScalar(0.3));
    this.renderer.toneMappingExposure = pal.exposure;
    this.trailMaterial.blending = pal.night ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.applyLook();
  }

  setCamera(f, shakeX, shakeY) {
    const px = f[1], py = f[2], pz = f[3], fx = f[4], fy = f[5], fz = f[6], rx = f[7], ry = f[8], rz = f[9], ux = f[10], uy = f[11], uz = f[12];
    const focal = f[13], cx = f[14] + shakeX, cy = f[15] + shakeY, w = f[16], h = f[17];
    const camera = this.camera;
    camera.matrixWorld.set(rx, ux, -fx, px, ry, uy, -fy, py, rz, uz, -fz, pz, 0, 0, 0, 1);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.position.set(px, py, pz);
    const near = 0.4, far = 2400;
    // A pinhole with its principal point wherever the engine put it.
    camera.projectionMatrix.set(
      (2 * focal) / w, 0, 1 - (2 * cx) / w, 0,
      0, (2 * focal) / h, (2 * cy) / h - 1, 0,
      0, 0, -(far + near) / (far - near), (-2 * far * near) / (far - near),
      0, 0, -1, 0);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.focal = focal;
    this.viewWidth = w;
    this.viewHeight = h;
  }

  /// Draws the frame in the engine's scene stream `f`.
  render(f, dt) {
    if (!f.length || f[0] !== 3) return;
    this.time += dt;
    this.watch(dt);
    const lights = f[19], clock = f[20], excitement = f[22], flags = f[23] | 0;
    this.setVenue(f[18] | 0);
    this.setCamera(f, f[24], f[25]);
    const venue = this.venue, pal = venue.palette;
    venue.update(clock, lights, excitement, dt);

    // The ball.
    const hasBall = f[26] > 0.5;
    const ballColor = this.ballColors[f[34] | 0] || this.ballColors[0];
    this.ball.visible = this.halo.visible = this.ballShadow.visible = hasBall;
    let drawn = BALL_RADIUS;
    const bx = f[27], by = f[28], bz = f[29];
    if (hasBall) {
      const depth = (bx - f[1]) * f[4] + (by - f[2]) * f[5] + (bz - f[3]) * f[6];
      const perMeter = this.focal / Math.max(0.5, depth);
      // Never smaller than a speck you can follow.
      const least = Math.max(2.6, Math.min(this.viewWidth, this.viewHeight) * 0.0085);
      drawn = Math.max(BALL_RADIUS, least / perMeter);
      this.ball.position.set(bx, by, Math.max(bz, drawn * 0.9));
      this.ball.quaternion.set(f[30], f[31], f[32], f[33]);
      this.ball.scale.setScalar(drawn);
      this.ballMaterial.color.copy(ballColor);
      this.seamMaterial.color.setHex((f[34] | 0) === 0 ? 0xf3e6c8 : 0x2e5e3a);
      this.halo.position.copy(this.ball.position);
      this.halo.scale.setScalar(drawn * 6);
      this.halo.material.opacity = pal.night ? 0.34 : 0.2;
      const height = Math.max(0, bz - BALL_RADIUS);
      const shadow = Math.max(drawn * 0.95, BALL_RADIUS * (1.3 + height * 0.18));
      this.ballShadow.position.set(bx, by, 0.016);
      this.ballShadow.scale.set(shadow, shadow, 1);
      this.ballShadow.material.opacity = Math.min(0.6, 0.55 / (1 + height * 0.5) + 0.1);
    }

    // Its trail: a ribbon turned to face the camera, fading out behind.
    let o = 36;
    const trailCount = f[o] | 0;
    o += 1;
    this.drawTrail(f, o, trailCount, hasBall, bx, by, bz, drawn);
    o += trailCount * 3;

    // Stumps, then players.
    this.figures.begin();
    const led = (flags & 8) !== 0;
    this.figures.stumps(f, o, led);
    this.figures.stumps(f, o + 32, led);
    o += 64;
    const figureCount = f[o] | 0;
    const figureStart = o;
    o = this.figures.read(f, o, ballColor);
    this.figures.end();

    // Marks on the grass.
    this.decals.begin();
    let blobs = 0;
    for (let i = 0; i < figureCount && blobs < 24; i++) {
      const at = figureStart + 1 + i * 100;
      const x = f[at + 98], y = f[at + 99], scale = f[at + 11];
      this.blobMatrix.makeScale(0.5 * scale, 0.5 * scale, 1).setPosition(x, y, 0.012);
      this.blobs.setMatrixAt(blobs++, this.blobMatrix);
      if ((f[at + 1] | 0) & 1) {
        const pulse = 0.75 + 0.25 * Math.sin(clock * 6);
        this.decals.ring(x, y, 0.78, 0.09, 0xffd54f, 0.9 * pulse, 0, pal.night ? 1.6 : 1);
      }
    }
    this.blobs.count = blobs;
    this.blobs.instanceMatrix.needsUpdate = true;

    // Particles.
    const particleCount = Math.min(f[o] | 0, 1300);
    o += 1;
    this.drawParticles(f, o, particleCount);
    o += (f[o - 1] | 0) * 11;

    const markerCount = f[o] | 0;
    o += 1;
    for (let i = 0; i < markerCount; i++, o += 6) this.marker(f[o] | 0, f[o + 1], f[o + 2], f[o + 3], f[o + 4], clock, pal);
    this.decals.end();

    this.particleMaterial.uniforms.uScale.value = this.focal * this.ratio * 2;
    if (this.composer) {
      this.grade.uniforms.uTime.value = this.time;
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  drawTrail(f, o, count, hasBall, bx, by, bz, drawn) {
    const n = hasBall ? count + 1 : 0;
    if (n < 2) {
      this.trail.visible = false;
      return;
    }
    this.trail.visible = true;
    const P = this.trailPositions, A = this.trailAlphas;
    const cx = this.camera.position.x, cy = this.camera.position.y, cz = this.camera.position.z;
    const total = Math.min(n, 44);
    const skip = n - total;
    const point = (i) => {
      const k = i + skip;
      return k < count ? [f[o + k * 3], f[o + k * 3 + 1], f[o + k * 3 + 2]] : [bx, by, bz];
    };
    for (let i = 0; i < total; i++) {
      const p = point(i), q = point(Math.min(total - 1, i + 1)), b = point(Math.max(0, i - 1));
      // Sideways on screen: across both the path and the line of sight.
      const tx = q[0] - b[0], ty = q[1] - b[1], tz = q[2] - b[2];
      const vx = cx - p[0], vy = cy - p[1], vz = cz - p[2];
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const l = Math.hypot(sx, sy, sz) || 1;
      const t = i / (total - 1);
      const w = drawn * 1.1 * t;
      sx = (sx / l) * w; sy = (sy / l) * w; sz = (sz / l) * w;
      P[i * 6] = p[0] + sx; P[i * 6 + 1] = p[1] + sy; P[i * 6 + 2] = p[2] + sz;
      P[i * 6 + 3] = p[0] - sx; P[i * 6 + 4] = p[1] - sy; P[i * 6 + 5] = p[2] - sz;
      A[i * 2] = A[i * 2 + 1] = 0.55 * t * t;
    }
    const g = this.trail.geometry;
    g.setDrawRange(0, (total - 1) * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  drawParticles(f, o, count) {
    const P = this.pPosition, C = this.pColor, S = this.pShape, tint = this.particleTint;
    for (let i = 0; i < count; i++, o += 11) {
      const kind = f[o] | 0, fade = f[o + 9];
      tint.setHex(f[o + 1]);
      P[i * 3] = f[o + 2]; P[i * 3 + 1] = f[o + 3]; P[i * 3 + 2] = f[o + 4];
      let alpha = fade, size = f[o + 8];
      if (kind === 0) alpha = 0.4 * fade;
      else if (kind === 1) { alpha = 0.9 * fade; size *= 1.6; }
      else if (kind === 2) size *= 2.2;
      else if (kind === 3) { alpha = Math.min(1, fade * 3); size *= 1.5; }
      else if (kind === 4) size *= 1.3;
      C[i * 4] = tint.r; C[i * 4 + 1] = tint.g; C[i * 4 + 2] = tint.b; C[i * 4 + 3] = alpha;
      S[i * 3] = size; S[i * 3 + 1] = kind; S[i * 3 + 2] = f[o + 10];
    }
    const g = this.particles.geometry;
    g.setDrawRange(0, count);
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aShape.needsUpdate = true;
    this.particles.visible = count > 0;
  }

  marker(kind, x, y, a, b, clock, pal) {
    const d = this.decals;
    const boost = pal.night ? 1.5 : 1;
    switch (kind) {
      case 0: {
        // The bowler's target, and the ring that closes on it as he runs in.
        d.ring(x, y, 0.17, 0.035, 0xffd54f, 0.95, 0.32, boost);
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) d.bar(x + dx * 0.23, y + dy * 0.23, x + dx * 0.38, y + dy * 0.38, 0.03, 0xffd54f, 0.9);
        if (a >= 0) d.ring(x, y, 0.17 + 0.95 * a, 0.04 + 0.02 * a, b > 0.5 ? 0x7cff6b : 0xffffff, 0.95, 0, boost);
        break;
      }
      case 1: {
        const fade = Math.min(1, Math.max(0.25, 1 - a / 6));
        d.ring(x, y, 0.1, 0.05, 0xff5a4e, 0.9 * fade, 0.9, boost);
        break;
      }
      case 2:
        d.ring(x, y, 0.21, 0.04, 0xffd54f, 0.9 * a * (0.7 + 0.3 * Math.sin(clock * 10)), 0.12, boost);
        break;
      case 3: {
        const zones = [[STUMPS_Y - 1.9, STUMPS_Y - 0.3, 0xff4f7b], [STUMPS_Y - 4.8, STUMPS_Y - 1.9, 0x4fc3f7], [STUMPS_Y - 7.8, STUMPS_Y - 4.8, 0x7cff6b], [STUMPS_Y - 10.6, STUMPS_Y - 7.8, 0xffb74d]];
        for (const [y0, y1, color] of zones) {
          d.bar(0, y0, 0, y1, 2 * HALF_WIDTH, color, 0.2 * a);
          d.bar(-HALF_WIDTH, y0, HALF_WIDTH, y0, 0.035, color, 0.7 * a);
        }
        break;
      }
      default:
        d.ring(x, y, 0.75, 0.09, 0xffffff, 0.6 * (0.6 + 0.4 * Math.sin(clock * 9)), 0, boost);
    }
  }
}
