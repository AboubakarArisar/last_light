import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { random, venues, type Level } from "./levels";
import type { Save } from "./save";
import type { Player, Ball, Frame } from "./simulation";
type Rig = {
  root: T.Group;
  body: T.Group;
  arms: T.Group[];
  legs: T.Group[];
  shins: T.Group[];
  head: T.Group;
  shirt: T.MeshStandardMaterial;
  boots: T.MeshStandardMaterial;
  skin: T.MeshStandardMaterial;
  hair: T.Mesh;
  number: T.Mesh;
  numberValue: number;
  parts: T.Mesh[];
};
const vec = new T.Vector3();
export class Stadium {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(44, 1, 0.1, 260);
  renderer: T.WebGLRenderer;
  world = new T.Group();
  rigs = new Map<number, Rig>();
  playerBatches = new Map<T.BufferGeometry, T.InstancedMesh>();
  ball: T.Group;
  ring: T.Mesh;
  sun: T.DirectionalLight;
  hemi: T.HemisphereLight;
  net: T.LineSegments;
  netBase: Float32Array;
  netImpact = new T.Vector3();
  target = new T.Vector3();
  ray = new T.Raycaster();
  width = 1;
  height = 1;
  mode = "menu";
  cameraFrozen = false;
  level: Level;
  settings: Save;
  elapsed = 0;
  frameCount = 0;
  fps = 60;
  fpsTime = performance.now();
  firstRenderMs = 0;
  position = new T.Vector3();
  look = new T.Vector3();
  night = false;
  crowd: T.InstancedMesh;
  bannerTextures: T.CanvasTexture[] = [];
  lastCarrier = -1;
  crowdTime = { value: 0 };
  crowdEnergy = { value: 0.03 };
  trail: T.Line;
  trailPoints: T.Vector3[] = [];
  weather: T.LineSegments;
  weatherBase: Float32Array;
  shared = {
    sphere: new T.SphereGeometry(1, 12, 8),
    capsule: new T.CapsuleGeometry(1, 1, 4, 8),
    box: new T.BoxGeometry(1, 1, 1),
  };
  constructor(host: HTMLElement, level: Level, save: Save) {
    this.level = level;
    this.settings = save;
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor("#b1a28a");
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(this.renderer.domElement);
    this.scene.add(this.world);
    for (const geometry of Object.values(this.shared)) {
      const batch = new T.InstancedMesh(geometry, this.mat("#ffffff"), 512);
      batch.count = 0;
      batch.castShadow = true;
      batch.frustumCulled = false;
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.playerBatches.set(geometry, batch);
      this.scene.add(batch);
    }
    this.scene.fog = new T.FogExp2("#b4a18c", 0.0075);
    this.hemi = new T.HemisphereLight("#e8ece5", "#3e4931", 2.5);
    this.scene.add(this.hemi);
    this.sun = new T.DirectionalLight("#ffe5b0", 3);
    this.sun.position.set(-25, 38, -18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -40,
      right: 40,
      top: 48,
      bottom: -35,
      near: 1,
      far: 150,
    });
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.025;
    this.sun.target.position.set(0, 0, 20);
    this.scene.add(this.sun, this.sun.target);
    this.pitch();
    this.stands();
    this.crowd = this.makeCrowd();
    this.scene.add(this.crowd);
    this.net = this.goal();
    this.netBase = (
      this.net.geometry.attributes.position.array as Float32Array
    ).slice();
    this.ball = this.makeBall();
    this.scene.add(this.ball);
    this.ring = new T.Mesh(
      new T.RingGeometry(0.56, 0.62, 48),
      new T.MeshBasicMaterial({
        color: "#d7ff7e",
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.scene.add(this.ring);
    this.trail = new T.Line(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.Float32BufferAttribute(new Float32Array(30), 3),
      ),
      new T.LineBasicMaterial({
        color: "#e5edce",
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    this.scene.add(this.trail);
    const rng = random(31),
      rain = [];
    for (let i = 0; i < 340; i++) {
      const x = (rng() - 0.5) * 65,
        y = rng() * 22,
        z = rng() * 60;
      rain.push(x, y, z, x - 0.04, y - 0.35, z + 0.03);
    }
    this.weatherBase = new Float32Array(rain);
    this.weather = new T.LineSegments(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.Float32BufferAttribute(rain, 3),
      ),
      new T.LineBasicMaterial({
        color: "#dce9e3",
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    this.scene.add(this.weather);
    this.configure(level);
    this.quality();
    this.resize();
  }
  mat(color: T.ColorRepresentation, roughness = 0.8) {
    return new T.MeshStandardMaterial({ color, roughness });
  }
  box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: T.Material,
    parent: T.Object3D = this.world,
  ) {
    const m = new T.Mesh(this.shared.box, material);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  line(
    points: T.Vector3[],
    color: T.ColorRepresentation = "#dae0c3",
    opacity = 1,
  ) {
    const l = new T.Line(
      new T.BufferGeometry().setFromPoints(points),
      new T.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
    );
    this.world.add(l);
    return l;
  }
  pitch() {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 2048;
    const g = c.getContext("2d")!;
    const rng = random(40);
    g.fillStyle = "#527543";
    g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 20; i++) {
      g.fillStyle = i % 2 ? "rgba(29,54,21,.13)" : "rgba(175,185,103,.045)";
      g.fillRect(0, i * 102.4, 1024, 103);
    }
    for (let i = 0; i < 230000; i++) {
      const x = rng() * 1024,
        y = rng() * 2048;
      g.fillStyle = `rgba(${rng() > 0.6 ? "193,199,120" : "18,48,23"},${rng() * 0.15})`;
      g.fillRect(x, y, 0.5 + rng(), 2 + rng() * 3);
    }
    for (const y of [0, 2040]) {
      const gr = g.createRadialGradient(512, y, 0, 512, y, 120);
      gr.addColorStop(0, "rgba(143,125,83,.24)");
      gr.addColorStop(1, "transparent");
      g.fillStyle = gr;
      g.fillRect(350, y - 140, 324, 280);
    }
    const texture = new T.CanvasTexture(c);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 8;
    const field = new T.Mesh(
      new T.PlaneGeometry(68, 105),
      new T.MeshStandardMaterial({ map: texture, roughness: 1 }),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.z = 52.5;
    field.receiveShadow = true;
    this.world.add(field);
    this.box(180, 0.1, 240, 0, -0.12, 45, this.mat("#314d31"));
    const mark = this.mat("#d9e0c5");
    const strip = (x: number, z: number, w: number, d: number) =>
      this.box(w, 0.014, d, x, 0.015, z, mark);
    strip(0, 0, 68, 0.11);
    strip(0, 105, 68, 0.11);
    strip(-34, 52.5, 0.11, 105);
    strip(34, 52.5, 0.11, 105);
    strip(0, 52.5, 68, 0.11);
    for (const end of [0, 105]) {
      const sign = end === 0 ? 1 : -1;
      strip(0, end + 16.5 * sign, 40.32, 0.11);
      strip(-20.16, end + 8.25 * sign, 0.11, 16.5);
      strip(20.16, end + 8.25 * sign, 0.11, 16.5);
      strip(0, end + 5.5 * sign, 18.32, 0.11);
      strip(-9.16, end + 2.75 * sign, 0.11, 5.5);
      strip(9.16, end + 2.75 * sign, 0.11, 5.5);
      const spot = new T.Mesh(new T.CircleGeometry(0.13, 16), mark);
      spot.rotation.x = -Math.PI / 2;
      spot.position.set(0, 0.03, end + 11 * sign);
      this.world.add(spot);
      const arc = [];
      for (let i = 0; i <= 64; i++) {
        const a = 0.65 + ((Math.PI - 1.3) * i) / 64;
        arc.push(
          new T.Vector3(
            Math.cos(a) * 9.15,
            0.03,
            end + (11 + Math.sin(a) * 9.15) * sign,
          ),
        );
      }
      this.line(arc);
    }
    this.line(
      Array.from(
        { length: 97 },
        (_, i) =>
          new T.Vector3(
            Math.cos((i / 96) * Math.PI * 2) * 9.15,
            0.03,
            52.5 + Math.sin((i / 96) * Math.PI * 2) * 9.15,
          ),
      ),
    );
    for (const x of [-34, 34])
      for (const z of [0, 105]) {
        this.box(0.045, 1.5, 0.045, x, 0.75, z, this.mat("#f3edd9"));
        this.box(
          0.43,
          0.27,
          0.015,
          x + Math.sign(x) * 0.2,
          1.36,
          z,
          this.mat("#d6ed82"),
        );
        const arc = [];
        for (let i = 0; i <= 16; i++) {
          const a = ((i / 16) * Math.PI) / 2;
          arc.push(
            new T.Vector3(
              x - Math.sign(x) * Math.cos(a),
              0.03,
              z + (z ? -1 : 1) * Math.sin(a),
            ),
          );
        }
        this.line(arc);
      }
  }
  banner(text: string, w = 1024, bg = "#192923", color = "#e5ecd6") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = 96;
    const g = c.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, 96);
    g.fillStyle = color;
    g.font = "700 45px Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, 50);
    const tx = new T.CanvasTexture(c);
    tx.colorSpace = T.SRGBColorSpace;
    this.bannerTextures.push(tx);
    return new T.MeshStandardMaterial({
      map: tx,
      roughness: 0.65,
      emissive: "#ffffff",
      emissiveMap: tx,
      emissiveIntensity: 0.13,
    });
  }
  stands() {
    const concrete = this.mat("#535955"),
      dark = this.mat("#172421"),
      steel = this.mat("#a0a79b");
    for (let r = 0; r < 14; r++) {
      this.box(98, 0.65, 1.5, 0, 0.4 + r * 0.63, -11 - r * 1.35, concrete);
      this.box(1.5, 0.65, 138, -42 - r * 1.35, 0.4 + r * 0.63, 47, concrete);
      this.box(1.5, 0.65, 138, 42 + r * 1.35, 0.4 + r * 0.63, 47, concrete);
    }
    this.box(103, 2.3, 2, 0, 10.4, -30, dark);
    this.box(2, 2, 144, -62, 10.4, 47, dark);
    this.box(2, 2, 144, 62, 10.4, 47, dark);
    const roof = this.mat("#293b34");
    this.box(110, 0.35, 12, 0, 14, -25, roof);
    this.box(12, 0.35, 146, -56, 14, 47, roof);
    this.box(12, 0.35, 146, 56, 14, 47, roof);
    for (let x = -48; x <= 48; x += 8) {
      this.box(0.16, 14, 0.16, x, 7, -28, steel);
      this.line(
        [
          new T.Vector3(x, 10, -28),
          new T.Vector3(x, 14, -17),
          new T.Vector3(x, 14, -30),
        ],
        "#a6aaa1",
      );
    }
    for (let z = -18; z < 112; z += 12)
      for (const x of [-59, 59]) {
        this.box(0.16, 14, 0.16, x, 7, z, steel);
        this.line(
          [
            new T.Vector3(x, 10, z),
            new T.Vector3(x - Math.sign(x) * 10, 14, z),
            new T.Vector3(x, 14, z),
          ],
          "#a6aaa1",
        );
      }
    for (let i = 0; i < 9; i++) {
      const ad = this.banner(
        i % 3 === 0
          ? "LAST LIGHT"
          : i % 3 === 1
            ? "MAKE THE MOMENT."
            : "NORTHSTAR  /  FC",
        768,
        i % 3 === 1 ? "#c4da91" : "#182820",
        i % 3 === 1 ? "#15271c" : "#e5ecd6",
      );
      this.box(9.6, 0.85, 0.2, (i - 4) * 10, 0.55, -7, ad);
    }
    for (let i = 0; i < 10; i++)
      for (const x of [-37, 37]) {
        const b = this.box(
          0.2,
          0.85,
          10,
          x,
          0.55,
          i * 10,
          this.banner(i % 2 ? "THE BEAUTIFUL GAME" : "LAST LIGHT", 768),
        );
        b.rotation.y = 0;
      }
    this.box(7, 3, 4, 27, 1.4, -14, dark);
    this.box(8, 0.25, 5, 27, 3, -14, concrete);
    for (const x of [-38, 38]) {
      this.box(1, 1.5, 8, x, 0.75, 35, this.mat("#263e32"));
      this.box(1.5, 0.1, 9, x, 2.4, 35, steel);
    }
    for (const x of [-36, 36])
      for (const z of [-7, 63]) {
        this.box(0.18, 24, 0.18, x, 12, z, steel);
        this.box(5.5, 1.4, 0.2, x, 24, z, steel);
        for (let j = 0; j < 6; j++)
          this.box(
            0.62,
            0.65,
            0.22,
            x - 2.1 + j * 0.85,
            24,
            z + 0.15,
            new T.MeshStandardMaterial({
              color: "#ffffde",
              emissive: "#ffffd4",
              emissiveIntensity: 3,
            }),
          );
      }
    // Far city silhouettes establish a world beyond the stands.
    const rng = random(11);
    for (let i = 0; i < 25; i++) {
      const h = 4 + rng() * 15;
      this.box(
        3 + rng() * 7,
        h,
        8,
        -95 + i * 8,
        h / 2,
        -65 - rng() * 15,
        this.mat("#747d73"),
      );
    }
  }
  makeCrowd() {
    const rng = random(9);
    const n = 14400;
    const torso = new T.SphereGeometry(1, 6, 3).scale(0.8, 1, 0.5);
    const head = new T.SphereGeometry(1, 5, 3)
      .scale(0.42, 0.46, 0.42)
      .translate(0, 1.35, 0);
    const geometry = mergeGeometries([torso, head]);
    torso.dispose();
    head.dispose();
    const mesh = new T.InstancedMesh(geometry, this.mat("#ffffff"), n);
    const o = new T.Object3D();
    const colors = [
      "#a9b49c",
      "#ded5c1",
      "#344b40",
      "#677467",
      "#24382f",
      "#84966a",
      "#a08869",
    ];
    for (let i = 0; i < n; i++) {
      const section = i % 3,
        r = Math.floor(rng() * 13),
        t = rng();
      o.position.set(
        section === 0
          ? (t - 0.5) * 96
          : section === 1
            ? -42 - r * 1.35
            : 42 + r * 1.35,
        0.98 + r * 0.63,
        section === 0 ? -11 - r * 1.35 : -19 + t * 135,
      );
      o.scale.set(0.28, 0.28, 0.28);
      o.rotation.y =
        section === 0 ? 0 : section === 1 ? Math.PI / 2 : -Math.PI / 2;
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(
        i,
        new T.Color(colors[Math.floor(rng() * colors.length)]),
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    (mesh.material as T.MeshStandardMaterial).onBeforeCompile = (shader) => {
      shader.uniforms.crowdTime = this.crowdTime;
      shader.uniforms.crowdEnergy = this.crowdEnergy;
      shader.vertexShader =
        "uniform float crowdTime; uniform float crowdEnergy;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n transformed.x += sin(crowdTime * 2.5 + instanceMatrix[3].x) * crowdEnergy * max(position.y, 0.0);",
      );
    };
    return mesh;
  }
  goal() {
    const white = this.mat("#f0eee2", 0.4);
    for (const x of [-3.66, 3.66]) {
      const post = new T.Mesh(
        new T.CylinderGeometry(0.06, 0.06, 2.44, 12),
        white,
      );
      post.position.set(x, 1.22, 0);
      post.castShadow = true;
      this.world.add(post);
    }
    const bar = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 7.44, 12), white);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 2.44, 0);
    bar.castShadow = true;
    this.world.add(bar);
    const pts: number[] = [];
    const seg = (a: number[], b: number[]) => pts.push(...a, ...b);
    for (let x = -3.66; x <= 3.67; x += 0.18) {
      seg([x, 0, -2], [x, 2.44, -1.5]);
      seg([x, 2.44, -1.5], [x, 2.44, 0]);
    }
    for (let y = 0; y <= 2.45; y += 0.16) {
      const z = -2 + (y / 2.44) * 0.5;
      seg([-3.66, y, z], [3.66, y, z]);
      for (const x of [-3.66, 3.66]) seg([x, y, 0], [x, y, z]);
    }
    for (let z = -1.5; z <= 0.01; z += 0.18)
      seg([-3.66, 2.44, z], [3.66, 2.44, z]);
    for (const x of [-3.66, 3.66])
      for (let z = -1.8; z < 0; z += 0.18)
        seg([x, 0, z], [x, 2.44, Math.max(z, -1.5)]);
    const net = new T.LineSegments(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.Float32BufferAttribute(pts, 3),
      ),
      new T.LineBasicMaterial({
        color: "#e0e6db",
        transparent: true,
        opacity: 0.4,
      }),
    );
    this.world.add(net);
    return net;
  }
  makeBall() {
    const group = new T.Group();
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#eee9d9";
    g.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 8; col++) {
        const x = col * 64 + (row % 2) * 32,
          y = row * 64 + 32;
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          g.lineTo(x + 26 * Math.cos(a), y + 26 * Math.sin(a));
        }
        g.closePath();
        g.fillStyle = (row + col) % 3 === 0 ? "#172922" : "#f6f2e9";
        g.fill();
        g.strokeStyle = "#b1baac";
        g.lineWidth = 1;
        g.stroke();
      }
    const tx = new T.CanvasTexture(c);
    tx.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.SphereGeometry(0.112, 20, 14),
      new T.MeshStandardMaterial({ map: tx, roughness: 0.6 }),
    );
    mesh.castShadow = true;
    group.add(mesh);
    return group;
  }
  footballer(p: Player): Rig {
    const root = new T.Group(),
      body = new T.Group();
    root.add(body);
    const profile = this.settings.profile;
    const skin = this.mat(
      p.team === "home"
        ? profile.skin
        : ["#835f46", "#b18366", "#d1a285"][p.id % 3],
    );
    const shirt = this.mat(
      p.team === "keeper"
        ? "#e8ab54"
        : p.team === "home"
          ? profile.kit
          : "#294b50",
    );
    const shorts = this.mat(p.team === "home" ? "#283b2d" : "#182b31");
    const socks = this.mat(
      p.team === "keeper"
        ? "#c8883b"
        : p.team === "home"
          ? "#e0e5cc"
          : "#294b50",
    );
    const boots = this.mat(p.team === "home" ? profile.boots : "#dadbcf");
    const shape = (
      parent: T.Object3D,
      geo: T.BufferGeometry,
      mat: T.Material,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
    ) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    shape(body, this.shared.sphere, shirt, 0, 1.24, 0, 0.24, 0.31, 0.14);
    shape(body, this.shared.sphere, shorts, 0, 0.91, 0, 0.22, 0.17, 0.145);
    shape(body, this.shared.sphere, skin, 0, 1.55, 0, 0.074, 0.1, 0.073);
    const head = new T.Group();
    head.position.set(0, 1.69, 0.006);
    body.add(head);
    shape(head, this.shared.sphere, skin, 0, 0, 0, 0.114, 0.145, 0.107);
    shape(head, this.shared.sphere, skin, 0, -0.015, 0.106, 0.025, 0.03, 0.024);
    const hair = shape(
      head,
      this.shared.sphere,
      this.mat("#30251e"),
      0,
      0.067,
      -0.014,
      0.117,
      0.092,
      0.102,
    );
    hair.visible = profile.hair !== "shaved" || p.team !== "home";
    const arms: T.Group[] = [],
      legs: T.Group[] = [],
      shins: T.Group[] = [];
    for (const side of [-1, 1]) {
      const arm = new T.Group();
      arm.position.set(side * 0.23, 1.4, 0);
      body.add(arm);
      shape(arm, this.shared.capsule, shirt, 0, -0.08, 0, 0.078, 0.078, 0.078);
      shape(
        arm,
        this.shared.capsule,
        skin,
        side * 0.025,
        -0.28,
        0.018,
        0.051,
        0.108,
        0.051,
      );
      shape(
        arm,
        this.shared.sphere,
        p.team === "keeper" ? this.mat("#eee8d5") : skin,
        side * 0.025,
        -0.46,
        0.04,
        0.05,
        0.073,
        0.045,
      );
      arms.push(arm);
      const leg = new T.Group();
      leg.position.set(side * 0.115, 0.88, 0);
      body.add(leg);
      shape(leg, this.shared.capsule, shorts, 0, -0.08, 0, 0.091, 0.085, 0.09);
      shape(leg, this.shared.capsule, skin, 0, -0.22, 0, 0.068, 0.093, 0.068);
      const shin = new T.Group();
      shin.position.y = -0.4;
      leg.add(shin);
      shape(shin, this.shared.capsule, socks, 0, -0.14, 0, 0.059, 0.111, 0.055);
      shape(
        shin,
        this.shared.sphere,
        boots,
        0,
        -0.36,
        0.062,
        0.072,
        0.048,
        0.14,
      );
      legs.push(leg);
      shins.push(shin);
    }
    const number = this.box(
      0.2,
      0.24,
      0.008,
      0,
      1.29,
      -0.135,
      this.numberMaterial(p.team === "home" ? profile.number + p.id : p.id),
      body,
    );
    const trim = this.box(
      0.065,
      0.36,
      0.006,
      -0.1,
      1.25,
      -0.139,
      this.mat(p.team === "home" ? "#2b4b34" : "#97b5b5"),
      body,
    );
    trim.rotation.z = 0.13;
    const parts: T.Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof T.Mesh && object !== number && object !== hair) {
        parts.push(object);
        object.visible = false;
      }
    });
    this.scene.add(root);
    return {
      root,
      body,
      arms,
      legs,
      shins,
      head,
      shirt,
      boots,
      skin,
      hair,
      number,
      numberValue: profile.number + p.id,
      parts,
    };
  }
  numberMaterial(n: number) {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = "#1c3324";
    g.font = "bold 52px Arial";
    g.textAlign = "center";
    g.fillText(String(n % 100), 32, 54);
    const tx = new T.CanvasTexture(c);
    return new T.MeshStandardMaterial({
      map: tx,
      transparent: true,
      roughness: 1,
    });
  }
  configure(level: Level) {
    this.level = level;
    this.night = level.stadium >= 3;
    const sky = this.night
      ? "#202f3b"
      : level.stadium === 2
        ? "#a7afb1"
        : "#b9ad96";
    this.scene.background = new T.Color(sky);
    (this.scene.fog as T.FogExp2).color.set(sky);
    this.sun.color.set(this.night ? "#dceeff" : "#ffe3aa");
    this.sun.intensity = this.night ? 2.8 : 3;
    this.sun.position.set(this.night ? -22 : -25, 38, this.night ? 25 : -18);
    this.hemi.intensity = this.night ? 1.8 : 2.5;
    this.crowd.count = [6500, 9000, 11000, 13000, 14400][level.stadium];
    this.lastCarrier = -1;
  }
  quality() {
    const q = this.settings.settings.graphics;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, q === "low" ? 1 : q === "high" ? 2 : 1.5),
    );
    this.renderer.shadowMap.enabled = q !== "low";
  }
  resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.fov = this.width / this.height < 0.85 ? 52 : 44;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }
  project(p: { x: number; y?: number; z: number }) {
    vec.set(p.x, p.y ?? 0.05, p.z).project(this.camera);
    return {
      x: (vec.x * 0.5 + 0.5) * this.width,
      y: (-vec.y * 0.5 + 0.5) * this.height,
    };
  }
  unproject(x: number, y: number, goal = false) {
    this.ray.setFromCamera(
      new T.Vector2((x / this.width) * 2 - 1, 1 - (y / this.height) * 2),
      this.camera,
    );
    const out = new T.Vector3();
    const plane = goal
      ? new T.Plane(new T.Vector3(0, 0, 1), 0)
      : new T.Plane(new T.Vector3(0, 1, 0), -0.11);
    return this.ray.ray.intersectPlane(plane, out) ? out : null;
  }
  update(frame: Frame, dt: number, mode: string, celebration = 0) {
    this.elapsed += dt;
    this.mode = mode;
    this.crowdTime.value = this.elapsed;
    this.crowdEnergy.value = frame.state === "goal" ? 0.22 : 0.035;
    this.weather.visible =
      this.level.stadium === 3 &&
      this.level.id % 3 === 0 &&
      this.settings.settings.graphics !== "low";
    if (this.weather.visible) {
      const a = this.weather.geometry.attributes.position as T.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        const j = i * 3;
        a.setY(
          i,
          (((this.weatherBase[j + 1] - this.elapsed * 8) % 22) + 22) % 22,
        );
      }
      a.needsUpdate = true;
    }
    const visible = new Set(frame.players.map((p) => p.id));
    for (const [id, rig] of this.rigs) rig.root.visible = visible.has(id);
    for (const p of frame.players) {
      let rig = this.rigs.get(p.id);
      if (!rig) {
        rig = this.footballer(p);
        this.rigs.set(p.id, rig);
      }
      rig.root.visible = true;
      rig.root.position.set(p.x, 0, p.z);
      rig.root.rotation.set(0, p.angle, 0);
      rig.body.position.set(0, 0, 0);
      rig.body.rotation.set(0, 0, 0);
      rig.head.rotation.set(0, 0, 0);
      const moving = Math.hypot(p.vx, p.vz) > 0.2;
      const phase = (mode === "menu" ? this.elapsed : p.anim) * 11;
      const stride = moving ? 0.55 : 0.035;
      rig.legs.forEach((leg, i) => {
        leg.rotation.set(Math.sin(phase + i * Math.PI) * stride, 0, 0);
        rig.shins[i].rotation.x =
          Math.max(0, -Math.sin(phase + i * Math.PI)) * (moving ? 0.7 : 0.03);
      });
      rig.arms.forEach((a, i) => {
        a.rotation.set(
          -Math.sin(phase + i * Math.PI) * stride * 0.7,
          0,
          (i ? 1 : -1) * 0.13,
        );
      });
      if (moving) {
        rig.body.position.y = Math.abs(Math.sin(phase)) * 0.035;
        rig.body.rotation.x = 0.1;
      }
      if (
        ["shot", "pass", "cross", "volley"].includes(p.action) &&
        p.anim < 0.65
      ) {
        const swing = Math.sin((p.anim / 0.65) * Math.PI);
        rig.legs[1].rotation.x = -swing * (p.action === "shot" ? 1.5 : 1);
        rig.shins[1].rotation.x = swing * 0.15;
        rig.arms[0].rotation.z = -0.7 * swing;
        rig.body.rotation.x = 0.15 * swing;
      }
      if (p.action === "header") {
        rig.body.position.y =
          Math.sin(Math.min(p.anim / 0.7, 1) * Math.PI) * 0.4;
        rig.body.rotation.x = 0.25;
      }
      if (p.action === "ready") {
        rig.body.position.y = -0.12;
        rig.legs.forEach((l) => (l.rotation.x = -0.3));
        rig.shins.forEach((l) => (l.rotation.x = 0.55));
        rig.arms.forEach((a, i) => {
          a.rotation.x = -0.4;
          a.rotation.z = (i ? 1 : -1) * 0.35;
        });
      }
      if (p.action === "dive" || p.action === "parry") {
        rig.body.rotation.z = Math.min(p.anim * 5, 1) * Math.PI * 0.39;
        rig.body.position.y = Math.sin(Math.min(p.anim, 1) * Math.PI) * 0.35;
        rig.arms.forEach((a) => {
          a.rotation.z = -1.7;
          a.rotation.x = -0.3;
        });
      }
      if (p.action === "catch") {
        rig.arms.forEach((a) => (a.rotation.x = -1.2));
      }
      if (p.action === "tackle") {
        rig.body.position.y = -0.45;
        rig.body.rotation.x = -0.55;
        rig.legs[0].rotation.x = -1.3;
      }
      if (p.action === "block") rig.legs[1].rotation.z = -0.65;
      if (frame.state === "goal" && p.team === "home") {
        const t = celebration;
        rig.arms.forEach(
          (a, i) =>
            (a.rotation.z =
              (i ? 1 : -1) *
              (this.settings.profile.celebration === "fist" ? 2.6 : 1.45)),
        );
        rig.body.position.y = Math.abs(Math.sin(t * 4)) * 0.08;
        if (this.settings.profile.celebration === "slide") {
          rig.body.position.y = -0.5;
          rig.shins.forEach((s) => (s.rotation.x = 1.7));
        }
      }
      if (p.team === "home") {
        rig.shirt.color.set(this.settings.profile.kit);
        rig.boots.color.set(this.settings.profile.boots);
        rig.skin.color.set(this.settings.profile.skin);
        rig.hair.visible = this.settings.profile.hair !== "shaved";
        const n = this.settings.profile.number + p.id;
        if (rig.numberValue !== n) {
          const m = rig.number.material as T.MeshStandardMaterial;
          m.map?.dispose();
          m.dispose();
          rig.number.material = this.numberMaterial(n);
          rig.numberValue = n;
        }
      }
    }
    for (const batch of this.playerBatches.values()) batch.count = 0;
    for (const rig of this.rigs.values()) {
      if (!rig.root.visible) continue;
      rig.root.updateMatrixWorld(true);
      for (const part of rig.parts) {
        const batch = this.playerBatches.get(part.geometry)!;
        batch.setMatrixAt(batch.count, part.matrixWorld);
        batch.setColorAt(
          batch.count,
          (part.material as T.MeshStandardMaterial).color,
        );
        batch.count++;
      }
    }
    for (const batch of this.playerBatches.values()) {
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    }
    this.ball.position.set(
      frame.ball.x,
      Math.max(0.11, frame.ball.y),
      frame.ball.z,
    );
    this.trail.visible =
      frame.state === "execution" &&
      Math.hypot(frame.ball.vx, frame.ball.vz) > 23;
    if (this.trail.visible) {
      this.trailPoints.unshift(this.ball.position.clone());
      if (this.trailPoints.length > 10) this.trailPoints.pop();
      const a = this.trail.geometry.attributes.position as T.BufferAttribute;
      this.trailPoints.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z));
      this.trail.geometry.setDrawRange(0, this.trailPoints.length);
      a.needsUpdate = true;
    } else this.trailPoints.length = 0;
    this.ball.rotation.x += (frame.ball.vz * dt) / 0.112;
    this.ball.rotation.z -= (frame.ball.vx * dt) / 0.112;
    this.ring.visible = frame.state === "decision" && mode === "play";
    this.ring.position.set(frame.ball.x, 0.04, frame.ball.z);
    (this.ring.material as T.MeshBasicMaterial).opacity =
      0.58 + Math.sin(this.elapsed * 3) * 0.16;
    const arr = this.net.geometry.attributes.position as T.BufferAttribute;
    for (let i = 0; i < arr.count; i++) {
      const j = i * 3;
      const x = this.netBase[j],
        y = this.netBase[j + 1],
        z = this.netBase[j + 2];
      const wave =
        frame.state === "goal"
          ? Math.sin(
              celebration * 18 -
                Math.hypot(x - frame.ball.x, y - frame.ball.y) * 2,
            ) *
            Math.exp(-celebration * 1.8) *
            0.25
          : 0;
      arr.setZ(i, z + wave * Math.max(0, 1 - Math.abs(x) / 3.66));
    }
    arr.needsUpdate = true;
    const mobile = this.width / this.height < 0.85;
    if (mode === "menu") {
      this.position.set(
        23 +
          Math.sin(this.elapsed * 0.07) *
            (this.settings.settings.reducedMotion ? 0 : 1.5),
        8.5,
        33,
      );
      this.look.set(-1, 1, 7);
    } else {
      const z = Math.max(17, frame.ball.z);
      const wide = Math.abs(frame.ball.x) > 23;
      this.position.set(
        mobile ? frame.ball.x * (wide ? 0.45 : 0.12) : frame.ball.x * 0.22,
        (mobile ? 38 : 21) + (wide ? 7 : 0),
        Math.max(mobile ? (wide ? 79 : 65) : 39, z + 20),
      );
      this.look.set(
        frame.ball.x * (mobile && wide ? 0.45 : 0.25),
        0,
        Math.max(7, z * 0.55),
      );
      if (
        frame.state === "execution" &&
        !this.settings.settings.reducedMotion
      ) {
        this.position.x += frame.ball.x * 0.15;
        this.look.z = Math.max(4, frame.ball.z * 0.42);
      }
      if (frame.state === "goal" && !this.settings.settings.reducedMotion) {
        this.position.set(13, 5.5, 15);
        this.look.set(0, 1, 0);
      }
    }
    const lerp = this.settings.settings.reducedMotion
      ? 1
      : 1 - Math.exp(-dt * (mode === "menu" ? 1.6 : 3));
    if (!this.cameraFrozen) {
      if (this.camera.position.length() < 1)
        this.camera.position.copy(this.position);
      else this.camera.position.lerp(this.position, lerp);
    }
    if (!this.cameraFrozen) this.target.lerp(this.look, lerp);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    if (!this.firstRenderMs) this.firstRenderMs = Math.round(performance.now());
    this.frameCount++;
    const wall = performance.now();
    if (wall - this.fpsTime > 1000) {
      this.fps = (this.frameCount * 1000) / (wall - this.fpsTime);
      this.frameCount = 0;
      this.fpsTime = wall;
      if (import.meta.env.DEV)
        this.renderer.domElement.dataset.metrics = JSON.stringify({
          fps: Math.round(this.fps),
          calls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          geometries: this.renderer.info.memory.geometries,
          firstRenderMs: this.firstRenderMs,
        });
    }
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          for (const v of Object.values(m))
            if (v instanceof T.Texture) textures.add(v);
        }
      }
    });
    for (const t of textures) t.dispose();
    for (const m of materials) m.dispose();
    for (const g of geometries) g.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
