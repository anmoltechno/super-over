// The players, the stumps and the bat, built every frame from the joints the engine sends: limbs
// are tapered cylinders, joints and heads are spheres, torsos and pads are rounded boxes. Every
// part of every player is one instance in a handful of instanced meshes, and each light casts
// their shadows flat onto the grass.
import * as THREE from './vendor/three.js';

const FIGURE = 100;       // floats per figure in the scene stream (Scene3DCodec.figureSize)
const JOINTS = 13;        // where a figure's joints start
const V = () => new THREE.Vector3();

// Scratch vectors: nothing here allocates while the game runs.
const pelvis = V(), chest = V(), neck = V(), head = V(), face = V(), shoulderL = V(), shoulderR = V(), elbowL = V(), elbowR = V(),
  handL = V(), handR = V(), hipL = V(), hipR = V(), kneeL = V(), kneeR = V(), ankleL = V(), ankleR = V(), toeL = V(), toeR = V(),
  chestForward = V(), shoulderAxis = V(), hipAxis = V();
const jointList = [pelvis, chest, neck, head, face, shoulderL, shoulderR, elbowL, elbowR, handL, handR, hipL, hipR, kneeL, kneeR,
  ankleL, ankleR, toeL, toeR, chestForward, shoulderAxis, hipAxis];
const batTop = V(), batGrip = V(), batShoulder = V(), batToe = V(), batFace = V(), batAcross = V();
const t0 = V(), t1 = V(), t2 = V(), t3 = V(), t4 = V(), t5 = V(), ax = V(), ay = V(), az = V();
const UP = new THREE.Vector3(0, 0, 1), ACROSS = new THREE.Vector3(1, 0, 0), boneDir = V(), boneMid = V();
const tint = new THREE.Color();

const SHADOW_VERTEX = /* glsl */`
  uniform vec3 uLight;
  varying float vHeight;
  #ifdef TAPER
  attribute float aTaper;
  #endif
  void main() {
    vec3 p = position;
    #ifdef TAPER
    p.xz *= mix(1.0, aTaper, position.y + 0.5);
    #endif
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    float h = max(wp.z, 0.0);
    // Slide every point down the light's ray onto the grass.
    wp.xy -= uLight.xy * (h / uLight.z);
    wp.z = 0.014;
    vHeight = h;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const SHADOW_FRAGMENT = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vHeight;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * (1.0 - 0.45 * smoothstep(0.3, 3.0, vHeight)));
  }`;

/// One kind of part, drawn many times.
class Parts {
  constructor(scene, geometry, material, capacity, { taper = false, shadows = true } = {}) {
    this.capacity = capacity;
    this.count = 0;
    this.taper = taper;
    this.geometry = geometry;
    if (taper) {
      this.tapers = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      this.tapers.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aTaper', this.tapers);
    }
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.matrices = this.mesh.instanceMatrix.array;
    this.colors = this.mesh.instanceColor.array;
    this.castsShadows = shadows;
    this.shadowMeshes = [];
    scene.add(this.mesh);
  }

  /// A basis (three axes, already scaled) and a centre.
  put(x, y, z, c, color, taper = 1) {
    const i = this.count;
    if (i >= this.capacity) return;
    const m = this.matrices, o = i * 16;
    m[o] = x.x; m[o + 1] = x.y; m[o + 2] = x.z; m[o + 3] = 0;
    m[o + 4] = y.x; m[o + 5] = y.y; m[o + 6] = y.z; m[o + 7] = 0;
    m[o + 8] = z.x; m[o + 9] = z.y; m[o + 10] = z.z; m[o + 11] = 0;
    m[o + 12] = c.x; m[o + 13] = c.y; m[o + 14] = c.z; m[o + 15] = 1;
    const k = i * 3;
    this.colors[k] = color.r; this.colors[k + 1] = color.g; this.colors[k + 2] = color.b;
    if (this.taper) this.tapers.array[i] = taper;
    this.count = i + 1;
  }

  finish() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    if (this.taper) this.tapers.needsUpdate = true;
    for (const shadow of this.shadowMeshes) shadow.count = this.count;
  }
}

