// The ground and everything round it, built in 3D for one venue: sky, outfield, the strip, the
// rope and boards, stands full of people, floodlights, and the trees, flats and pavilion of the
// smaller grounds. World coordinates are the engine's: x across, y down the pitch, z up, meters.
import * as THREE from './vendor/three.js';

const TAU = Math.PI * 2;
const PITCH = { stumpsY: 10.06, creaseY: 8.84, halfWidth: 1.525, returnCreaseX: 1.32, creaseHalfLength: 1.83, wideLine: 0.95, circleRadius: 27.43 };

export function mulberry(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.pick = (items) => items[Math.floor(next() * items.length) % items.length];
  next.chance = (p) => next() < p;
  return next;
}

const color = (hex) => new THREE.Color(hex);
const mixHex = (a, b, t) => color(a).lerp(color(b), t);

// MARK: Palettes (the engine's ScenePalette, plus what a lit 3D scene needs)

export function paletteFor(info) {
  const dry = info.dryness;
  const grass = (lush, baked) => mixHex(lush, baked, dry);
  const overcast = info.weather === 'overcast';
  const hazy = info.weather === 'hazy';
  switch (info.timeOfDay) {
    case 'day':
      return {
        night: false, floodlit: false,
        skyTop: color(overcast ? 0x7f8c9c : (hazy ? 0x6f9fd0 : 0x2f7fd6)), skyHorizon: color(overcast ? 0xd3d9df : (hazy ? 0xe6e1d3 : 0xbfe2f7)),
        haze: color(overcast ? 0xdce1e6 : 0xede6d6), clouds: overcast ? 0.85 : (hazy ? 0.35 : 0.18), cloudColor: color(overcast ? 0xe9edf1 : 0xffffff),
        grassLight: grass(overcast ? 0x5c9a45 : 0x67a846, 0xa9a85a), grassDark: grass(overcast ? 0x4c873a : 0x56943a, 0x95924c),
        apron: grass(0x3f7a33, 0x8a8048), pitch: color(0xd8c38e), pitchDark: color(0xb89e68), line: color(0xfbfbf6),
        standDark: color(0x3b4452), standLight: color(0x5e6979), roof: color(0x2d343e), seat: color(0x56627a),
        trees: color(overcast ? 0x4f8a45 : 0x4c9440), rope: color(0xf5f5f0),
        sun: new THREE.Vector3(-0.42, -0.38, 0.82).normalize(), sunColor: color(overcast ? 0xf2f4f7 : 0xfff3dc), sunPower: overcast ? 1.5 : 2.9,
        skyLight: color(overcast ? 0xcfd8e2 : 0xbcd9ff), groundLight: color(0x6f8a4f), ambient: overcast ? 1.55 : 1.15,
        shadow: overcast ? 0.22 : 0.42, crowdLight: overcast ? 0.82 : 1.0, fog: [overcast ? 150 : 220, overcast ? 620 : 900],
        exposure: 1.0, bloom: [0.18, 0.5, 1.1], sunDisc: overcast ? 0 : 0.5,
      };
    case 'golden':
      return {
        night: false, floodlit: false,
        skyTop: color(0x3566b8), skyHorizon: color(0xffc98a), haze: color(0xffd9a8), clouds: 0.3, cloudColor: color(0xffe1c0),
        grassLight: grass(0x74ac3f, 0xb4a55a), grassDark: grass(0x5c9633, 0x9e904a), apron: grass(0x4c8030, 0x8c7a40),
        pitch: color(0xe3c489), pitchDark: color(0xc09e63), line: color(0xfff9ee),
        standDark: color(0x5d5450), standLight: color(0x857468), roof: color(0x4a423f), seat: color(0x7a6a60),
        trees: color(0x5a8a38), rope: color(0xffffff),
        sun: new THREE.Vector3(-0.78, -0.46, 0.36).normalize(), sunColor: color(0xffd9a6), sunPower: 2.3,
        skyLight: color(0xc4d4ff), groundLight: color(0x8a7a48), ambient: 1.35,
        shadow: 0.46, crowdLight: 1.05, fog: [200, 820], exposure: 1.0, bloom: [0.28, 0.6, 1.0], sunDisc: 1,
      };
    case 'dusk':
      return {
        night: true, floodlit: true,
        skyTop: color(0x1c1a4a), skyHorizon: color(0xe8825e), haze: color(0xc47a66), clouds: 0.75, cloudColor: color(0x6b4f74),
        grassLight: grass(0x449445, 0x8e9450), grassDark: grass(0x35823a, 0x7c8244), apron: grass(0x266e33, 0x6a6a3a),
        pitch: color(0xd2b98a), pitchDark: color(0xae9466), line: color(0xf7f9ff),
        standDark: color(0x1e2030), standLight: color(0x30344a), roof: color(0x15161f), seat: color(0x343a55),
        trees: color(0x1f2e26), rope: color(0xffffff),
        sun: new THREE.Vector3(-0.3, 0.9, 0.12).normalize(), sunColor: color(0xff9a6a), sunPower: 0.35,
        skyLight: color(0x8a86c8), groundLight: color(0x3a5a3f), ambient: 0.62,
        shadow: 0.17, crowdLight: 0.86, fog: [170, 760], exposure: 1.0, bloom: [0.34, 0.5, 1.0], sunDisc: 0.6, lamp: color(0xf5f8ff), lampPower: 0.92,
      };
    default:
      return {
        night: true, floodlit: true,
        skyTop: color(0x02040c), skyHorizon: color(0x131d44), haze: color(0x1b2550), clouds: 0, cloudColor: color(0x2a2f45),
        grassLight: grass(0x3a8f42, 0x7d8a48), grassDark: grass(0x2c7a37, 0x6c7840), apron: grass(0x1c5e2d, 0x58603a),
        pitch: color(0xd6c08f), pitchDark: color(0xaf976a), line: color(0xf7f9ff),
        standDark: color(0x0b0e19), standLight: color(0x171d30), roof: color(0x070910), seat: color(0x1d2540),
        trees: color(0x0e1812), rope: color(0xffffff),
        sun: new THREE.Vector3(0.3, 0.6, 0.6).normalize(), sunColor: color(0x8fa6ff), sunPower: 0.08,
        skyLight: color(0x5a6cb0), groundLight: color(0x244a30), ambient: 0.5,
        shadow: 0.19, crowdLight: 0.9, fog: [190, 840], exposure: 1.0, bloom: [0.36, 0.5, 1.0], sunDisc: 0, lamp: color(0xf7faff), lampPower: 1.05,
      };
  }
}

// MARK: Geometry helpers

/// The rope's distance from the middle in direction `a`.
export function boundary(info, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return 1 / Math.sqrt((c * c) / (info.square * info.square) + (s * s) / (info.straight * info.straight));
}

/// A point `beyond` meters outside the rope in direction `a`, at height `z`.
export function ring(info, a, beyond, z = 0, out = new THREE.Vector3()) {
  const d = boundary(info, a) + beyond;
  return out.set(Math.cos(a) * d, Math.sin(a) * d, z);
}

/// A band running round the ground between two rings (each `[beyond, z]`), with u along it (in
/// `uUnit` meters, measured at `uBeyond`) and v across it from 0 to `vSpan`.
function band(info, segments, inner, outer, { uUnit = 1, vSpan = 1, uBeyond = null, open = null, from = 0, to = TAU } = {}) {
  const positions = [], uvs = [], opens = [], indices = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3(), m0 = new THREE.Vector3(), m1 = new THREE.Vector3();
  let u = 0;
  const measure = uBeyond ?? (inner[0] + outer[0]) / 2;
  for (let i = 0; i <= segments; i++) {
    const a = from + (to - from) * (i / segments);
    if (i > 0) {
      const b = from + (to - from) * ((i - 1) / segments);
      ring(info, b, measure, 0, m0);
      ring(info, a, measure, 0, m1);
      u += m0.distanceTo(m1) / uUnit;
    }
    ring(info, a, inner[0], inner[1], p);
    ring(info, a, outer[0], outer[1], q);
    positions.push(p.x, p.y, p.z, q.x, q.y, q.z);
    uvs.push(u, 0, u, vSpan);
    const isOpen = open ? open(a) : 1;
    opens.push(isOpen, isOpen);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 3, k + 2, k, k + 1, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aOpen', new THREE.Float32BufferAttribute(opens, 1));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.userData.length = u * uUnit;
  return g;
}

function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function canvasTexture(width, height, draw, { repeat = false, srgb = true, mips = true } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  draw(c.getContext('2d'), width, height);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.anisotropy = 8;
  return t;
}

const css = (c, a = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
/// A THREE.Color (linear) as the sRGB CSS colour a 2D canvas wants.
const cssOf = (c, a = 1) => {
  const s = c.clone().convertLinearToSRGB();
  return css(s, a);
};

const NOISE = /* glsl */`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}`;

// MARK: Sky

function buildSky(pal, info) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uTop: { value: pal.skyTop }, uHorizon: { value: pal.skyHorizon }, uHaze: { value: pal.haze }, uCloud: { value: pal.cloudColor },
      uClouds: { value: pal.clouds }, uSun: { value: pal.sun }, uSunColor: { value: pal.sunColor }, uSunDisc: { value: pal.sunDisc },
      uStars: { value: pal.night && info.weather === 'clear' && info.timeOfDay === 'night' ? 1 : 0 }, uTime: { value: 0 },
      uGlow: { value: pal.floodlit ? 1 : 0 }, uLights: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uHorizon, uHaze, uCloud, uSun, uSunColor;
      uniform float uClouds, uSunDisc, uStars, uTime, uGlow, uLights;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.z, 0.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        // Haze hugging the horizon, and the ground's colour below it.
        col = mix(col, uHaze, pow(1.0 - h, 9.0) * 0.75);
        // The sun and its glow.
        float s = max(dot(d, uSun), 0.0);
        col += uSunColor * (pow(s, 600.0) * 5.0 + pow(s, 24.0) * 0.5 + pow(s, 4.0) * 0.16) * uSunDisc;
        // A sheet of cloud.
        if (uClouds > 0.01 && d.z > 0.015) {
          vec2 uv = d.xy / (d.z + 0.18) * 1.5 + vec2(uTime * 0.004, 0.0);
          float c = fbm(uv);
          float cover = smoothstep(1.0 - uClouds * 0.85, 1.15 - uClouds * 0.5, c + 0.28);
          vec3 lit = mix(uCloud * 0.72, uCloud, smoothstep(0.35, 0.8, fbm(uv + 3.1)));
          lit += uSunColor * pow(s, 6.0) * 0.35 * uSunDisc;
          col = mix(col, lit, cover * smoothstep(0.015, 0.22, d.z) * 0.92);
        }
        // Stars.
        if (uStars > 0.5 && d.z > 0.02) {
          vec2 g = d.xy / (d.z + 0.6) * 150.0;
          vec2 cell = floor(g);
          float r = hash12(cell);
          vec2 at = vec2(hash12(cell + 3.7), hash12(cell + 9.1));
          float star = smoothstep(0.16, 0.0, length(fract(g) - at)) * step(0.93, r);
          float twinkle = 0.6 + 0.4 * sin(uTime * (1.0 + r * 3.0) + r * 60.0);
          col += vec3(0.9, 0.95, 1.0) * star * twinkle * smoothstep(0.02, 0.4, d.z) * 1.4;
        }
        // The floodlights' glow in the air above the bowl.
        col += vec3(0.16, 0.2, 0.34) * uGlow * uLights * pow(1.0 - h, 5.0) * 0.5;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

// MARK: Grass

function buildGround(pal, info) {
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uLight: { value: pal.grassLight }, uDark: { value: pal.grassDark }, uApron: { value: pal.apron }, uGround: { value: new THREE.Vector2(info.square, info.straight) },
      uTint: { value: new THREE.Color(1, 1, 1) }, uPool: { value: pal.floodlit ? 1 : 0 }, uLights: { value: 1 }, uDry: { value: info.dryness },
      uSunXY: { value: new THREE.Vector2(pal.sun.x, pal.sun.y) }, uWarm: { value: info.timeOfDay === 'golden' ? 1 : 0 },
    }]),
    vertexShader: /* glsl */`
      varying vec2 vPos;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xy;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uLight, uDark, uApron, uTint;
      uniform vec2 uGround, uSunXY;
      uniform float uPool, uLights, uDry, uWarm;
      varying vec2 vPos;
      #include <fog_pars_fragment>
      ${NOISE}
      float band(float x, float w) {
        float t = abs(fract(x) * 2.0 - 1.0);
        float f = fwidth(x) * 2.0 + 0.002;
        return smoothstep(0.5 - f, 0.5 + f, t) * (1.0 - smoothstep(0.35, 1.2, f)) + 0.5 * smoothstep(0.35, 1.2, f);
      }
      void main() {
        float reach = length(vPos / uGround);
        // Mown in stripes down the ground and across it: the nap lies one way, then the other,
        // so which stripes look light depends on where you're watching from.
        float along = band(vPos.y / 14.0, 1.0);
        float across = band(vPos.x / 14.0 + 0.25, 1.0);
        vec2 toEye = normalize(cameraPosition.xy - vPos + 1e-4);
        float nap = mix(-1.0, 1.0, along) * -toEye.y;
        float check = (across - 0.5) * 0.36;
        float t = clamp(0.5 + nap * 0.5 + check, 0.0, 1.0);
        vec3 g = mix(uDark, uLight, t);
        // The square: shorter grass round the strip.
        vec2 sq = abs(vPos) - vec2(3.725, 14.16);
        float square = 1.0 - smoothstep(-0.1, 0.1, max(sq.x, sq.y));
        g = mix(g, uLight * 1.07, square * 0.85);
        // Blades and blotches.
        float n = fbm(vPos * 0.9) * 0.55 + vnoise(vPos * 9.0) * 0.3 + vnoise(vPos * 38.0) * 0.15;
        g *= 0.86 + 0.3 * n;
        float worn = smoothstep(0.55, 0.8, fbm(vPos * 0.07 + 4.0));
        g = mix(g, g * vec3(1.14, 1.06, 0.82), worn * (0.25 + uDry * 0.6));
        // Beyond the rope.
        float out_ = smoothstep(1.0, 1.012, reach);
        vec3 apron = uApron * (0.82 + 0.25 * vnoise(vPos * 0.6));
        g = mix(g, apron, out_);
        // Floodlit: brightest in the middle, falling away to the rope and beyond.
        float pool = mix(1.0, mix(0.5, 1.12, exp(-reach * reach * 0.85)) * (0.25 + 0.75 * uLights), uPool);
        g *= pool;
        // Low sun rakes across the grass.
        g += vec3(0.11, 0.07, 0.0) * uWarm * (0.5 + 0.5 * dot(toEye, -normalize(uSunXY)));
        gl_FragColor = vec4(g * uTint, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800, 1, 1), material);
  mesh.renderOrder = -50;
  return mesh;
}

/// The 22 yards: rolled clay with scuffed ends, cracks where it's dry and a green tinge where it seams.
function buildPitch(pal, info, rng) {
  const half = PITCH.halfWidth, end = PITCH.stumpsY + 2.6;
  const texture = canvasTexture(256, 2048, (ctx, w, h) => {
    let strip = pal.pitch.clone();
    if (info.seam > 0.7) strip.lerp(pal.grassLight, 0.32);
    if (info.turn > 0.8) strip.lerp(color(0xffffff), 0.08);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, cssOf(strip.clone().multiplyScalar(1.04)));
    g.addColorStop(0.5, cssOf(strip));
    g.addColorStop(1, cssOf(strip.clone().multiplyScalar(0.96)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // The roller's lanes.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.035)';
      ctx.fillRect((i * w) / 6, 0, w / 6, h);
    }
    // Grain.
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.06)' : 'rgba(60,40,10,0.07)';
      ctx.fillRect(rng() * w, rng() * h, rng.range(1, 3), rng.range(1, 5));
    }
    const px = w / (2 * half), py = h / (2 * end);
    const at = (x, y) => [(x + half) * px, (end - y) * py];
    // Scuffed, darker ends where the batters take guard and the bowlers land.
    for (const sign of [-1, 1]) {
      for (let i = 0; i < 46; i++) {
        const [cx, cy] = at(rng.range(-1.2, 1.2), sign * rng.range(PITCH.creaseY - 1.8, PITCH.stumpsY + 1.2));
        const r = rng.range(0.14, 0.5) * px;
        const blot = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        blot.addColorStop(0, cssOf(pal.pitchDark, 0.5));
        blot.addColorStop(1, cssOf(pal.pitchDark, 0));
        ctx.fillStyle = blot;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * rng.range(0.5, 1.4), rng() * Math.PI, 0, TAU);
        ctx.fill();
      }
    }
    if (info.turn > 0.6 || info.dryness > 0.5) {
      ctx.strokeStyle = cssOf(pal.pitchDark.clone().multiplyScalar(0.62), 0.75);
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 90; i++) {
        let x = rng.range(-1.35, 1.35), y = rng.range(-9, 9);
        ctx.beginPath();
        ctx.moveTo(...at(x, y));
        for (let k = 0; k < 5; k++) {
          x += rng.range(-0.22, 0.22);
          y += rng.range(-0.3, 0.3);
          ctx.lineTo(...at(x, y));
        }
        ctx.stroke();
      }
    } else if (info.seam > 0.7) {
      for (let i = 0; i < 900; i++) {
        const [cx, cy] = at(rng.range(-1.45, 1.45), rng.range(-10, 10));
        ctx.fillStyle = cssOf(pal.grassLight, rng.range(0.25, 0.6));
        ctx.fillRect(cx, cy, rng.range(1, 4), rng.range(2, 7));
      }
    }
    // The cut edge.
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  });
  const material = new THREE.MeshLambertMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * half, 2 * end), material);
  mesh.position.z = 0.002;
  mesh.renderOrder = -40;
  return mesh;
}

/// White lines: the creases, and the dashed circle thirty yards out.
function buildLines(pal, info) {
  const positions = [], indices = [];
  const add = (ax, ay, bx, by, w) => {
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (w / 2), ny = (dx / l) * (w / 2);
    const k = positions.length / 3;
    positions.push(ax + nx, ay + ny, 0, bx + nx, by + ny, 0, bx - nx, by - ny, 0, ax - nx, ay - ny, 0);
    indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const w = 0.05;
  for (const sign of [-1, 1]) {
    const crease = sign * PITCH.creaseY, stumps = sign * PITCH.stumpsY;
    add(-PITCH.creaseHalfLength - 0.4, crease, PITCH.creaseHalfLength + 0.4, crease, w);
    add(-PITCH.returnCreaseX, stumps, PITCH.returnCreaseX, stumps, w);
    for (const side of [-1, 1]) {
      add(side * PITCH.returnCreaseX, crease, side * PITCH.returnCreaseX, stumps + sign * 1.22, w);
      add(side * PITCH.wideLine, crease, side * PITCH.wideLine, crease - sign * 0.5, w * 0.8);
    }
  }
  // The circle: half-circles round each set of stumps, joined, in dashes.
  const r = PITCH.circleRadius, n = 60, points = [];
  for (let i = 0; i <= n; i++) points.push([Math.cos((i / n) * Math.PI) * r, PITCH.stumpsY + Math.sin((i / n) * Math.PI) * r]);
  for (let i = 0; i <= n; i++) points.push([Math.cos(Math.PI + (i / n) * Math.PI) * r, -PITCH.stumpsY + Math.sin(Math.PI + (i / n) * Math.PI) * r]);
  points.push(points[0]);
  let carried = 0;
  const dash = 0.9, gap = 2.6;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const length = Math.hypot(bx - ax, by - ay);
    let t = carried;
    while (t < length) {
      const e = Math.min(length, t + dash);
      add(ax + ((bx - ax) * t) / length, ay + ((by - ay) * t) / length, ax + ((bx - ax) * e) / length, ay + ((by - ay) * e) / length, 0.11);
      t += dash + gap;
    }
    carried = t - length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({ color: pal.line, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(g, material);
  mesh.position.z = 0.004;
  mesh.renderOrder = -30;
  return mesh;
}

// MARK: The rope and the boards

function buildRope(pal, info) {
  class Rope extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) { return ring(info, t * TAU, -0.2, 0.1, target); }
  }
  const geometry = new THREE.TubeGeometry(new Rope(), 240, 0.13, 8, true);
  const texture = canvasTexture(256, 16, (ctx, w, h) => {
    ctx.fillStyle = '#fbfbf6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = info.boardColor;
    ctx.fillRect(0, 0, w * 0.22, h);
  }, { repeat: true });
  texture.repeat.set(110, 1);
  return new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture }));
}

function buildBoards(pal, info) {
  const stadium = info.size >= 2;
  const h = stadium ? 1.0 : 0.75;
  const board = color(info.boardColor);
  const panels = 6, panelMeters = 13;
  const texture = canvasTexture(256 * panels, 64, (ctx, w, hh) => {
    const pw = w / panels;
    for (let i = 0; i < panels; i++) {
      const lit = i % 2 === 0;
      ctx.fillStyle = lit ? cssOf(board) : '#0d1118';
      ctx.fillRect(i * pw, 0, pw, hh);
      ctx.fillStyle = lit ? 'rgba(255,255,255,0.96)' : cssOf(board.clone().lerp(color(0xffffff), 0.45));
      ctx.font = `900 ${hh * 0.56}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const message = info.boards[i % info.boards.length];
      if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
      ctx.fillText(message, i * pw + pw / 2, hh * 0.54, pw * 0.9);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(i * pw, 0, 2, hh);
    }
  }, { repeat: true });
  const group = new THREE.Group();
  const gapAt = (a) => Math.abs(Math.sin(a)) > 0.992;
  // Four arcs, leaving the sightscreens clear.
  const gap = Math.asin(0.992);
  const arcs = [[-gap, gap], [Math.PI - gap, Math.PI + gap]];
  for (const [from, to] of arcs) {
    const g = band(info, 60, [3.2, 0], [3.2, h], { uUnit: panelMeters * panels, vSpan: 1, uBeyond: 3.2, from, to });
    // The boards face the middle: flip u so the words read from the pitch.
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, -uv.getX(i));
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, color: new THREE.Color(1, 1, 1).multiplyScalar(pal.night ? 1.5 : (stadium ? 0.95 : 0.85)) });
    group.add(new THREE.Mesh(g, material));
  }
  group.userData.texture = texture;
  group.userData.scrolls = info.size >= 3;
  void gapAt;
  return group;
}