export class Figures {
  constructor(scene) {
    this.scene = scene;
    const skin = (material) => {
      // A soft rim of light round every body, so players stand out from the grass and the crowd.
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uRim = this.rim;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
          .replace('#include <opaque_fragment>', `
            float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
            outgoingLight += uRim * rim * (0.35 + 0.65 * diffuseColor.rgb);
            #include <opaque_fragment>`);
      };
      return material;
    };
    this.rim = { value: new THREE.Color(0.25, 0.25, 0.25) };
    const tapered = skin(new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 }));
    const base = tapered.onBeforeCompile;
    tapered.onBeforeCompile = (shader) => {
      base(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aTaper;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz *= mix(1.0, aTaper, position.y + 0.5);');
    };
    const plain = () => skin(new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 }));

    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    const sphere = new THREE.SphereGeometry(1, 18, 12);
    const box = new THREE.BoxGeometry(2, 2, 2);
    this.bones = new Parts(scene, cylinder, tapered, 640, { taper: true });
    this.balls = new Parts(scene, sphere, plain(), 900);
    this.softs = new Parts(scene, softBox(), plain(), 220);
    this.boxes = new Parts(scene, box, plain(), 120);
    this.kinds = [this.bones, this.balls, this.softs, this.boxes];

    // Shirt numbers: one quad each, cut from a sheet of 0...99.
    this.numberCells = new THREE.InstancedBufferAttribute(new Float32Array(32 * 2), 2);
    this.numberCells.setUsage(THREE.DynamicDrawUsage);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.setAttribute('aCell', this.numberCells);
    const numberMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uMap: { value: numberSheet() } },
      vertexShader: /* glsl */`
        attribute vec2 aCell;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = (aCell + uv) / 10.0;
          vColor = instanceColor;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, vUv).a;
          if (a < 0.05) discard;
          gl_FragColor = vec4(vColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.numbers = new Parts(scene, plane, numberMaterial, 32, { shadows: false });
    this.numbers.mesh.renderOrder = 5;

    // Stumps that light up.
    this.glow = new Parts(scene, cylinder.clone(), new THREE.MeshBasicMaterial({ toneMapped: false }), 16, { taper: true, shadows: false });
    this.shadowLights = [];
    this.wood = new THREE.Color();
  }

  /// One flat shadow per light. `lights`: [{ direction, opacity }].
  setShadows(lights) {
    for (const kind of this.kinds) {
      for (const mesh of kind.shadowMeshes) {
        this.scene.remove(mesh);
        mesh.material.dispose();
      }
      kind.shadowMeshes = [];
    }
    this.shadowLights = lights;
    lights.forEach((light, index) => {
      for (const kind of this.kinds) {
        const material = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, vertexShader: SHADOW_VERTEX, fragmentShader: SHADOW_FRAGMENT,
          defines: kind.taper ? { TAPER: 1 } : {},
          uniforms: { uLight: { value: light.direction }, uColor: { value: new THREE.Color(0x030a05) }, uOpacity: { value: light.opacity } },
          // Each light darkens a blade of grass once, however many limbs lie over it.
          stencilWrite: true, stencilRef: index + 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        });
        const mesh = new THREE.InstancedMesh(kind.geometry, material, kind.capacity);
        mesh.instanceMatrix = kind.mesh.instanceMatrix;
        mesh.frustumCulled = false;
        mesh.renderOrder = -20 + index;
        mesh.userData.light = light;
        kind.shadowMeshes.push(mesh);
        this.scene.add(mesh);
      }
    });
  }

  begin() {
    for (const kind of this.kinds) kind.count = 0;
    this.numbers.count = 0;
    this.glow.count = 0;
  }

  end() {
    for (const kind of this.kinds) {
      kind.finish();
      for (const mesh of kind.shadowMeshes) {
        const light = mesh.userData.light;
        mesh.material.uniforms.uOpacity.value = light.opacity * (light.level ?? 1);
        mesh.visible = (light.level ?? 1) > 0.02;
      }
    }
    this.numbers.finish();
    this.numbers.mesh.geometry.attributes.aCell.needsUpdate = true;
    this.glow.finish();
  }

  // MARK: Parts

  /// A limb from `a` to `b`, `ra` thick at one end and `rb` at the other.
  bone(a, b, ra, rb, color, parts = this.bones) {
    ay.subVectors(b, a);
    const length = ay.length();
    if (length < 1e-5) return;
    boneDir.copy(ay).multiplyScalar(1 / length);
    ax.crossVectors(Math.abs(boneDir.z) < 0.95 ? UP : ACROSS, boneDir).normalize();
    az.crossVectors(ax, boneDir);
    boneMid.addVectors(a, b).multiplyScalar(0.5);
    ax.multiplyScalar(ra);
    az.multiplyScalar(ra);
    parts.put(ax, ay, az, boneMid, color, rb / ra);
  }

  ball(c, r, color) {
    ax.set(r, 0, 0);
    ay.set(0, r, 0);
    az.set(0, 0, r);
    this.balls.put(ax, ay, az, c, color);
  }

  /// An ellipsoid (or a rounded box, or a box) with its own axes: half-sizes `sx`, `sy`, `sz` along `x`, `y`, `z`.
  solid(parts, c, x, sx, y, sy, z, sz, color) {
    ax.copy(x).multiplyScalar(sx);
    ay.copy(y).multiplyScalar(sy);
    az.copy(z).multiplyScalar(sz);
    parts.put(ax, ay, az, c, color);
  }

  // MARK: Stumps

  stumps(f, o, led) {
    const broken = f[o + 30] > 0.5, since = f[o + 31];
    const flash = led && broken ? (Math.sin(since * 22) > 0 ? 1 : 0.35) : 0;
    const woodColor = this.wood.setHex(led ? 0x23262e : 0xf1e7cf);
    for (let i = 0; i < 3; i++) {
      t2.set(f[o + i * 6], f[o + i * 6 + 1], f[o + i * 6 + 2]);
      t3.set(f[o + i * 6 + 3], f[o + i * 6 + 4], f[o + i * 6 + 5]);
      this.bone(t2, t3, 0.0175, 0.0175, woodColor);
      t4.copy(t3);
      this.ball(t4, 0.0175, woodColor);
      if (led) {
        // A strip of light down each stump.
        const power = flash > 0 ? 9 * flash : 0.5;
        tint.setRGB(power, power * 0.12, power * 0.1);
        t4.lerpVectors(t2, t3, 0.14);
        t5.lerpVectors(t2, t3, 0.93);
        this.bone(t4, t5, 0.02, 0.02, tint, this.glow);
      } else {
        // The sponsor's band.
        tint.setHex(0x1d4e89);
        t4.lerpVectors(t2, t3, 0.62);
        t5.lerpVectors(t2, t3, 0.8);
        this.bone(t4, t5, 0.0182, 0.0182, tint);
      }
    }
    for (let i = 0; i < 2; i++) {
      const b = o + 18 + i * 6;
      t2.set(f[b] - f[b + 3], f[b + 1] - f[b + 4], f[b + 2] - f[b + 5]);
      t3.set(f[b] + f[b + 3], f[b + 1] + f[b + 4], f[b + 2] + f[b + 5]);
      if (led) {
        const power = flash > 0 ? 10 * flash : 0.6;
        tint.setRGB(power, power * 0.12, power * 0.1);
        this.bone(t2, t3, 0.0095, 0.0095, tint, this.glow);
      } else {
        this.bone(t2, t3, 0.009, 0.009, woodColor);
      }
    }
  }

  // MARK: A player

  figure(f, o, ballColor) {
    const flags = f[o + 1] | 0, headwear = f[o + 2] | 0, gloves = f[o + 3] | 0, number = f[o + 4] | 0;
    const pads = (flags & 4) !== 0, longSleeves = (flags & 8) !== 0, beard = (flags & 16) !== 0;
    const scale = f[o + 11], headRadius = f[o + 12];
    for (let i = 0; i < jointList.length; i++) jointList[i].set(f[o + JOINTS + i * 3], f[o + JOINTS + i * 3 + 1], f[o + JOINTS + i * 3 + 2]);
    const shirt = this.palette.shirt.setHex(f[o + 5]), trim = this.palette.trim.setHex(f[o + 6]), trousers = this.palette.trousers.setHex(f[o + 7]),
      cap = this.palette.cap.setHex(f[o + 8]), skin = this.palette.skin.setHex(f[o + 9]), hair = this.palette.hair.setHex(f[o + 10]);
    const white = this.palette.white, shoe = this.palette.shoe;
    const k = scale;

    // Legs.
    this.leg(hipL, kneeL, ankleL, toeL, trousers, pads, white, shoe, k);
    this.leg(hipR, kneeR, ankleR, toeR, trousers, pads, white, shoe, k);

    // Hips and chest: two rounded boxes that turn against each other when the shoulders do.
    const spine = t2.subVectors(chest, pelvis);
    const torso = spine.length();
    spine.multiplyScalar(1 / Math.max(torso, 1e-5));
    const hipForward = t3.crossVectors(UP, hipAxis).normalize();
    const hipUp = t4.crossVectors(hipAxis, hipForward).normalize();
    t5.copy(pelvis).addScaledVector(spine, 0.03 * k);
    this.solid(this.softs, t5, hipAxis, 0.172 * k, hipForward, 0.118 * k, hipUp, 0.15 * k, trousers);
    // The chest's forward, square to its own axes.
    const chestFwd = t3.crossVectors(spine, shoulderAxis).normalize();
    t5.copy(pelvis).addScaledVector(spine, torso * 0.6);
    this.solid(this.softs, t5, shoulderAxis, 0.212 * k, chestFwd, 0.128 * k, spine, torso * 0.46 + 0.03 * k, shirt);
    // The collar.
    t5.copy(neck).addScaledVector(spine, -0.012 * k);
    this.solid(this.balls, t5, shoulderAxis, 0.075 * k, chestFwd, 0.07 * k, spine, 0.035 * k, trim);
    if (number >= 0 && number < 100) {
      // The number on their back.
      const i = this.numbers.count;
      this.numberCells.array[i * 2] = number % 10;
      this.numberCells.array[i * 2 + 1] = 9 - Math.floor(number / 10);
      t5.copy(pelvis).addScaledVector(spine, torso * 0.64).addScaledVector(chestFwd, -0.131 * k);
      // Facing backwards, the digits reading left to right from behind.
      ax.copy(shoulderAxis).multiplyScalar(0.26 * k);
      ay.copy(spine).multiplyScalar(0.26 * k);
      az.copy(chestFwd).negate();
      this.numbers.put(ax, ay, az, t5, trim);
    }

    // Neck and head.
    this.bone(neck, head, 0.05 * k, 0.05 * k, this.palette.shade.copy(skin).multiplyScalar(0.9));
    this.ball(head, headRadius, skin);
    const r = headRadius;
    const side = t3.crossVectors(face, UP).normalize();
    const up = t4.crossVectors(side, face).normalize();
    switch (headwear) {
      case 0: {
        // Helmet: shell, peak and grille.
        t5.copy(head).addScaledVector(up, r * 0.1).addScaledVector(face, -r * 0.1);
        this.solid(this.balls, t5, side, r * 1.2, face, r * 1.26, up, r * 1.14, cap);
        t5.copy(head).addScaledVector(face, r * 1.1).addScaledVector(up, r * 0.42);
        this.solid(this.balls, t5, side, r * 0.86, face, r * 0.55, up, r * 0.1, this.palette.shade.copy(cap).multiplyScalar(0.75));
        for (const level of [-0.52, -0.2, 0.12]) {
          t0.copy(head).addScaledVector(face, r * 1.02).addScaledVector(up, r * level).addScaledVector(side, r * 0.72);
          t1.copy(head).addScaledVector(face, r * 1.02).addScaledVector(up, r * level).addScaledVector(side, -r * 0.72);
          this.bone(t0, t1, r * 0.045, r * 0.045, this.palette.steel);
        }
        // Earpieces holding the grille.
        for (const s of [-1, 1]) {
          t0.copy(head).addScaledVector(side, s * r * 1.05).addScaledVector(up, -r * 0.35).addScaledVector(face, r * 0.2);
          this.solid(this.balls, t0, side, r * 0.2, face, r * 0.5, up, r * 0.5, cap);
        }
        break;
      }
      case 1: {
        // Cap, with hair below it at the back.
        t5.copy(head).addScaledVector(face, -r * 0.12).addScaledVector(up, -r * 0.05);
        this.solid(this.balls, t5, side, r * 1.01, face, r * 1.0, up, r * 0.96, hair);
        t5.copy(head).addScaledVector(up, r * 0.3);
        this.solid(this.balls, t5, side, r * 1.06, face, r * 1.08, up, r * 0.82, cap);
        t5.copy(head).addScaledVector(face, r * 1.05).addScaledVector(up, r * 0.42);
        this.solid(this.balls, t5, side, r * 0.8, face, r * 0.62, up, r * 0.08, this.palette.shade.copy(cap).multiplyScalar(0.8));
        break;
      }
      case 2: {
        // The umpire's wide-brimmed hat.
        t5.copy(head).addScaledVector(up, r * 0.5);
        this.solid(this.balls, t5, side, r * 1.75, face, r * 1.75, up, r * 0.1, cap);
        t5.copy(head).addScaledVector(up, r * 0.72);
        this.solid(this.balls, t5, side, r * 0.98, face, r * 0.98, up, r * 0.52, cap);
        t5.copy(head).addScaledVector(up, r * 0.6);
        this.solid(this.balls, t5, side, r * 1.0, face, r * 1.0, up, r * 0.12, this.palette.dark);
        break;
      }
      default: {
        t5.copy(head).addScaledVector(face, -r * 0.14).addScaledVector(up, r * 0.16);
        this.solid(this.balls, t5, side, r * 1.03, face, r * 1.02, up, r * 0.98, hair);
        if (beard) {
          t5.copy(head).addScaledVector(face, r * 0.36).addScaledVector(up, -r * 0.42);
          this.solid(this.balls, t5, side, r * 0.72, face, r * 0.66, up, r * 0.62, hair);
        }
      }
    }
    if (headwear !== 0) {
      for (const s of [-1, 1]) {
        t5.copy(head).addScaledVector(face, r * 0.93).addScaledVector(side, s * r * 0.34).addScaledVector(up, r * 0.06);
        this.ball(t5, r * 0.1, this.palette.dark);
      }
      // A nose, so the face has a front.
      t5.copy(head).addScaledVector(face, r * 1.0).addScaledVector(up, -r * 0.12);
      this.ball(t5, r * 0.13, this.palette.shade.copy(skin).multiplyScalar(0.93));
    }

    // Arms.
    const glove = gloves === 2 ? this.palette.glove.copy(cap).lerp(white, 0.25) : (gloves === 1 ? white : skin);
    const handSize = (gloves === 2 ? 0.095 : (gloves === 1 ? 0.062 : 0.046)) * k;
    this.arm(shoulderL, elbowL, handL, shirt, longSleeves ? shirt : skin, glove, handSize, k);
    this.arm(shoulderR, elbowR, handR, shirt, longSleeves ? shirt : skin, glove, handSize, k);
    if (flags & 2) {
      t5.copy(handR).addScaledVector(UP, 0.035);
      this.ball(t5, 0.037, ballColor);
    }

    // The bat.
    if (f[o + 79] > 0.5) {
      const b = o + 80;
      batTop.set(f[b], f[b + 1], f[b + 2]);
      batGrip.set(f[b + 3], f[b + 4], f[b + 5]);
      batShoulder.set(f[b + 6], f[b + 7], f[b + 8]);
      batToe.set(f[b + 9], f[b + 10], f[b + 11]);
      batFace.set(f[b + 12], f[b + 13], f[b + 14]);
      batAcross.set(f[b + 15], f[b + 16], f[b + 17]);
      const along = t2.subVectors(batToe, batShoulder);
      const length = along.length();
      along.multiplyScalar(1 / Math.max(length, 1e-5));
      // The blade: flat face forward, a spine down the back.
      t5.lerpVectors(batShoulder, batToe, 0.5).addScaledVector(batFace, -0.012);
      this.solid(this.boxes, t5, batAcross, 0.054, along, length / 2, batFace, 0.012, this.palette.willow);
      t5.lerpVectors(batShoulder, batToe, 0.56).addScaledVector(batFace, -0.034);
      this.solid(this.softs, t5, batAcross, 0.036, along, length * 0.42, batFace, 0.02, this.palette.willowDark);
      // The maker's sticker.
      t5.lerpVectors(batShoulder, batToe, 0.2).addScaledVector(batFace, 0.0015);
      this.solid(this.boxes, t5, batAcross, 0.045, along, length * 0.13, batFace, 0.0125, trim);
      this.bone(batTop, batShoulder, 0.018, 0.018, this.palette.dark);
      t0.lerpVectors(batTop, batShoulder, 0.1);
      t1.lerpVectors(batTop, batShoulder, 0.86);
      this.bone(t0, t1, 0.021, 0.021, this.palette.shade.copy(trim).multiplyScalar(0.9));
    }
  }

  leg(hip, knee, ankle, toe, trousers, pads, white, shoe, k) {
    this.ball(hip, 0.09 * k, trousers);
    this.bone(hip, knee, 0.088 * k, 0.07 * k, trousers);
    this.ball(knee, 0.07 * k, trousers);
    if (pads) {
      // The pad: from above the knee to the ankle, flat at the front.
      const shin = t2.subVectors(ankle, knee).normalize();
      const front = t3.subVectors(toe, ankle);
      front.addScaledVector(shin, -front.dot(shin)).normalize();
      const across = t4.crossVectors(shin, front).normalize();
      t0.copy(knee).addScaledVector(shin, -0.13 * k);
      const length = t0.distanceTo(ankle);
      t5.lerpVectors(t0, ankle, 0.5).addScaledVector(front, 0.035 * k);
      this.solid(this.softs, t5, across, 0.082 * k, shin, length / 2, front, 0.07 * k, white);
      t5.copy(knee).addScaledVector(front, 0.05 * k);
      this.solid(this.softs, t5, across, 0.09 * k, shin, 0.075 * k, front, 0.07 * k, white);
      this.bone(knee, ankle, 0.062 * k, 0.05 * k, trousers);
    } else {
      this.bone(knee, ankle, 0.066 * k, 0.05 * k, trousers);
    }
    // The boot.
    const along = t2.subVectors(toe, ankle);
    const length = Math.max(along.length(), 1e-5);
    along.multiplyScalar(1 / length);
    const across = t3.crossVectors(UP, along).normalize();
    const upward = t4.crossVectors(across, along).normalize();
    t5.lerpVectors(ankle, toe, 0.42).addScaledVector(upward, -0.012 * k);
    this.solid(this.softs, t5, across, 0.052 * k, along, 0.135 * k, upward, 0.05 * k, shoe);
  }

  arm(shoulder, elbow, hand, sleeve, lower, glove, handSize, k) {
    this.ball(shoulder, 0.072 * k, sleeve);
    this.bone(shoulder, elbow, 0.066 * k, 0.055 * k, sleeve);
    this.ball(elbow, 0.055 * k, lower);
    this.bone(elbow, hand, 0.053 * k, 0.042 * k, lower);
    this.ball(hand, handSize, glove);
  }

  /// Draws every figure in the stream. Returns where the stream goes on after them.
  read(f, start, ballColor, light) {
    if (!this.palette) {
      this.palette = {
        shirt: new THREE.Color(), trim: new THREE.Color(), trousers: new THREE.Color(), cap: new THREE.Color(), skin: new THREE.Color(),
        hair: new THREE.Color(), shade: new THREE.Color(), glove: new THREE.Color(), white: new THREE.Color(0xf4f4f1),
        shoe: new THREE.Color(0xeeeeec), steel: new THREE.Color(0xc9ccd2), dark: new THREE.Color(0x17171b),
        willow: new THREE.Color(0xe9cf97), willowDark: new THREE.Color(0xc9a867),
      };
    }
    void light;
    const count = f[start] | 0;
    let o = start + 1;
    for (let i = 0; i < count; i++) {
      this.figure(f, o, ballColor);
      o += FIGURE;
    }
    return o;
  }
}

/// A box with its corners and edges rounded right off: torsos, pads and boots.
function softBox() {
  const g = new THREE.BoxGeometry(2, 2, 2, 6, 6, 6);
  const p = g.attributes.position;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Squash toward a superellipsoid: |x|^p + |y|^p + |z|^p = 1 with p = 3.2.
    const e = 3.2;
    const d = Math.pow(Math.pow(Math.abs(v.x), e) + Math.pow(Math.abs(v.y), e) + Math.pow(Math.abs(v.z), e), 1 / e);
    v.multiplyScalar(1 / d);
    p.setXYZ(i, v.x, v.y, v.z);
    // Its normal is the gradient of that.
    n.set(Math.sign(v.x) * Math.pow(Math.abs(v.x), e - 1), Math.sign(v.y) * Math.pow(Math.abs(v.y), e - 1), Math.sign(v.z) * Math.pow(Math.abs(v.z), e - 1)).normalize();
    g.attributes.normal.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

/// 0...99 in a 10 × 10 sheet (row 0 at the top holds 0...9), white on clear.
function numberSheet() {
  const size = 1280, cell = size / 10;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${cell * 0.74}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  for (let n = 0; n < 100; n++) {
    ctx.fillText(String(n), (n % 10 + 0.5) * cell, (Math.floor(n / 10) + 0.54) * cell, cell * 0.92);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