function buildSightscreens(pal, info) {
  const group = new THREE.Group();
  const dark = info.ball === 'white';
  const width = info.size >= 2 ? 13 : 11, height = info.size >= 2 ? 6.5 : 5;
  for (const end of [-1, 1]) {
    const y = end * (info.straight + 5);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(width, 0.4, height), new THREE.MeshLambertMaterial({ color: pal.standDark.clone().multiplyScalar(0.7) }));
    frame.position.set(0, y + end * 0.2, height / 2);
    const slats = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = dark ? '#171b26' : '#f6f6f2';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 16, w, 2);
      ctx.fillRect(0, 0, 2, h);
    }, { repeat: true });
    slats.repeat.set(6, 5);
    const face = new THREE.Mesh(new THREE.BoxGeometry(width - 0.6, 0.1, height - 0.6),
      new THREE.MeshBasicMaterial({ map: slats, color: dark ? new THREE.Color(1, 1, 1) : new THREE.Color(1, 1, 1).multiplyScalar(pal.night ? 0.8 : 0.95) }));
    face.position.set(0, y - end * 0.05, height / 2);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, 0.3), new THREE.MeshLambertMaterial({ color: color(info.boardColor) }));
    trim.position.set(0, y - end * 0.07, height - 0.15);
    group.add(frame, face, trim);
  }
  return group;
}

// MARK: Stands and the crowd

function crowdMaterial(pal, info) {
  const colors = info.crowd.map((c) => color(c));
  const neutrals = [0x2b2f36, 0xe9e6e0, 0x4d5866, 0x7a2e2e, 0x1f3b5a].map(color);
  const all = [];
  // Seven in ten wear the colours.
  for (let i = 0; i < 12; i++) all.push(i < 8 ? colors[i % colors.length] : neutrals[i % neutrals.length]);
  const average = new THREE.Color(0, 0, 0);
  for (const c of all) average.add(c);
  average.multiplyScalar(1 / all.length);
  return new THREE.ShaderMaterial({
    fog: true, side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uColors: { value: all }, uSeat: { value: pal.seat }, uStair: { value: pal.standDark }, uAverage: { value: average },
      uAttendance: { value: info.attendance }, uTime: { value: 0 }, uExcite: { value: 0 }, uLightLevel: { value: pal.crowdLight },
      uNight: { value: pal.night ? 1 : 0 }, uLights: { value: 1 }, uRows: { value: 26 }, uWave: { value: 0 },
    }]),
    vertexShader: /* glsl */`
      attribute float aOpen;
      varying vec2 vUv;
      varying float vOpen;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vOpen = aOpen;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColors[12];
      uniform vec3 uSeat, uStair, uAverage;
      uniform float uAttendance, uTime, uExcite, uLightLevel, uNight, uLights, uRows, uWave;
      varying vec2 vUv;
      varying float vOpen;
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        vec2 cell = floor(vUv), f = fract(vUv);
        float r1 = hash12(cell), r2 = hash12(cell + 17.3), r3 = hash12(cell + 91.7);
        float aisle = step(mod(cell.x, 26.0), 0.99);
        float here = step(r1, uAttendance) * (1.0 - aisle) * step(0.5, vOpen);
        // On their feet when it's exciting; a wave now and then.
        float wave = uWave * smoothstep(0.75, 1.0, sin(cell.x * 0.012 - uTime * 1.7));
        float lively = clamp(uExcite + wave, 0.0, 1.0);
        float up = lively * (0.5 + 0.5 * sin(uTime * (7.0 + r2 * 5.0) + r1 * 40.0)) * step(r3, 0.3 + lively * 0.7);
        vec2 q = vec2(f.x - 0.5, f.y - up * 0.2);
        float body = smoothstep(0.4, 0.3, abs(q.x)) * smoothstep(0.0, 0.08, q.y) * smoothstep(0.64, 0.56, q.y);
        float arms = up * smoothstep(0.46, 0.4, abs(q.x)) * smoothstep(0.3, 0.26, abs(abs(q.x) - 0.36) * 4.0) * smoothstep(0.5, 0.6, q.y) * smoothstep(0.98, 0.9, q.y);
        float head = smoothstep(0.19, 0.13, length(q - vec2(0.0, 0.74)));
        vec3 shirt = uColors[int(floor(r2 * 11.999))] * (0.72 + 0.5 * r3);
        vec3 skin = mix(vec3(0.72, 0.42, 0.24), vec3(0.14, 0.07, 0.04), r1 * r1);
        vec3 seat = mix(uSeat * (0.9 + 0.2 * step(0.5, fract(cell.y * 0.5))), uStair, aisle);
        seat = mix(uStair, seat, step(0.5, vOpen));
        vec3 col = seat;
        col = mix(col, shirt, max(body, arms) * here);
        col = mix(col, skin, head * here);
        // A long way off a seat is smaller than a pixel: settle to the colour of the block.
        float fw = max(fwidth(vUv.x), fwidth(vUv.y));
        vec3 blockColor = mix(seat, mix(shirt, skin, 0.18), here * 0.6);
        col = mix(col, blockColor, smoothstep(0.3, 0.9, fw));
        vec3 far = mix(seat, uAverage * (0.9 + 0.2 * vnoise(vUv * 0.15)), uAttendance * 0.62 * (1.0 - aisle) * step(0.5, vOpen));
        col = mix(col, far, smoothstep(1.2, 3.0, fw));
        // Under the roof at the back; the floodlights reach the front rows best.
        float row = clamp(vUv.y / uRows, 0.0, 1.0);
        float lit = uLightLevel * mix(1.0 - 0.3 * row, (1.0 - 0.45 * row) * (0.2 + 0.8 * uLights), uNight);
        col *= lit;
        // Phones and camera flashes in the dark.
        float flash = step(0.9992 - lively * 0.0012, hash12(cell + floor(uTime * 10.0) * 7.0)) * here * uNight * uLights;
        col += vec3(5.0) * flash * smoothstep(0.75, 0.5, length(f - 0.5) * (1.0 - smoothstep(0.3, 1.0, fw)));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

function buildStands(pal, info) {
  const group = new THREE.Group();
  const segments = 144;
  const tiers = info.size >= 3 ? [[9, 1.6, 24, 11], [37, 15.5, 26, 15]] : [[9, 1.6, 22, 10]];
  const open = (a) => (Math.abs(Math.sin(a)) > 0.9962 ? 0 : 1);
  const crowd = crowdMaterial(pal, info);
  const dark = new THREE.MeshLambertMaterial({ color: pal.standDark.clone().multiplyScalar(0.8), side: THREE.DoubleSide });
  const wall = new THREE.MeshLambertMaterial({ color: pal.standDark, side: THREE.DoubleSide });
  const roof = new THREE.MeshLambertMaterial({ color: pal.roof, side: THREE.DoubleSide });
  const underRoof = new THREE.MeshLambertMaterial({ color: pal.roof.clone().lerp(pal.standLight, 0.35), side: THREE.DoubleSide });
  const meshes = [];
  tiers.forEach(([start, z0, depth, rise], index) => {
    const rows = depth / 0.86;
    const deck = band(info, segments, [start, z0], [start + depth, z0 + rise], { uUnit: 0.56, vSpan: rows, open });
    const deckMesh = new THREE.Mesh(deck, crowd);
    meshes.push(deckMesh);
    group.add(deckMesh);
    // The wall in front, with a rail of colour along its top.
    group.add(new THREE.Mesh(band(info, segments, [start - 0.2, Math.max(0, z0 - 2.2)], [start, z0]), dark));
    const rail = new THREE.Mesh(band(info, segments, [start - 0.22, z0 - 0.5], [start - 0.22, z0 + 0.12]),
      new THREE.MeshBasicMaterial({ color: color(info.boardColor).multiplyScalar(pal.night ? 1.25 : 0.8), side: THREE.DoubleSide }));
    group.add(rail);
    // The back wall, and a roof over the top tier.
    group.add(new THREE.Mesh(band(info, segments, [start + depth, z0 + rise], [start + depth + 0.5, z0 + rise + 4]), wall));
    if (index === tiers.length - 1) {
      const lip = [start + depth * 0.3, z0 + rise + 7.2], back = [start + depth + 0.5, z0 + rise + 5.5];
      group.add(new THREE.Mesh(band(info, segments, lip, back), underRoof));
      group.add(new THREE.Mesh(band(info, segments, [lip[0] - 0.2, lip[1] + 0.9], [back[0] + 2.5, back[1] + 1.2]), roof));
      group.add(new THREE.Mesh(band(info, segments, [lip[0] - 0.2, lip[1] - 0.1], [lip[0] - 0.2, lip[1] + 0.9]), roof));
      // The outside of the bowl.
      group.add(new THREE.Mesh(band(info, segments, [back[0] + 2.5, back[1] + 1.2], [back[0] + 6, 0]), wall));
      if (pal.floodlit && info.size >= 3) {
        // A ring of lamps under the roof's lip.
        const lamps = new THREE.Mesh(band(info, segments, [lip[0] + 0.6, lip[1] - 0.15], [lip[0] + 2.4, lip[1] - 0.45], { uUnit: 7, vSpan: 1 }),
          new THREE.MeshBasicMaterial({ map: lampStrip(), side: THREE.DoubleSide, color: new THREE.Color(2.6, 2.7, 2.9), transparent: true }));
        lamps.userData.lamp = true;
        group.add(lamps);
        group.userData.roofLamps = lamps;
      }
    } else {
      // The fascia between the tiers, with a ribbon of light.
      const top = z0 + rise;
      group.add(new THREE.Mesh(band(info, segments, [start + depth, top], [start + depth, top + 3.6]), dark));
      const ribbon = new THREE.Mesh(band(info, segments, [start + depth - 0.05, top + 1.3], [start + depth - 0.05, top + 2.4], { uUnit: 60, vSpan: 1 }),
        new THREE.MeshBasicMaterial({ map: ribbonTexture(info), side: THREE.DoubleSide, color: new THREE.Color(1, 1, 1).multiplyScalar(pal.night ? 1.5 : 0.9) }));
      const ribbonUv = ribbon.geometry.attributes.uv;
      for (let i = 0; i < ribbonUv.count; i++) ribbonUv.setX(i, -ribbonUv.getX(i));
      group.userData.ribbon = ribbon;
      group.add(ribbon);
    }
  });
  crowd.uniforms.uRows.value = tiers[0][2] / 0.86;
  group.userData.crowd = crowd;
  return group;
}

function lampStrip() {
  return canvasTexture(64, 16, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(8, 3, w - 16, h - 6);
  }, { repeat: true, srgb: true });
}

function ribbonTexture(info) {
  const board = color(info.boardColor);
  return canvasTexture(1024, 32, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, cssOf(board.clone().lerp(color(0xffffff), 0.2)));
    g.addColorStop(0.5, cssOf(board.clone().lerp(color(0xffffff), 0.45)));
    g.addColorStop(1, cssOf(board.clone().lerp(color(0xffffff), 0.2)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = `900 ${h * 0.7}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
    info.boards.forEach((m, i) => ctx.fillText(m, (w * (i + 0.5)) / info.boards.length, h * 0.55, w / info.boards.length - 30));
  }, { repeat: true });
}

// MARK: Floodlights

function glowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.13)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { mips: false });
}

function buildTowers(pal, info) {
  const group = new THREE.Group();
  const height = info.size >= 3 ? 62 : 48;
  const beyond = info.size >= 3 ? 70 : 38;
  const lampMap = canvasTexture(192, 96, (ctx, w, h) => {
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 6; col++) {
        ctx.beginPath();
        ctx.arc((col + 0.5) * (w / 6), (row + 0.5) * (h / 3), h / 3 * 0.34, 0, TAU);
        ctx.fill();
      }
    }
  });
  const glow = glowTexture();
  const mast = new THREE.MeshLambertMaterial({ color: pal.standDark.clone().multiplyScalar(0.9) });
  const towers = [];
  [0.25, 0.75, 1.25, 1.75].forEach((turn, index) => {
    const angle = turn * Math.PI;
    const base = ring(info, angle, beyond, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, height, 8), mast);
    pole.rotation.x = Math.PI / 2;
    pole.position.set(base.x, base.y, height / 2);
    group.add(pole);
    // The bank of lamps, tipped down at the middle.
    const top = new THREE.Vector3(base.x, base.y, height + 3.5);
    const bank = new THREE.Group();
    bank.position.copy(top);
    const toMiddle = new THREE.Vector3(-top.x, -top.y, -top.z * 0.55).normalize();
    const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), toMiddle).normalize();
    const y = new THREE.Vector3().crossVectors(toMiddle, x).normalize();
    bank.matrix.makeBasis(x, y, toMiddle).setPosition(top);
    bank.matrixAutoUpdate = false;
    const back = new THREE.Mesh(new THREE.BoxGeometry(12.6, 7.6, 0.5), mast);
    back.position.z = -0.3;
    const lampMaterial = new THREE.MeshBasicMaterial({ map: lampMap, color: new THREE.Color(1, 1, 1) });
    const lamps = new THREE.Mesh(new THREE.PlaneGeometry(12, 7), lampMaterial);
    bank.add(back, lamps);
    group.add(bank);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, color: pal.lamp || color(0xffffff), fog: false }));
    flare.position.copy(top).addScaledVector(toMiddle, 1.2);
    flare.scale.setScalar(70);
    group.add(flare);
    towers.push({ index, lampMaterial, flare, top, direction: toMiddle.clone() });
  });
  group.userData.towers = towers;
  return group;
}

// MARK: Parks and greens

function buildTrees(pal, info, rng, { beyond, height, gaps = false }) {
  const spots = [];
  let angle = 0;
  while (angle < TAU) {
    const here = angle;
    angle += rng.range(0.035, 0.07);
    if (gaps && (Math.abs(Math.sin(here)) > 0.97 || (here > 2.6 && here < 3.3))) continue;
    const h = height * rng.range(0.75, 1.2), r = rng.range(3, 5);
    const p = ring(info, here, beyond + rng.range(-2, 4), 0);
    spots.push({ p, h, r, shade: rng.range(0.78, 1.18) });
  }
  const canopy = new THREE.IcosahedronGeometry(1, 1);
  const leaves = new THREE.InstancedMesh(canopy, new THREE.MeshLambertMaterial({ flatShading: true }), spots.length * 3);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 1, 6), new THREE.MeshLambertMaterial({ color: color(0x4a3526) }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const up = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  spots.forEach((spot, i) => {
    trunks.setMatrixAt(i, m.compose(t.set(spot.p.x, spot.p.y, spot.h * 0.3), up, s.set(1, spot.h * 0.62, 1)));
    for (let k = 0; k < 3; k++) {
      const rr = spot.r * (k === 0 ? 1 : rng.range(0.55, 0.8));
      const off = k === 0 ? [0, 0, 0] : [rng.range(-1, 1) * spot.r * 0.6, rng.range(-1, 1) * spot.r * 0.6, rng.range(-0.1, 0.35) * spot.h];
      q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      leaves.setMatrixAt(i * 3 + k, m.compose(t.set(spot.p.x + off[0], spot.p.y + off[1], spot.h * 0.66 + off[2]), q, s.set(rr, rr, spot.h * 0.4 * (k === 0 ? 1 : 0.7))));
      leaves.setColorAt(i * 3 + k, pal.trees.clone().multiplyScalar(spot.shade * (k === 0 ? 1 : rng.range(0.85, 1.25))));
    }
  });
  const group = new THREE.Group();
  group.add(leaves, trunks);
  return group;
}

function windowsTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#44566a';
    ctx.fillRect(10, 14, 18, 30);
    ctx.fillRect(38, 14, 18, 30);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, h - 5, w, 5);
  }, { repeat: true });
}

function buildCity(pal, info, rng) {
  const group = new THREE.Group();
  const tints = [0xe8dcc8, 0xd6c3a5, 0xc9d3d8, 0xe3c9c0, 0xbfc7b0];
  const map = windowsTexture();
  let angle = 0;
  while (angle < TAU) {
    const width = rng.range(14, 26), distance = rng.range(40, 70), height = rng.range(14, 38), depth = rng.range(12, 20);
    const c = ring(info, angle, distance + depth / 2, height / 2);
    const tint = color(rng.pick(tints)).lerp(pal.skyHorizon, 0.25);
    const texture = map.clone();
    texture.needsUpdate = true;
    texture.repeat.set(Math.round(width / 6), Math.round(height / 3.2));
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, depth, height), new THREE.MeshLambertMaterial({ color: tint, map: texture }));
    box.position.copy(c);
    box.rotation.z = angle + Math.PI / 2;
    group.add(box);
    // A water tank or a stair head on the roof.
    if (rng.chance(0.6)) {
      const tank = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 2.4), new THREE.MeshLambertMaterial({ color: tint.clone().multiplyScalar(0.8) }));
      tank.position.set(c.x + rng.range(-3, 3), c.y + rng.range(-3, 3), height + 1.2);
      group.add(tank);
    }
    angle += width / (boundary(info, angle) + distance) + rng.range(0.01, 0.06);
  }
  return group;
}

/// People standing or sitting round the rope: a body, legs and a head each.
function buildPeople(pal, info, rng, { seated }) {
  const colors = info.crowd.map(color);
  const skins = [0xf2cdb0, 0xe0ac85, 0xc68a62, 0xa0694a, 0x7d4e35, 0x5c3a28].map(color);
  const spots = [];
  let angle = 0;
  while (angle < TAU) {
    const here = angle;
    angle += seated ? rng.range(0.012, 0.03) : rng.range(0.005, 0.013);
    if (seated && Math.abs(Math.sin(here)) >= 0.95) continue;
    if (!rng.chance(info.attendance + (seated ? 0.2 : 0.35))) continue;
    spots.push({ a: here, p: ring(info, here, seated ? rng.range(4.5, 7) : rng.range(4.6, 9.5), 0), h: rng.range(0.92, 1.08) });
  }
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.36, 3, 8), new THREE.MeshLambertMaterial(), spots.length);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.22, 1), new THREE.MeshLambertMaterial({ color: color(0x2e3440) }), spots.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.115, 10, 8), new THREE.MeshLambertMaterial(), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  spots.forEach((spot, i) => {
    const hip = seated ? 0.5 : 0.86 * spot.h;
    q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, spot.a + Math.PI / 2, 'ZXY'));
    bodies.setMatrixAt(i, m.compose(t.set(spot.p.x, spot.p.y, hip + 0.3), q, s.set(1, spot.h, 1)));
    bodies.setColorAt(i, rng.pick(colors).clone().multiplyScalar(rng.range(0.8, 1.05)));
    q.setFromEuler(new THREE.Euler(0, 0, spot.a + Math.PI / 2));
    legs.setMatrixAt(i, m.compose(t.set(spot.p.x, spot.p.y, hip / 2), q, s.set(1, 1, hip)));
    heads.setMatrixAt(i, m.compose(t.set(spot.p.x, spot.p.y, hip + 0.72 * spot.h), q, s.set(1, 1, 1)));
    heads.setColorAt(i, rng.pick(skins));
  });
  const group = new THREE.Group();
  group.add(bodies, legs, heads);
  if (seated) {
    // The benches they sit on, and a white picket fence.
    group.add(new THREE.Mesh(band(info, 120, [4.3, 0.42], [7.2, 0.42]), new THREE.MeshLambertMaterial({ color: color(0x6b4a2e), side: THREE.DoubleSide, transparent: true, opacity: 0 })));
  }
  return group;
}

function buildFence(info) {
  const texture = canvasTexture(64, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f7f5ee';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 16 + 2, h);
      ctx.lineTo(i * 16 + 2, 12);
      ctx.lineTo(i * 16 + 8, 2);
      ctx.lineTo(i * 16 + 14, 12);
      ctx.lineTo(i * 16 + 14, h);
      ctx.fill();
    }
    ctx.fillRect(0, 22, w, 6);
    ctx.fillRect(0, 46, w, 6);
  }, { repeat: true });
  const g = band(info, 160, [3.3, 0], [3.3, 0.95], { uUnit: 1.1, vSpan: 1, uBeyond: 3.3 });
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide }));
}

function buildPavilion(pal, info) {
  const angle = 0.62 * Math.PI;
  const group = new THREE.Group();
  group.position.copy(ring(info, angle, 14, 0));
  group.rotation.z = angle - Math.PI / 2;
  const white = new THREE.MeshLambertMaterial({ color: color(0xf3efe4) });
  const green = new THREE.MeshLambertMaterial({ color: color(0x2e4a2e) });
  const glass = new THREE.MeshLambertMaterial({ color: color(0x33404d) });
  const tile = new THREE.MeshLambertMaterial({ color: color(0x8a3b2e), side: THREE.DoubleSide });
  const w = 22, h = 7, d = 8;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), white);
  body.position.set(0, d / 2, h / 2);
  group.add(body);
  // A pitched roof.
  const shape = new THREE.Shape([new THREE.Vector2(-d / 2 - 1, 0), new THREE.Vector2(d / 2 + 1, 0), new THREE.Vector2(0, 4.6)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: w + 2, bevelEnabled: false }), tile);
  roof.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  roof.position.set(-w / 2 - 1, d / 2, h);
  group.add(roof);
  const balcony = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, 0.25), green);
  balcony.position.set(0, -0.8, 3.4);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.9), white);
  rail.position.set(0, -1.55, 3.95);
  group.add(balcony, rail);
  for (let k = 0; k < 6; k++) {
    const x = -w / 2 + ((k + 0.5) * w) / 6;
    for (const z of [1.6, 5.25]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.9), glass);
      win.position.set(x, -0.02, z);
      group.add(win);
    }
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 3.4), white);
    post.position.set(x - w / 12, -1.5, 1.7);
    group.add(post);
  }
  // The clock.
  const face = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.2, 24), new THREE.MeshLambertMaterial({ map: canvasTexture(128, 128, (ctx, cw, ch) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cw / 2, ch / 2, cw / 2 - 6, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cw / 2, ch / 2);
    ctx.lineTo(cw / 2, 26);
    ctx.moveTo(cw / 2, ch / 2);
    ctx.lineTo(cw / 2 + 30, ch / 2);
    ctx.stroke();
  }) }));
  face.position.set(0, -0.1, h + 2.1);
  group.add(face);
  return group;
}

function buildChurch(pal, info) {
  const angle = 0.35 * Math.PI;
  const group = new THREE.Group();
  group.position.copy(ring(info, angle, 60, 0));
  group.rotation.z = angle - Math.PI / 2;
  const stone = new THREE.MeshLambertMaterial({ color: color(0xb9b1a0).lerp(pal.skyHorizon, 0.2) });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 16), stone);
  tower.position.z = 8;
  const spire = new THREE.Mesh(new THREE.ConeGeometry(4.3, 14, 4), new THREE.MeshLambertMaterial({ color: color(0x8f8878) }));
  spire.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  spire.position.z = 23;
  const nave = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 8), stone);
  nave.position.set(12, 0, 4);
  group.add(tower, spire, nave);
  return group;
}

// MARK: The venue

/// Everything that doesn't move. `update` keeps it alive: floodlights warming up, the crowd, the boards.
export function buildVenue(info, index) {
  const pal = paletteFor(info);
  const rng = mulberry(0x5EED + index * 977);
  const group = new THREE.Group();
  const sky = buildSky(pal, info);
  const ground = buildGround(pal, info);
  group.add(sky, ground, buildPitch(pal, info, rng), buildLines(pal, info), buildRope(pal, info));
  const boards = buildBoards(pal, info);
  group.add(boards, buildSightscreens(pal, info));
  let stands = null, towers = null;
  if (info.size === 0) {
    group.add(buildCity(pal, info, rng), buildTrees(pal, info, rng, { beyond: 16, height: 11 }), buildPeople(pal, info, rng, { seated: false }));
  } else if (info.size === 1) {
    group.add(buildTrees(pal, info, rng, { beyond: 30, height: 15 }), buildChurch(pal, info), buildTrees(pal, info, rng, { beyond: 13, height: 10, gaps: true }),
      buildPavilion(pal, info), buildPeople(pal, info, rng, { seated: true }), buildFence(info));
  } else {
    stands = buildStands(pal, info);
    towers = buildTowers(pal, info);
    group.add(stands, towers);
  }

  // Light. The sun (or what's left of it), the sky, and at night four banks of floodlights.
  const lights = new THREE.Group();
  const hemisphere = new THREE.HemisphereLight(pal.skyLight, pal.groundLight, pal.ambient);
  hemisphere.position.set(0, 0, 1);
  lights.add(hemisphere);
  const sun = new THREE.DirectionalLight(pal.sunColor, pal.sunPower);
  sun.position.copy(pal.sun).multiplyScalar(100);
  lights.add(sun);
  const lamps = [];
  const shadows = [];
  if (pal.floodlit && towers) {
    for (const tower of towers.userData.towers) {
      const lamp = new THREE.DirectionalLight(pal.lamp, pal.lampPower);
      lamp.position.copy(tower.top);
      lights.add(lamp);
      lamps.push(lamp);
      // Shadows fall away from each bank (a little steeper than the truth, so they stay near the feet).
      const d = tower.top.clone().negate();
      d.z *= 1.9;
      shadows.push({ direction: d.normalize(), opacity: pal.shadow, tower: tower.index });
    }
  } else {
    shadows.push({ direction: pal.sun.clone().negate(), opacity: pal.shadow, tower: -1 });
    // A soft fill from the other side so nothing goes black.
    const fill = new THREE.DirectionalLight(pal.skyLight, pal.sunPower * 0.22);
    fill.position.set(-pal.sun.x * 100, -pal.sun.y * 100, 40);
    lights.add(fill);
  }
  group.add(lights);

  const fog = new THREE.Fog(pal.haze.clone().lerp(pal.skyHorizon, 0.5), pal.fog[0], pal.fog[1]);
  const towerBrightness = (tower, level) => {
    if (level >= 0.999) return 1;
    return Math.min(1, Math.max(0, (level - [0.16, 0.36, 0.56, 0.76][tower]) / 0.05));
  };

  return {
    group, palette: pal, fog, shadows, info,
    /// `level`: floodlight power 0...1; `excitement`: the crowd, 0...1.
    update(time, level, excitement, dt) {
      sky.material.uniforms.uTime.value = time;
      const lit = pal.floodlit ? level : 1;
      sky.material.uniforms.uLights.value = lit;
      ground.material.uniforms.uLights.value = lit;
      if (stands) {
        const u = stands.userData.crowd.uniforms;
        u.uTime.value = time;
        u.uExcite.value += (excitement - u.uExcite.value) * Math.min(1, dt * 4);
        u.uLights.value = lit;
        u.uWave.value = info.size >= 3 && excitement < 0.3 ? 0.55 : 0;
        if (stands.userData.roofLamps) stands.userData.roofLamps.material.color.setRGB(2.6 * lit, 2.7 * lit, 2.9 * lit);
      }
      if (boards.userData.scrolls) boards.userData.texture.offset.x = (time * 0.012) % 1;
      if (towers) {
        towers.userData.towers.forEach((tower, i) => {
          const on = pal.floodlit ? towerBrightness(tower.index, level) : 0;
          const power = pal.floodlit ? 0.04 + on * 4 : 0.5;
          tower.lampMaterial.color.setRGB(power, power * 1.02, power * 1.08);
          tower.flare.material.opacity = pal.floodlit ? on * (pal.night ? 0.5 : 0.3) : 0;
          tower.flare.visible = on > 0.01;
          if (lamps[i]) lamps[i].intensity = pal.lampPower * on;
        });
        if (pal.floodlit) {
          // Until the lights come up there's only the sky.
          hemisphere.intensity = pal.ambient * (0.35 + 0.65 * level);
          for (const shadow of shadows) shadow.level = towerBrightness(shadow.tower, level);
        }
      }
    },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const material of materials) {
          for (const key of ['map', 'alphaMap']) if (material[key]) material[key].dispose();
          material.dispose();
        }
      });
    },
  };
}
