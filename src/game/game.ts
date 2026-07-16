// @ts-nocheck
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { AssetManager } from "./rendering/assetManager.ts";
import { ObjectPool } from "./rendering/objectPool.ts";
import { detectQuality } from "./systems/quality.ts";
import { WeatherController } from "./systems/weather.ts";
import { loadSaveV2, persistSaveV2, hydrateNativeSave } from "./systems/storage.ts";
import { RANK_DEFS, MAX_RANK, COMMANDER_MERIT, rankName, rankXpToNext, weaponForRank, weaponStageForRank } from "./config/progression.ts";
import { SKILL_DEFS, chooseSkillOptions, skillLevel } from "./config/skills.ts";
import {
  ARMOR_SHARES,
  DAMAGE_VALUES,
  bossHealth,
  enemyHealth,
  fireInterval,
  heroMaxHealth,
  projectileDamage,
  resolveHeroDamage,
} from "./config/balance.ts";
import { nextEventDistance, pickRunEvent } from "./config/events.ts";
import { compactInPlace } from "./util/compact.ts";

const BUILD_VERSION = "mg-road-13";

/* ================= 基础场景 ================= */
const ROAD_HALF = 8;          // 道路半宽
const SPAWN_Z = -100;         // 敌人生成位置
const PLAYER_Z = 0;
const MAX_SQUAD = 1;
const MAX_TIER = MAX_RANK;

/** 单枪体系：机关枪。成长只叠攻速 / 攻击（门、箱子、Boss）。 */
const WEAPON_DEFS = {
  rifle: { label: "机关枪", color: 0x63e6be, css: "#63e6be", damage: 2, fireRate: 10, speed: 1.42, type: "bullet", unlockBoss: 0 },
};
const WEAPON_ORDER = Object.keys(WEAPON_DEFS);
const BOSS_DEFS = [
  { name: "铁罐头大佐", color: 0x4a7a3e, accent: 0xffc44f, unlock: null, theme: "tank", signature: "双线压路炮 · 别站直线!" },
  { name: "铁饼队长",   color: 0x5a7a96, accent: 0x8de8ff, unlock: null, theme: "shield", signature: "正面冲撞 · 盾震波" },
  { name: "红点幽灵",   color: 0x5a4a78, accent: 0xff6b9d, unlock: null, theme: "sniper", signature: "红点锁定 · 持续走位" },
  { name: "爆米花将军", color: 0x9a4538, accent: 0xff9d5c, unlock: null, theme: "rocket", signature: "导弹雨 · 钻绿色缺口" },
  { name: "棱镜哨兵",   color: 0x1f7a86, accent: 0x72f5ff, unlock: null, theme: "energy", signature: "切割光刀 · 扩环封路" },
  { name: "公路终焉王", color: 0x5c1a6b, accent: 0xffd86b, unlock: null, theme: "final", signature: "全招轮转 · 终焉试炼!" },
];
/** 公路五害 + 满级终焉王；终焉后可结算或无尽 */
const CAMPAIGN_BOSS_COUNT = BOSS_DEFS.length;
/** 只按军衔召唤：五害 → 司令后终焉王 */
const BOSS_SUMMON = [
  { rank: 3 },   // 1 铁罐头 · 下士
  { rank: 5 },   // 2 铁饼 · 上士
  { rank: 7 },   // 3 红点 · 中尉
  { rank: 9 },   // 4 爆米花 · 少校
  { rank: 11 },  // 5 棱镜 · 上校
  { rank: 13 },  // 6 终焉王 · 司令满级
] as const;
let endlessMode = false;

let saveData = loadSaveV2();
function persistSave() { persistSaveV2(saveData); }

const mobileDevice = matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const lowPowerDevice = mobileDevice && (!navigator.deviceMemory || navigator.deviceMemory <= 4);
const quality = detectQuality(
  mobileDevice,
  lowPowerDevice,
  saveData.quality === "high" || saveData.quality === "medium" || saveData.quality === "low" ? saveData.quality : "auto",
);
const canvasEl = document.getElementById("cv") as HTMLCanvasElement | null;
if (!canvasEl) throw new Error("缺少画布 #cv，请勿直接双击 html，请用 npm run dev 打开");

function createRenderer(): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({
      canvas: canvasEl!,
      antialias: !lowPowerDevice,
      powerPreference: "high-performance",
      alpha: false,
      failIfMajorPerformanceCaveat: false,
    });
  } catch {
    // Some mobile browsers reject high-performance or antialias combinations.
    return new THREE.WebGLRenderer({ canvas: canvasEl!, antialias: false, alpha: false });
  }
}

const renderer = createRenderer();
renderer.setPixelRatio(Math.min(quality.pixelRatio, mobileDevice ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.shadowMap.enabled = quality.dynamicShadows && !lowPowerDevice;
renderer.shadowMap.type = THREE.PCFShadowMap;
let assetManager: AssetManager;
try {
  assetManager = new AssetManager(renderer);
} catch {
  // KTX2/basis detect can fail on some WebViews; game still runs with procedural models.
  assetManager = new AssetManager(renderer);
}

function makeSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 32; c.height = 512;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#66c8ff");
  grad.addColorStop(0.48, "#b8e6ff");
  grad.addColorStop(1, "#eef8ff");
  g.fillStyle = grad; g.fillRect(0, 0, 32, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x718ca2);
scene.fog = new THREE.Fog(0x91a8b5, 46, 116);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
const cameraBase = { y: 9.5, z: 11, lookZ: -20 };
const composer = new EffectComposer(renderer);
composer.setPixelRatio(quality.bloom ? Math.min(quality.pixelRatio, 1.25) : quality.pixelRatio);
composer.addPass(new RenderPass(scene, camera));
if (quality.bloom) {
  // 提高强度/半径、降低阈值:能量色、弹道、Boss 光束真正发光,阈值把关避免糊脸
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), .58, .62, .72);
  composer.addPass(bloom);
}

function updateCameraLayout() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const portrait = width / height < 0.8;
  camera.aspect = width / height;
  camera.fov = portrait ? 72 : 60;
  cameraBase.y = portrait ? 11.5 : 9.5;
  cameraBase.z = portrait ? 15 : 11;
  cameraBase.lookZ = portrait ? -18 : -20;
  camera.position.set(0, cameraBase.y, cameraBase.z);
  camera.lookAt(0, 0, cameraBase.lookZ);
  camera.updateProjectionMatrix();
}
updateCameraLayout();

const hemiLight = new THREE.HemisphereLight(0xdcebff, 0x3a4a3c, .88);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xfff0d4, .78);
sun.position.set(15, 30, 10);
sun.castShadow = quality.dynamicShadows;
scene.add(sun);
const skyFill = new THREE.DirectionalLight(0x74c2ff, .38);
skyFill.position.set(-18, 12, -25);
scene.add(skyFill);
const heroRim = new THREE.PointLight(0x86d8ff, 1.5, 28, 2);
heroRim.position.set(-5, 8, 4);
scene.add(heroRim);
const weather = new WeatherController(scene, renderer, hemiLight, sun, skyFill);

const rainPositions = new Float32Array(quality.rainCount * 2 * 3);
for (let i = 0; i < quality.rainCount; i++) {
  const x = randSeed(i * 3.1) * 24 - 12;
  const y = 2 + randSeed(i * 7.3) * 15;
  const z = -70 + randSeed(i * 11.7) * 82;
  const p = i * 6;
  rainPositions[p] = x; rainPositions[p + 1] = y; rainPositions[p + 2] = z;
  rainPositions[p + 3] = x - .08; rainPositions[p + 4] = y - 1.15; rainPositions[p + 5] = z + .18;
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xb9ddff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const rainMesh = new THREE.LineSegments(rainGeo, rainMat);
rainMesh.frustumCulled = false;
scene.add(rainMesh);

function updateRain(): void {
  rainMat.opacity = weather.rainStrength * (quality.level === "low" ? .32 : .48);
  rainMesh.visible = rainMat.opacity > .01;
  if (!rainMesh.visible) return;
  const positions = rainGeo.attributes.position.array;
  for (let i = 0; i < quality.rainCount; i++) {
    const p = i * 6;
    positions[p + 1] -= .48;
    positions[p + 4] -= .48;
    positions[p + 2] += .07;
    positions[p + 5] += .07;
    if (positions[p + 1] < .1 || positions[p + 2] > 12) {
      const x = player?.x ? player.x + rand(-12, 12) : rand(-12, 12);
      const y = rand(9, 17);
      const z = rand(-72, 8);
      positions[p] = x; positions[p + 1] = y; positions[p + 2] = z;
      positions[p + 3] = x - .08; positions[p + 4] = y - 1.15; positions[p + 5] = z + .18;
    }
  }
  rainGeo.attributes.position.needsUpdate = true;
}

function makeSunGlow() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 7, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,252,214,1)");
  grad.addColorStop(.22, "rgba(255,225,135,.9)");
  grad.addColorStop(1, "rgba(255,210,110,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: .34, depthWrite: false, fog: false, toneMapped: false }));
  sp.position.set(-23, 24, -118); sp.scale.set(28, 28, 1);
  return sp;
}
scene.add(makeSunGlow());

const mountainMat = [0x79a98e, 0x6d9c87, 0x8bb69a].map(color =>
  new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true })
);
for (let i = 0; i < 9; i++) {
  const h = 10 + Math.random() * 12;
  const mountain = new THREE.Mesh(new THREE.ConeGeometry(7 + Math.random() * 8, h, 5), mountainMat[i % mountainMat.length]);
  mountain.position.set(-42 + i * 10 + randSeed(i) * 4, h / 2 - 1.5, -124 - (i % 3) * 4);
  mountain.rotation.y = i * .7;
  scene.add(mountain);
}

function randSeed(n) { return ((Math.sin(n * 91.37) + 1) * .5); }

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  updateCameraLayout();
});

/* ================= 地面(滚动纹理) ================= */
function makeGroundTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d");
  // 偏暗的卡通草地，给角色和技能留出亮度层级
  const grass = g.createLinearGradient(0, 0, 512, 0);
  grass.addColorStop(0, "#3f7655"); grass.addColorStop(.5, "#568b61"); grass.addColorStop(1, "#3f7655");
  g.fillStyle = grass; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 180; i++) {
    g.fillStyle = Math.random() < .5 ? "rgba(56,138,73,.17)" : "rgba(213,244,151,.16)";
    const s = 3 + Math.random() * 8;
    g.fillRect(Math.random() * 512, Math.random() * 512, s, s * .55);
  }
  // 道路(中间 16/36 比例)
  const rl = 512 * (0.5 - ROAD_HALF / 36), rr = 512 * (0.5 + ROAD_HALF / 36);
  const road = g.createLinearGradient(rl, 0, rr, 0);
  road.addColorStop(0, "#827b70"); road.addColorStop(.18, "#a59c8c"); road.addColorStop(.5, "#bbb19e"); road.addColorStop(.82, "#a59c8c"); road.addColorStop(1, "#827b70");
  g.fillStyle = road; g.fillRect(rl, 0, rr - rl, 512);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = Math.random() < .5 ? "rgba(166,139,96,.12)" : "rgba(255,255,255,.19)";
    const s = 3 + Math.random() * 5;
    g.fillRect(rl + Math.random() * (rr - rl), Math.random() * 512, s, s);
  }
  // 道路软边与路缘高光
  g.fillStyle = "#315942"; g.fillRect(rl - 8, 0, 8, 512); g.fillRect(rr, 0, 8, 512);
  g.fillStyle = "#cdbb82"; g.fillRect(rl, 0, 5, 512); g.fillRect(rr - 5, 0, 5, 512);
  // 中央虚线
  g.fillStyle = "rgba(255,255,255,.78)";
  for (let y = 0; y < 512; y += 128) g.fillRect(250, y + 10, 12, 54);
  // 轻微前进箭头，增强速度感
  g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 7;
  for (let y = 92; y < 512; y += 180) {
    g.beginPath(); g.moveTo(226, y + 26); g.lineTo(256, y); g.lineTo(286, y + 26); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const groundTex = makeGroundTexture();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(36, 240),
  new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.z = -90;
scene.add(ground);

/* 路边树木(循环利用制造前进感) */
const trees = [];
function makeTree() {
  const g = new THREE.Group();
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.3, 16),
    new THREE.MeshBasicMaterial({ color: 0x315b45, transparent: true, opacity: 0.22, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(.25, .015, .2); shadow.scale.y = .58;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x8b5b3d, roughness: .9, flatShading: true }));
  trunk.position.y = 0.8;
  const leafMat = new THREE.MeshStandardMaterial({
    color: Math.random() < .5 ? 0x3f9b58 : 0x4bab65, roughness: .92, flatShading: true
  });
  const leafLow = new THREE.Mesh(new THREE.ConeGeometry(1.55, 2.8, 7), leafMat);
  leafLow.position.y = 2.55;
  const leafTop = new THREE.Mesh(new THREE.ConeGeometry(1.12, 2.35, 7), leafMat);
  leafTop.position.y = 3.75;
  leafTop.rotation.y = .38;
  g.add(shadow, trunk, leafLow, leafTop);
  return g;
}
for (let i = 0; i < 16; i++) {
  const t = makeTree();
  const side = i % 2 === 0 ? -1 : 1;
  t.position.set(side * (ROAD_HALF + 2.5 + Math.random() * 5), 0, -Math.random() * 130 + 8);
  const s = 0.7 + Math.random() * 0.7;
  t.scale.set(s, s, s);
  t.userData.phase = Math.random() * Math.PI * 2;
  scene.add(t);
  trees.push(t);
}

/* ================= 3D 士兵模型 (Q 版大头 chibi · 豆丁风) ================= */
/* ~2.5 头身：大头圆眼、短肢粗轮廓，贴近热门休閒射击可读性 */
const soldierGeo = {
  torso: new THREE.CapsuleGeometry(0.38, 0.22, 8, 14),
  belly: new THREE.SphereGeometry(0.36, 16, 12),
  limb: new THREE.CapsuleGeometry(0.13, 0.22, 6, 10),
  head: new THREE.SphereGeometry(0.52, 24, 18),
  helmet: new THREE.SphereGeometry(0.56, 20, 14, 0, Math.PI * 2, 0, Math.PI * .58),
  hand: new THREE.SphereGeometry(0.15, 12, 10),
  boot: new THREE.CapsuleGeometry(0.14, 0.08, 5, 10),
  cheek: new THREE.SphereGeometry(0.1, 12, 10),
  nose: new THREE.SphereGeometry(0.045, 10, 8),
  eye: new THREE.SphereGeometry(0.11, 14, 12),
  pupil: new THREE.SphereGeometry(0.06, 12, 10),
  shine: new THREE.SphereGeometry(0.028, 8, 6),
  brow: new THREE.CapsuleGeometry(0.018, 0.12, 3, 6),
  neck: new THREE.CapsuleGeometry(0.12, 0.05, 4, 8),
  gunBody: new THREE.CapsuleGeometry(0.09, 0.52, 5, 8),
  gunTip: new THREE.CapsuleGeometry(0.05, 0.22, 4, 8),
  cube: new THREE.BoxGeometry(1, 1, 1),
  shadow: new THREE.CircleGeometry(0.62, 22),
};
const sharedSoldierGeometries = new Set(Object.values(soldierGeo));
const soldierShadowMat = new THREE.MeshBasicMaterial({ color: 0x1a3048, transparent: true, opacity: 0.16, depthWrite: false });

/* 冷暖平衡 5 阶 ramp：电影感阴影 + 干净高光 */
function makeToonRamp() {
  const steps = [0x3a4558, 0x667288, 0xa8b2c0, 0xdde3ea, 0xffffff];
  const data = new Uint8Array(steps.length * 4);
  for (let i = 0; i < steps.length; i++) {
    const c = new THREE.Color(steps[i]);
    data[i * 4] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const TOON_RAMP = makeToonRamp();

function makeSoldier(mainColor, weaponId = "rifle", tier = 1) {
  const g = new THREE.Group();
  const rig = new THREE.Group();
  g.add(rig);
  const weapon = WEAPON_DEFS[weaponId] || WEAPON_DEFS.rifle;
  const mat = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: TOON_RAMP });
  const dark = new THREE.Color(mainColor).multiplyScalar(0.58).getHex();
  const mid = new THREE.Color(mainColor).lerp(new THREE.Color(0xffffff), .1).getHex();

  function part(geo, material, x, y, z, sx = 1, sy = 1, sz = 1, parent = rig) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  }

  const uniformMat = mat(mainColor);
  const midMat = mat(mid);
  const darkMat = mat(dark);
  const skinMat = mat(0xffd6b0);
  const blushMat = mat(0xff8fa0);
  const trouserMat = mat(0x1e2a38);
  const bootMat = mat(0x141c28);
  const gunMat = mat(0x2a3440);
  const accentMat = mat(weapon.color);
  const glowMat = new THREE.MeshBasicMaterial({ color: weapon.color, toneMapped: false });
  const hairMat = mat(0x3a3a48);
  const whiteMat = mat(0xffffff);
  const irisMat = mat(0x1a1a22);
  const outlineMat = mat(0x1a1420);

  const shadow = new THREE.Mesh(soldierGeo.shadow, soldierShadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .015; shadow.scale.set(1.1, .7, 1.1);
  g.add(shadow);

  /* 短腿厚靴 · chibi */
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-.18, .42, 0); legR.position.set(.18, .42, 0);
  rig.add(legL, legR);
  part(soldierGeo.limb, trouserMat, 0, -.14, 0, 1.2, .85, 1.2, legL);
  part(soldierGeo.limb, trouserMat, 0, -.14, 0, 1.2, .85, 1.2, legR);
  const bootL = part(soldierGeo.boot, bootMat, 0, -.32, -.06, 1.35, 1.0, 1.7, legL);
  const bootR = part(soldierGeo.boot, bootMat, 0, -.32, -.06, 1.35, 1.0, 1.7, legR);
  bootL.rotation.x = bootR.rotation.x = Math.PI / 2;

  /* 圆滚躯干 + 粗描边感肩块 */
  part(soldierGeo.belly, midMat, 0, .58, .04, 1.15, .9, 1.05);
  part(soldierGeo.torso, uniformMat, 0, .82, 0, 1.25, .95, 1.0);
  part(soldierGeo.cube, outlineMat, 0, .82, .28, .55, .7, .08);
  if (!lowPowerDevice) {
    part(soldierGeo.cube, darkMat, 0, .62, 0, .7, .12, .42);
    part(soldierGeo.hand, accentMat, 0, .9, -.32, .42, .42, .18);
  }
  for (const side of [-1, 1]) {
    part(soldierGeo.hand, uniformMat, side * .42, 1.0, 0, 1.15, .9, 1.05);
  }
  part(soldierGeo.neck, skinMat, 0, 1.05, 0, 1.15, .7, 1.15);

  /* 大头 · 豆丁脸 */
  const HEAD_Y = 1.42;
  const head = part(soldierGeo.head, skinMat, 0, HEAD_Y, -.02, 1.08, 1.05, 1.05);
  part(soldierGeo.helmet, hairMat, 0, HEAD_Y + .22, .04, 1.12, .92, 1.1);
  part(soldierGeo.cheek, hairMat, 0, HEAD_Y + .28, .08, 1.2, .55, .85);
  part(soldierGeo.cube, darkMat, 0, HEAD_Y - .02, -.38, .72, .08, .32);
  part(soldierGeo.hand, accentMat, 0, HEAD_Y + .12, -.4, .48, .32, .16);

  let face = null;
  if (!lowPowerDevice || tier >= 2) {
    for (const side of [-1, 1]) {
      part(soldierGeo.eye, whiteMat, side * .16, HEAD_Y + .02, -.42, 1.25, 1.35, .7);
      part(soldierGeo.pupil, irisMat, side * .16, HEAD_Y + .015, -.5, 1.15, 1.2, .6);
      part(soldierGeo.shine, whiteMat, side * .12, HEAD_Y + .05, -.54, 1.3, 1.3, 1);
      const brow = part(soldierGeo.brow, hairMat, side * .16, HEAD_Y + .16, -.44, 1.2, 1, 1);
      brow.rotation.z = side * -.22;
      part(soldierGeo.cheek, blushMat, side * .28, HEAD_Y - .12, -.3, .7, .45, .35);
    }
    part(soldierGeo.nose, skinMat, 0, HEAD_Y - .06, -.5, .7, .8, .8);
    face = part(new THREE.TorusGeometry(.09, .016, 5, 12, Math.PI * .7), hairMat, 0, HEAD_Y - .2, -.46, 1, .55, 1);
    face.rotation.z = Math.PI;
    for (const side of [-1, 1]) {
      part(soldierGeo.cheek, skinMat, side * .42, HEAD_Y, 0, .85, 1.0, .6);
    }
  }

  /* 军衔阶段：肩章 / 帽徽 / 光环 — 越打越潮 */
  if (tier >= 2) {
    for (const side of [-1, 1]) {
      part(soldierGeo.hand, accentMat, side * .48, 1.02, -.02, .95, .75, .95);
    }
    part(soldierGeo.hand, glowMat, 0, .92, -.34, .4, .4, .2);
  }
  if (tier >= 3) {
    part(soldierGeo.hand, accentMat, 0, HEAD_Y + .48, 0, .6, .45, .6);
    part(soldierGeo.cube, darkMat, 0, .78, .35, .6, .7, .08);
  }
  if (tier >= 4) {
    const aura = new THREE.Mesh(new THREE.RingGeometry(.52, .72, 28), new THREE.MeshBasicMaterial({
      color: weapon.color, transparent: true, opacity: .2, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    aura.rotation.x = -Math.PI / 2; aura.position.y = .03; g.add(aura); g.userData.aura = aura;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.38, .032, 8, 24), glowMat);
    halo.position.set(0, HEAD_Y + .55, 0); halo.rotation.x = Math.PI / 2; rig.add(halo); g.userData.halo = halo;
  }
  if (tier >= 5) {
    part(soldierGeo.hand, glowMat, 0, HEAD_Y + .58, 0, .9, .42, .9);
    const cape = part(soldierGeo.cube, accentMat, 0, .72, .42, .6, .75, .05);
    cape.rotation.x = -.2;
  }

  /* 短臂大手 · 抱枪 */
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-.48, .98, 0); armR.position.set(.48, .98, 0);
  const armBase = weaponId === "rocket" ? .75 : weaponId === "sniper" ? 1.0 : weaponId === "shotgun" ? .9 : .95;
  armL.rotation.x = armR.rotation.x = armBase;
  rig.add(armL, armR);
  part(soldierGeo.limb, uniformMat, 0, -.16, 0, 1.15, .85, 1.15, armL);
  part(soldierGeo.limb, uniformMat, 0, -.16, 0, 1.15, .85, 1.15, armR);
  part(soldierGeo.hand, skinMat, 0, -.34, 0, 1.35, 1.35, 1.35, armL);
  part(soldierGeo.hand, skinMat, 0, -.34, 0, 1.35, 1.35, 1.35, armR);

  /* 夸张大枪 · Q 版可读 */
  const gunRig = new THREE.Group();
  gunRig.position.set(.12, .88, -.52); rig.add(gunRig);
  const gunBody = (sx, sy, sz, z = 0) => part(soldierGeo.gunBody, gunMat, 0, 0, z, sx, sy, sz, gunRig);
  const gunAccent = (sx, sy, sz, z) => part(soldierGeo.gunTip, accentMat, 0, 0, z, sx, sy, sz, gunRig);
  if (weaponId === "smg") {
    gunBody(1.05, 1.05, .7); gunAccent(.95, .95, .65, -.4);
    part(soldierGeo.hand, darkMat, -.03, -.12, .05, .45, .75, .45, gunRig);
  } else if (weaponId === "shotgun") {
    gunBody(1.25, 1.1, 1.0, -.04); gunAccent(1.3, 1.2, .75, -.52);
  } else if (weaponId === "sniper") {
    gunBody(.85, .9, 1.35, -.08); gunAccent(1.0, .95, .85, -.66);
    part(soldierGeo.hand, accentMat, 0, .1, -.12, .45, .32, .55, gunRig);
    part(soldierGeo.hand, darkMat, -.03, -.12, .1, .42, .8, .42, gunRig);
  } else if (weaponId === "rocket") {
    gunBody(1.65, 1.45, 1.1, -.04); gunAccent(1.8, 1.6, .65, -.66);
    gunRig.position.y += .08;
  } else if (weaponId === "laser") {
    gunBody(1.1, 1.1, 1.0, -.04);
    part(soldierGeo.gunBody, accentMat, 0, 0, -.06, 1.05, 1.05, .95, gunRig);
    part(soldierGeo.hand, gunMat, 0, -.02, .25, .75, .65, .75, gunRig);
    part(soldierGeo.gunTip, glowMat, 0, .02, -.58, 1.05, 1.05, 1.05, gunRig);
  } else {
    gunBody(.95, .95, .9); gunAccent(.85, .85, .8, -.45);
    part(soldierGeo.hand, darkMat, -.03, -.12, .07, .42, .8, .42, gunRig);
  }

  g.userData.rig = rig;
  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  g.userData.gunRig = gunRig;
  g.userData.head = head;
  g.userData.face = face;
  g.userData.weaponId = weaponId;
  g.userData.tier = tier;
  g.userData.visualStage = tier;
  g.userData.armBase = armBase;
  g.userData.phase = Math.random() * Math.PI * 2;
  g.userData.recoil = 0;
  g.userData.hit = 0;
  g.userData.spawnT = 1;
  g.userData.mergeT = 0;
  const tintSet = new Set();
  g.traverse(o => { if (o.isMesh && o.material && o.material.isMeshToonMaterial) tintSet.add(o.material); });
  g.userData.tintMats = [...tintSet];
  rig.scale.setScalar(.12);
  return g;
}
function animateWalk(soldier, t, speed = 10, amp = 0.55, lean = 0) {
  if (!soldier?.userData) return;
  if (soldier.userData.mixer) {
    soldier.userData.mixer.update(1 / 60);
    soldier.rotation.z += (-lean * .12 - soldier.rotation.z) * .18;
    return;
  }
  const ud = soldier.userData;
  if (!ud.legs || !ud.arms || !ud.gunRig || !ud.rig) return;
  const p = t * speed + (ud.phase || 0);
  ud.legs[0].rotation.x =  Math.sin(p) * amp;
  ud.legs[1].rotation.x = -Math.sin(p) * amp;
  ud.arms[0].rotation.x = (ud.armBase || 0) - Math.sin(p) * .09 - (ud.recoil || 0) * .2;
  ud.arms[1].rotation.x = (ud.armBase || 0) + Math.sin(p) * .09 - (ud.recoil || 0) * .2;
  ud.gunRig.position.z = -.55 + (ud.recoil || 0) * .12;
  ud.rig.position.y = .035 + Math.abs(Math.sin(p)) * .075;
  ud.rig.rotation.x = Math.sin(p * 2) * .018;
  ud.rig.rotation.z = -lean * .16 + Math.sin(p * 3) * (ud.hit || 0) * .08;
  ud.recoil = (ud.recoil || 0) * .56;
  ud.hit = (ud.hit || 0) * .72;
  // 受击闪白:emissive 随 ud.hit 衰减(命中瞬间置 1)。hero 在 hurtT 分支随后会被红色染色覆盖
  if (ud.tintMats) {
    const h = ud.hit > .05 ? Math.min(1, ud.hit) * .85 : 0;
    for (const m of ud.tintMats) m.emissive.setRGB(h, h, h);
  }
  if (ud.aura) {
    ud.aura.rotation.z += .02;
    if (ud.aura.material) ud.aura.material.opacity = .18 + Math.sin(t * 4 + ud.phase) * .08;
  }
  if (ud.halo) {
    ud.halo.rotation.z += .045;
    ud.halo.position.y = 1.97 + Math.sin(t * 4 + ud.phase) * .04;
  }
  if (ud.head && !ud.mixer) {
    ud.head.rotation.y = Math.sin(t * 1.2 + ud.phase) * .04;
    ud.head.position.y = 1.42 + Math.sin(t * 2.4 + ud.phase) * .015;
  }
  if (ud.mergeT > 0) {
    ud.mergeT = Math.max(0, ud.mergeT - .035);
    ud.rig.rotation.y += .22;
    const pulse = 1 + Math.sin((1 - ud.mergeT) * Math.PI * 4) * ud.mergeT * .22;
    ud.rig.scale.setScalar(pulse);
  }

  if (ud.spawnT > 0 && ud.mergeT <= 0) {
    ud.spawnT = Math.max(0, ud.spawnT - .065);
    const q = 1 - ud.spawnT;
    const k = 1 + 2.70158 * Math.pow(q - 1, 3) + 1.70158 * Math.pow(q - 1, 2);
    ud.rig.scale.setScalar(Math.max(.08, k));
  } else if (ud.mergeT <= 0) { ud.rig.scale.setScalar(1); ud.rig.rotation.y *= .82; }
}
function tintSoldier(soldier, hex) {
  soldier.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(hex); });
}

/* 菲涅尔边缘光:仅对英雄/Boss 的卡通材质注入,制造高级描边感。用 vNormal.z 近似,稳健且便宜 */
const RIM_FRESNEL = quality.rimFresnel;
function applyRimFresnel(mesh, rimColor = 0x8fd6ff, power = 2.4, strength = .85) {
  if (!RIM_FRESNEL) return;
  mesh.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.isMeshToonMaterial || o.material.userData.rim) return;
    const m = o.material;
    m.userData.rim = true;
    m.customProgramCacheKey = () => "rimFresnel";
    m.onBeforeCompile = shader => {
      shader.uniforms.uRimColor = { value: new THREE.Color(rimColor) };
      shader.uniforms.uRimPower = { value: power };
      shader.uniforms.uRimStrength = { value: strength };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;")
        .replace("#include <dithering_fragment>", "float rimF = pow(1.0 - abs(normalize(vNormal).z), uRimPower);\ngl_FragColor.rgb += uRimColor * rimF * uRimStrength;\n#include <dithering_fragment>");
    };
    m.needsUpdate = true;
  });
}

/* ================= 道具箱 ================= */
/** 第一关 Boss 前：只掉攻速/攻击。之后可夹少量治疗等，仍以枪成长为主。 */
const REWARDS_EARLY = [
  { type: "firerate", label: "攻速+", color: "#4fc3f7", weight: 55 },
  { type: "damage",   label: "攻击+", color: "#ff8a65", weight: 45 },
];
const REWARDS_LATE = [
  { type: "firerate", label: "攻速+", color: "#4fc3f7", weight: 36 },
  { type: "damage",   label: "攻击+", color: "#ff8a65", weight: 34 },
  { type: "heal",     label: "医疗", color: "#ff6685", weight: 14, heal: 22 },
  { type: "shield",   label: "护盾", color: "#4dd0e1", weight: 10 },
  { type: "xp",       label: "经验", color: "#8bc34a", weight: 6, xp: 28 },
];
function pickReward() {
  const pool = bossCount < 1 ? REWARDS_EARLY : REWARDS_LATE;
  const total = pool.reduce((s, r) => s + r.weight, 0);
  let n = Math.random() * total;
  let reward = pool[0];
  for (const r of pool) { n -= r.weight; if (n <= 0) { reward = r; break; } }
  return { ...reward };
}

function drawCrateFace(g, crate) {
  g.clearRect(0, 0, 256, 256);
  const wood = g.createLinearGradient(0, 0, 256, 256);
  wood.addColorStop(0, "#d89b58"); wood.addColorStop(.5, "#a96835"); wood.addColorStop(1, "#754326");
  g.fillStyle = wood; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "#5b331f"; g.lineWidth = 16; g.strokeRect(8, 8, 240, 240);
  g.strokeStyle = "rgba(255,226,166,.35)"; g.lineWidth = 5; g.strokeRect(19, 19, 218, 218);
  g.strokeStyle = "#6b3d25"; g.lineWidth = 7;
  g.beginPath();
  g.moveTo(17, 17); g.lineTo(239, 239);
  g.moveTo(239, 17); g.lineTo(17, 239);
  g.stroke();
  g.fillStyle = "rgba(20,25,34,.72)"; g.fillRect(38, 42, 180, 103);
  // 数字
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "900 92px Arial";
  g.strokeStyle = "rgba(0,0,0,.72)"; g.lineWidth = 9; g.strokeText(crate.count, 128, 96);
  g.fillStyle = "#fff7df"; g.fillText(crate.count, 128, 96);
  // 奖励标签
  g.fillStyle = "rgba(20,25,34,.78)"; g.fillRect(27, 164, 202, 59);
  g.font = "900 42px Microsoft YaHei";
  g.strokeStyle = "rgba(0,0,0,.75)"; g.lineWidth = 7; g.strokeText(crate.reward.label, 128, 194);
  g.fillStyle = crate.reward.color; g.fillText(crate.reward.label, 128, 194);
}

function makeCrate(x, z) {
  const reward = pickReward();
  const baseCount = 5 + Math.floor(Math.random() * 11);   // 5~15 次
  const count = Math.max(1, Math.ceil(baseCount * (1 - skillLevel(player.skills, "supply") * .08)));
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const g2d = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.0, 2.0),
    new THREE.MeshStandardMaterial({ map: tex, roughness: .72, metalness: .02 })
  );
  mesh.position.set(x, 1.0, z);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 28),
    new THREE.MeshBasicMaterial({ color: reward.color, transparent: true, opacity: .2, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  glow.rotation.x = -Math.PI / 2; glow.position.y = -1.0;
  mesh.add(glow);
  let weaponIcon = null;
  if (reward.type === "weapon") {
    weaponIcon = new THREE.Group();
    const iconMat = new THREE.MeshStandardMaterial({ color: reward.colorHex, emissive: reward.colorHex, emissiveIntensity: .45, roughness: .35 });
    const darkIconMat = new THREE.MeshStandardMaterial({ color: 0x263441, metalness: .35, roughness: .4 });
    const body = new THREE.Mesh(soldierGeo.cube, iconMat); body.scale.set(.28, .22, .82); weaponIcon.add(body);
    const barrel = new THREE.Mesh(soldierGeo.cube, darkIconMat); barrel.position.z = -.62; barrel.scale.set(.11, .11, .45); weaponIcon.add(barrel);
    if (reward.weaponId === "rocket") body.scale.set(.45, .4, .92);
    if (reward.weaponId === "shotgun") body.scale.x = .4;
    if (reward.weaponId === "sniper") barrel.scale.z = .72;
    weaponIcon.position.y = 1.35; weaponIcon.rotation.x = -.25; mesh.add(weaponIcon);
  }
  scene.add(mesh);
  const crate = { mesh, tex, g2d, count, reward, pulse: 0, phase: Math.random() * Math.PI * 2, glow, weaponIcon };
  drawCrateFace(g2d, crate);
  tex.needsUpdate = true;
  return crate;
}

function disposeCrate(crate) {
  scene.remove(crate.mesh);
  const materials = new Set(), geometries = new Set();
  crate.mesh.traverse(o => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m));
    if (o.geometry && !sharedSoldierGeometries.has(o.geometry)) geometries.add(o.geometry);
  });
  materials.forEach(m => { if (m.map && m.map !== crate.tex) m.map.dispose(); m.dispose(); });
  geometries.forEach(g => g.dispose());
  crate.tex.dispose();
}

/* ================= 通用资源 ================= */
const bulletGeo = new THREE.CapsuleGeometry(0.10, 0.36, 2, 5);
bulletGeo.rotateX(Math.PI / 2);
const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8, toneMapped: false });
const droneBulletMat = new THREE.MeshBasicMaterial({ color: 0x75ecff, toneMapped: false });
const weaponBulletMats = {};
function bulletMaterial(weaponId) {
  if (weaponBulletMats[weaponId]) return weaponBulletMats[weaponId];
  const def = WEAPON_DEFS[weaponId] || WEAPON_DEFS.rifle;
  return weaponBulletMats[weaponId] = new THREE.MeshBasicMaterial({ color: def.color, toneMapped: false });
}

/* 弹道轨迹:锥形渐隐拖尾(顶点色从亮黄渐变到黑,配合加法混合实现发光淡出) */
const TRAIL_LEN = 3.2;
const trailGeo = new THREE.ConeGeometry(0.13, TRAIL_LEN, 6);
trailGeo.rotateX(Math.PI / 2);                    // 锥尖转向 +z(子弹后方)
trailGeo.translate(0, 0, TRAIL_LEN / 2 + 0.35);   // 整体挪到弹体尾部
{
  const posAttr = trailGeo.attributes.position;
  const cols = [];
  for (let i = 0; i < posAttr.count; i++) {
    const f = 1 - (posAttr.getZ(i) - 0.35) / TRAIL_LEN;   // 靠近弹头亮、尾端暗
    cols.push(f, f * 0.82, f * 0.18);
  }
  trailGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
}
const trailMat = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, toneMapped: false,
});

/* 连射弹道残影 + 枪口火光(机枪扫射效果):共享几何/材质,靠缩放渐隐,限量防卡顿 */
const segGeo = new THREE.BoxGeometry(1, 1, 1);
const segMat = new THREE.MeshBasicMaterial({ color: 0xffbe55, transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const muzzleMat = new THREE.SpriteMaterial({
  map: null,   // 启动后指向 softGlowTex(定义顺序在下方,首帧前已赋值)
  color: 0xffe783, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, toneMapped: false,
});
const TRAIL_FX_CAP = quality.level === "low" ? 160 : mobileDevice ? 280 : 500;
const trailSegPool = new ObjectPool(
  () => new THREE.Mesh(segGeo, segMat),
  mesh => { scene.remove(mesh); mesh.visible = false; mesh.scale.set(1, 1, 1); },
  quality.level === "low" ? 40 : 80,
);
const muzzleSpritePool = new ObjectPool(
  () => new THREE.Sprite(muzzleMat),
  sprite => { scene.remove(sprite); sprite.visible = false; sprite.scale.set(1, 1, 1); },
  24,
);
function addTrailSeg(x0, z0, x1, z1) {
  if (trailFx.length >= TRAIL_FX_CAP) return;
  const dx = x1 - x0, dz = z1 - z0;
  const m = trailSegPool.acquire();
  m.visible = true;
  m.position.set((x0 + x1) / 2, 1.0, (z0 + z1) / 2);
  m.rotation.y = Math.atan2(dx, dz);
  m.scale.set(0.14, 0.14, Math.hypot(dx, dz) + 0.1);
  scene.add(m);
  trailFx.push({ mesh: m, life: 10, maxLife: 10, w: 0.14, pooled: "trail" });
}
function addMuzzleFlash(x, z) {
  if (trailFx.length >= TRAIL_FX_CAP) return;
  const m = muzzleSpritePool.acquire();
  m.visible = true;
  m.material = muzzleMat;
  m.position.set(x, 1.0, z);
  trailFx.push({ mesh: m, life: 5, maxLife: 5, w: rand(.9, 1.3), flash: true, pooled: "muzzle" });
  scene.add(m);
}
const particleGeo = new THREE.TetrahedronGeometry(0.19, 0);
const pMatCache = {};
function pMat(color) { return pMatCache[color] || (pMatCache[color] = new THREE.MeshBasicMaterial({ color, toneMapped: false })); }
const particleMeshPool = new ObjectPool(
  () => new THREE.Mesh(particleGeo, pMat(0xffffff)),
  mesh => {
    scene.remove(mesh);
    mesh.visible = false;
    mesh.scale.set(1, 1, 1);
    mesh.rotation.set(0, 0, 0);
  },
  quality.level === "low" ? 48 : 96,
);

/* ============ 程序化渐变精灵贴图(一次生成,全局共享):软光晕/烟雾/软边冲击环 ============ */
function makeRadialTex(size, stops) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) grad.addColorStop(p, col);
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const softGlowTex = makeRadialTex(64, [[0, "rgba(255,255,255,1)"], [.35, "rgba(255,255,255,.85)"], [1, "rgba(255,255,255,0)"]]);
muzzleMat.map = softGlowTex;   // muzzleMat 定义在前,此处回填贴图
const smokeTex = makeRadialTex(96, [[0, "rgba(255,255,255,.9)"], [.45, "rgba(255,255,255,.5)"], [.8, "rgba(255,255,255,.14)"], [1, "rgba(255,255,255,0)"]]);
const ringTex = makeRadialTex(128, [[0, "rgba(255,255,255,0)"], [.62, "rgba(255,255,255,0)"], [.74, "rgba(255,255,255,1)"], [.88, "rgba(255,255,255,.55)"], [1, "rgba(255,255,255,0)"]]);
const fxPlaneGeo = new THREE.PlaneGeometry(1, 1);

/* 火花:加法混合光点,强重力快衰减,复用粒子更新循环 */
const sparkMatCache = {};
function sparkMat(color) {
  return sparkMatCache[color] || (sparkMatCache[color] = new THREE.SpriteMaterial({
    map: softGlowTex, color, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
}
const SPARK_CAP = quality.level === "low" ? 60 : mobileDevice ? 110 : 210;
let sparks = [];
const sparkSpritePool = new ObjectPool(
  () => new THREE.Sprite(sparkMat(0xffffff)),
  sprite => { scene.remove(sprite); sprite.visible = false; sprite.scale.set(1, 1, 1); },
  quality.level === "low" ? 24 : 48,
);
/* 光晕残影:复用 trailFx 生命周期(5-6 帧缩小消失),用于弹道拖尾与打击爆闪 */
function addGlowGhost(x, y, z, color, w = .9) {
  if (trailFx.length >= TRAIL_FX_CAP) return;
  const m = sparkSpritePool.acquire();
  m.visible = true;
  m.material = sparkMat(color);
  m.position.set(x, y, z);
  trailFx.push({ mesh: m, life: 6, maxLife: 6, w, flash: true, pooled: "spark" });
  scene.add(m);
}
function addSparks(x, y, z, color, n = 10, spd = .3) {
  for (let i = 0; i < n && sparks.length < SPARK_CAP; i++) {
    const s = sparkSpritePool.acquire();
    s.visible = true;
    s.material = sparkMat(color);
    s.position.set(x, y, z);
    const sc = rand(.16, .4);
    s.scale.set(sc, sc, 1);
    sparks.push({
      mesh: s,
      vx: rand(-spd, spd), vy: rand(.08, spd * 1.9), vz: rand(-spd, spd),
      life: rand(12, 26),
    });
    scene.add(s);
  }
}
/* 烟雾:普通混合灰烟,膨胀+上升+淡出,低端机禁用 */
const smokeMatProto = new THREE.SpriteMaterial({
  map: smokeTex, color: 0x9aa4ad, transparent: true, depthWrite: false, opacity: .34, toneMapped: false,
});
const SMOKE_CAP = quality.level === "low" ? 12 : mobileDevice ? 22 : 44;
let smokes = [];
const smokeSpritePool = new ObjectPool(
  () => {
    const mat = smokeMatProto.clone();
    const s = new THREE.Sprite(mat);
    s.userData.mat = mat;
    return s;
  },
  sprite => {
    scene.remove(sprite);
    sprite.visible = false;
    sprite.scale.set(1, 1, 1);
    if (sprite.userData.mat) sprite.userData.mat.opacity = .34;
  },
  12,
);
function addSmoke(x, y, z, n = 4, size = 1) {
  if (!quality.smoke) return;
  for (let i = 0; i < n && smokes.length < SMOKE_CAP; i++) {
    const s = smokeSpritePool.acquire();
    const m = s.userData.mat;
    m.rotation = rand(0, Math.PI * 2);
    m.opacity = .34;
    s.visible = true;
    s.position.set(x + rand(-.4, .4), y + rand(0, .5), z + rand(-.4, .4));
    const sc = rand(.8, 1.4) * size;
    s.scale.set(sc, sc, 1);
    smokes.push({ mesh: s, mat: m, vy: rand(.012, .03), grow: rand(1.018, 1.03), life: rand(30, 52), maxLife: 52 });
    scene.add(s);
  }
}
let impactFx = [];
const IMPACT_CAP = quality.level === "low" ? 12 : mobileDevice ? 20 : 34;
const impactRingPool = new ObjectPool(
  () => {
    const material = new THREE.MeshBasicMaterial({
      map: ringTex, color: 0xffffff, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const mesh = new THREE.Mesh(fxPlaneGeo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.material = material;
    return mesh;
  },
  mesh => {
    scene.remove(mesh);
    mesh.visible = false;
    mesh.scale.set(1, 1, 1);
    mesh.userData.material.opacity = .8;
  },
  16,
);
function addImpactRing(x, y, z, color, size = 1.2, life = 22) {
  if (impactFx.length >= IMPACT_CAP) return;
  const mesh = impactRingPool.acquire();
  const material = mesh.userData.material;
  material.color.set(color);
  material.opacity = .8;
  mesh.visible = true;
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(.2);
  scene.add(mesh);
  impactFx.push({ mesh, material, life, maxLife: life, size: size * 1.6 });
}
/* 大命中双重冲击波:一道主环 + 一道更快更细的先导环 */
function addShockwave(x, y, z, color, size = 2.4) {
  addImpactRing(x, y, z, color, size, 26);
  addImpactRing(x, y + .02, z, 0xffffff, size * 1.35, 14);
}

/* 护盾 */
const shieldMesh = new THREE.Mesh(
  new THREE.SphereGeometry(2.4, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0x66e7ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
);
shieldMesh.visible = false;
scene.add(shieldMesh);

/* ================= 游戏状态 ================= */
let running = false;
let frame = 0, score = 0, kills = 0, distance = 0, worldSpeed = 0.25;

const player = {
  x: 0, tx: null, vx: 0, lastX: 0,
  soldiers: [],          // {id, mesh, weaponId, tier, armor, maxArmor, fireCd}
  damageBonus: 0, fireRateMul: 1,
  shield: 0, spreadT: 0, slowT: 0, hurtT: 0, moveSlowT: 0,
  xp: 0, level: 1, skills: {}, pendingPromotion: false, prestigeReady: false,
  shieldKillProgress: 0, airstrikeKillProgress: 0,
};
let nextUnitId = 1;
let nextEnemyId = 1;
let bullets = [];        // {mesh, vx, dmg, px, pz}
let trailFx = [];        // 弹道残影/枪口火光 {mesh, life, maxLife, w, flash}
let enemies = [];        // {mesh, hp, maxHp, speed, big, hpBar}
let crates = [];
let rewardCores = [];
let enemyAimHazards = [];
let particles = [];      // {mesh, vx, vy, vz, life}
let floatTexts = [];     // {sprite, life}
let playerMines = [];    // 感应地雷 {mesh, x, z, life, dmg, radius}
let salvoCd = 0;         // 齐射支援冷却（帧）
let spawnEnemyCd = 110, spawnCrateCd = 150;
let gates = [], spawnGateCd = 500;          // 选择门
let traps = [], spawnTrapCd = 320;           // 小范围陷阱
let drones = [];
let combo = 0, comboTimer = 0, critT = 0;   // 连杀 / 暴击模式
let shake = 0;                              // 摄像机 trauma(0-1),渲染时取平方更有冲击感
let cameraFollowX = 0, screenFlashT = 0;
let hitStopT = 0;                           // 卡帧计数:>0 时主循环冻结模拟,只渲染
let boss = null, bossCount = 0, bossWarning = false;
let killsAtLastBoss = 0;
let lastBossClearDistance = 0; // 无尽模式：满级后用路程间隔防连环刷
let bossSummonCd = 0;      // 预警后入场倒计时（帧）
let bossHazards = [];
let bossProjectiles = [];
let eventIndex = 0, nextEventAt = 180, eventHordeT = 0;
const screenFlashEl = document.getElementById("screenFlash");
const speedFxEl = document.getElementById("speedFx");
function addShake(a) {
  // Soft cap + diminishing returns so rocket volleys / multi-hits cannot stack into nausea.
  const room = Math.max(0, 0.38 - shake);
  shake = Math.min(0.38, shake + a * (0.45 + room * 1.4));
  if (a >= .28) globalThis.soldierRushHaptic?.(a >= .4);
}
function triggerHitStop(frames) {
  hitStopT = Math.max(hitStopT, frames);
}

function applyRankInsignia(mesh, rank) {
  const rig = mesh.userData.rig;
  if (!rig) return;
  const group = new THREE.Group();
  group.position.set(-.26, .95, -.38);
  const badgeMat = new THREE.MeshToonMaterial({
    color: rank >= 12 ? 0xffd66b : 0xc7e7ff,
    gradientMap: TOON_RAMP,
    emissive: rank >= 12 ? 0x7a3d00 : 0x183e62,
    emissiveIntensity: .4,
  });
  const bars = 1 + ((rank - 1) % 4);
  for (let i = 0; i < bars; i++) {
    const bar = new THREE.Mesh(soldierGeo.hand, badgeMat);
    bar.scale.set(.22, .14, .18);
    bar.position.set(i * .08, Math.floor((rank - 1) / 4) * .06, 0);
    group.add(bar);
  }
  if (rank >= 9) {
    const star = new THREE.Mesh(soldierGeo.hand, badgeMat);
    star.scale.set(.28, .28, .28);
    star.position.set(.12, .1, 0);
    group.add(star);
  }
  rig.add(group);
  mesh.userData.rankInsignia = group;
}
function flashScreen(color = "#ffffff", strength = .35) {
  screenFlashT = Math.max(screenFlashT, strength * 12);
  if (!screenFlashEl) return;
  screenFlashEl.style.background = color;
  screenFlashEl.style.opacity = String(Math.min(.42, screenFlashT / 12));
}
function flashVital(el) {
  if (!el) return;
  el.classList.remove("vital-hit");
  void el.offsetWidth;   // 强制回流以重启动画
  el.classList.add("vital-hit");
}

/* ================= 输入 ================= */
const keys = {};
window.addEventListener("keydown", e => {
  if (player.pendingPromotion && ["1", "2", "3"].includes(e.key)) {
    e.preventDefault();
    selectSkill(Number(e.key) - 1);
    return;
  }
  keys[e.key.toLowerCase()] = true;
  if ((e.key === " " || e.key === "Enter") && !running) { e.preventDefault(); startGame(); }
});
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);
function clearInputState() {
  Object.keys(keys).forEach(k => keys[k] = false);
  if (activePointerId !== null) {
    try { cvEl.releasePointerCapture?.(activePointerId); } catch (_) {}
  }
  activePointerId = null;
  player.tx = null;
}
window.addEventListener("blur", clearInputState);
document.addEventListener("visibilitychange", () => { if (document.hidden) { clearInputState(); accumulator = 0; } });

function pointerX(e) {
  const rect = cvEl.getBoundingClientRect();
  const nx = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  return (nx - 0.5) * 2 * (ROAD_HALF + 1);
}
const cvEl = canvasEl;
let activePointerId = null;
cvEl.addEventListener("pointerdown", e => {
  if (!running || (activePointerId !== null && activePointerId !== e.pointerId)) return;
  activePointerId = e.pointerId;
  cvEl.setPointerCapture?.(e.pointerId);
  player.tx = pointerX(e);
  e.preventDefault();
});
cvEl.addEventListener("pointermove", e => {
  if (e.pointerId !== activePointerId) return;
  player.tx = pointerX(e);
  e.preventDefault();
});
function releasePointer(e) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
  player.tx = pointerX(e); // 保留松手位置，快速滑动也会继续移动到目标
}
function cancelPointer(e) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;
}
cvEl.addEventListener("pointerup", releasePointer);
cvEl.addEventListener("pointercancel", cancelPointer);
cvEl.addEventListener("lostpointercapture", cancelPointer);

/* ================= 工具 ================= */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function addParticles(x, y, z, color, n = 10, spd = 0.22) {
  const cap = quality.particleCap;
  const room = Math.max(0, cap - particles.length);
  // Hard clamp burst size — debris was reading as permanent screen confetti.
  const count = Math.min(n, room, quality.level === "low" ? 4 : mobileDevice ? 6 : 8);
  for (let i = 0; i < count; i++) {
    const m = particleMeshPool.acquire();
    m.visible = true;
    m.material = pMat(color);
    m.position.set(x, y, z);
    m.scale.setScalar(rand(0.45, 0.95));
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    particles.push({
      mesh: m,
      vx: rand(-spd * .8, spd * .8), vy: rand(0.08, spd * 1.1), vz: rand(-spd * .8, spd * .8),
      rx: rand(-.2, .2), ry: rand(-.2, .2), rz: rand(-.2, .2),
      life: rand(8, 14),
    });
    scene.add(m);
  }
}

const FLOAT_TEXT_CAP = quality.level === "low" ? 10 : mobileDevice ? 16 : 28;
const floatTextCanvasPool = [];
function acquireFloatCanvas() {
  return floatTextCanvasPool.pop() || (() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    return c;
  })();
}
function releaseFloatCanvas(c) {
  if (floatTextCanvasPool.length < 24) floatTextCanvasPool.push(c);
}

function makeTextSprite(text, color, size = 4.6) {
  const c = acquireFloatCanvas();
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  g.font = "900 40px Microsoft YaHei, PingFang SC, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = color; g.shadowBlur = 12;
  g.strokeStyle = "rgba(10,22,40,.92)"; g.lineWidth = 10;
  g.strokeText(text, 128, 32);
  g.shadowBlur = 0;
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  g.globalCompositeOperation = "lighter";
  g.fillStyle = "rgba(255,255,255,.35)";
  g.fillText(text, 128, 32);
  g.globalCompositeOperation = "source-over";
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  sprite.scale.set(size, size * 0.25, 1);
  sprite.userData.canvas = c;
  return sprite;
}

function addFloatText(x, y, z, text, color, size = 4.6) {
  if (floatTexts.length >= FLOAT_TEXT_CAP) {
    const oldest = floatTexts.shift();
    if (oldest) releaseFloatText(oldest);
  }
  const sprite = makeTextSprite(text, color, size);
  sprite.position.set(x, y, z);
  scene.add(sprite);
  const baseScale = { x: sprite.scale.x, y: sprite.scale.y };
  sprite.scale.multiplyScalar(.12);
  floatTexts.push({ sprite, life: 60, maxLife: 60, baseScale });
}

function releaseFloatText(ft) {
  scene.remove(ft.sprite);
  const map = ft.sprite.material.map;
  const canvas = ft.sprite.userData.canvas;
  ft.sprite.material.dispose();
  if (map) map.dispose();
  if (canvas) releaseFloatCanvas(canvas);
}

/* ================= 单人进化 ================= */
function squadPositions() {
  return player.soldiers.length ? [{ x: player.x, z: PLAYER_Z }] : [];
}
function squadHalfWidth() { return 0; }

function disposeSoldierMesh(mesh) {
  const materials = new Set(), geometries = new Set();
  mesh.traverse(o => {
    if (o.material && o.material !== soldierShadowMat) {
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(m => materials.add(m));
    }
    if (o.geometry && !sharedSoldierGeometries.has(o.geometry)) geometries.add(o.geometry);
  });
  materials.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
  geometries.forEach(g => g.dispose());
}

function unitPower(unit) {
  const shots = inheritedShotDirections().length;
  const interval = effectiveFireInterval();
  const critChance = Math.min(.75, skillLevel(player.skills, "critical") * .06 + (critT > 0 ? .35 : 0));
  return standardProjectileDamage() * shots * 60 / interval * (1 + critChance);
}
function heroUnit() { return player.soldiers[0] || null; }
function totalPower() { const hero = heroUnit(); return hero ? unitPower(hero) : 0; }

function standardProjectileDamage() {
  const shots = inheritedShotDirections().length;
  return projectileDamage(
    weaponStageForRank(player.level),
    shots,
    player.damageBonus,
    skillLevel(player.skills, "firepower") * .1 + .05,
    saveData.medals * .04,
  );
}

function inheritedShotDirections() {
  // Single rifle: mostly center shot; rank / split only gently widens coverage.
  const stage = weaponStageForRank(player.level);
  const dirs = [0];
  if (stage >= 3) dirs.push(-.08, .08);
  if (stage >= 5) dirs.push(-.14, .14);
  const split = skillLevel(player.skills, "split");
  for (let i = 1; i <= Math.min(split, 2); i++) dirs.push(-.05 * i, .05 * i);
  if (player.spreadT > 0) dirs.push(-.18, .18);
  return [...new Set(dirs.map(value => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
}

function effectiveBaseFireRate() {
  // Use the CURRENT weapon cadence only. Inheriting min(smg, shotgun…) made shotgun
  // fire as fast as SMG and turned stage-3 into a lawnmower.
  const weaponId = weaponForRank(player.level);
  return (WEAPON_DEFS[weaponId] || WEAPON_DEFS.rifle).fireRate;
}

function effectiveFireInterval() {
  return fireInterval(effectiveBaseFireRate(), player.fireRateMul, skillLevel(player.skills, "reload"));
}

function heroMaxArmor(rank = player.level) {
  return 24 + rank * 3 + 5 + saveData.medals * 3 + skillLevel(player.skills, "armor") * 8;
}

function enforceSingleHero() {
  if (player.soldiers.length <= 1) return;
  const [hero, ...extras] = player.soldiers;
  extras.forEach(removePlayerUnit);
  player.soldiers = hero ? [hero] : [];
}

function createPlayerUnit(weaponId = "rifle", rank = player.level, x = player.x, z = PLAYER_Z) {
  const def = WEAPON_DEFS[weaponId] || WEAPON_DEFS.rifle;
  const visualStage = RANK_DEFS[Math.max(0, rank - 1)].visualStage + 1;
  const weaponStage = weaponStageForRank(rank);
  // 豆丁军服：海军蓝 → 青钢 → 司令金（Q 版高饱和）
  const HERO_TIER_COLORS = [0x2a5a8a, 0x3470a8, 0x4a8cc4, 0x68a8d8, 0xe0b84a];
  const color = HERO_TIER_COLORS[clamp(visualStage - 1, 0, 4)];
  const mesh = makeSoldier(color, weaponId, visualStage);
  applyRankInsignia(mesh, rank);
  applyRimFresnel(mesh, 0xffe8a0, 2.1, .95);
  mesh.scale.setScalar(1.2 + visualStage * .05);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const maxArmor = heroMaxArmor(rank);
  const maxHealth = heroMaxHealth(rank);
  return { id: nextUnitId++, mesh, weaponId, tier: weaponStage, rank, health: maxHealth, maxHealth, armor: maxArmor, maxArmor, fireCd: Math.random() * effectiveFireInterval() };
}

function removePlayerUnit(unit) {
  scene.remove(unit.mesh);
  if (!unit.mesh.userData.externalAsset) disposeSoldierMesh(unit.mesh);
}

function createHero() {
  const unit = createPlayerUnit(weaponForRank(player.level), player.level);
  player.soldiers = [unit];
  void tryAttachHeroGLB(unit);
  return unit;
}

let heroModelChecked = false;
let heroModelAvailable = false;
async function tryAttachHeroGLB(unit) {
  try {
    if (!heroModelChecked) {
      heroModelChecked = true;
      heroModelAvailable = (await fetch("./assets/models/hero.glb", { method: "HEAD" })).ok;
    }
    if (!heroModelAvailable) return;
    const asset = await assetManager.instantiateAnimated("./assets/models/hero.glb");
    if (heroUnit()?.id !== unit.id) return;
    const oldMesh = unit.mesh;
    asset.root.position.copy(oldMesh.position);
    asset.root.rotation.copy(oldMesh.rotation);
    asset.root.scale.setScalar(1.08);
    asset.root.userData.mixer = asset.mixer;
    asset.root.userData.externalAsset = true;
    const runClip = asset.clips.get("run") || asset.clips.get("idle");
    if (runClip) asset.mixer.clipAction(runClip).play();
    scene.remove(oldMesh);
    disposeSoldierMesh(oldMesh);
    unit.mesh = asset.root;
    scene.add(asset.root);
  } catch {
    heroModelAvailable = false;
  }
}

function evolveHero(nextRank = player.level) {
  const previous = heroUnit();
  if (!previous) return false;
  const position = previous.mesh.position.clone();
  const armorRatio = previous.maxArmor > 0 ? previous.armor / previous.maxArmor : 1;
  const healthRatio = previous.maxHealth > 0 ? previous.health / previous.maxHealth : 1;
  const previousFireCd = previous.fireCd;
  const previousWeapon = previous.weaponId;
  removePlayerUnit(previous);
  const hero = createPlayerUnit(weaponForRank(nextRank), nextRank, position.x, position.z);
  hero.armor = Math.max(1, Math.round(hero.maxArmor * armorRatio));
  hero.health = Math.min(hero.maxHealth, Math.round(hero.maxHealth * healthRatio + hero.maxHealth * .1));
  hero.fireCd = Math.min(previousFireCd, effectiveFireInterval());
  hero.mesh.userData.mergeT = 1;
  player.soldiers = [hero];
  void tryAttachHeroGLB(hero);
  const def = WEAPON_DEFS[hero.weaponId];
  addParticles(position.x, 1.5, position.z, def.css, mobileDevice ? 34 : 58, .42);
  addImpactRing(position.x, .08, position.z, def.color, 5 + hero.tier);
  const text = previousWeapon === hero.weaponId ? `${rankName(nextRank)} 晋升!` : `${rankName(nextRank)} · ${def.label} 进化!`;
  addFloatText(position.x, 4.4, position.z, text, def.css, 6.2);
  addShake(.35); flashScreen(def.css, .42);
  // 晋升后火力阶段变化，当场小怪同步变硬
  retuneLivingEnemies();
  return true;
}

/**
 * 小怪耐久跟踪武器强度。
 * 前中期(≤4级)轻度跟随，保证开局好打；
 * 5 级起强跟随攻速/攻击/阶段，避免后期秒杀看不见怪。
 */
function enemyPowerScale() {
  const mid = player.level >= 5;
  const atkBonus = Math.max(0, player.damageBonus);
  const as = 1 / Math.max(.42, player.fireRateMul);
  const asBonus = Math.max(0, as - 1);
  const atkW = mid ? .95 : .35;
  const asW = mid ? .85 : .25;
  const power = 1 + atkBonus * atkW + asBonus * asW;
  const stage = weaponStageForRank(player.level);
  const stageW = mid ? .12 : .03;
  // 技能火力也计入一部分（firepower skill）
  const skillFp = 1 + skillLevel(player.skills, "firepower") * (mid ? .08 : .03);
  const postBoss = bossCount <= 0 ? 1 : 1 + bossCount * (mid ? .12 : .06);
  // 5 级后保底血量下限抬高，杜绝“肉眼看不见就死”
  const floor = mid ? 1.55 : .9;
  return Math.max(floor, power * (1 + (stage - 1) * stageW) * skillFp * postBoss);
}

function spawnEnemyHp(type, roll = Math.random(), elite = false) {
  const shotDamage = standardProjectileDamage();
  const shotCount = Math.max(1, inheritedShotDirections().length);
  const base = enemyHealth(type, shotDamage, roll, shotCount, enemyPowerScale());
  return Math.max(1, Math.ceil(base * (elite ? 1.85 : 1)));
}

function retuneLivingEnemies() {
  for (const e of enemies) {
    if (e.dead) continue;
    const ratio = e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 1;
    const nextMax = spawnEnemyHp(e.type, .55, !!e.elite);
    e.maxHp = nextMax;
    e.hp = Math.max(1, Math.ceil(nextMax * ratio));
    drawHpLabel(e);
  }
}

function grantHeroXp(amount, x = player.x, z = PLAYER_Z) {
  // 5 级后强压击杀经验，避免中期连升；打完五害后略放开，方便冲司令开终焉
  const rankDamp =
    player.level <= 2 ? 1 :
    player.level <= 4 ? .7 :
    player.level <= 6 ? (bossCount >= 5 ? .75 : .42) :
    player.level <= 9 ? (bossCount >= 5 ? .7 : .32) :
    player.level <= 11 ? (bossCount >= 5 ? .65 : .26) :
    (bossCount >= 5 ? .6 : .22);
  const xpMul = (1 + saveData.medals * .02) * (1 + skillLevel(player.skills, "study") * .1) * rankDamp;
  const gained = Math.max(1, Math.round(amount * xpMul));
  if (player.prestigeReady) {
    player.xp = COMMANDER_MERIT;
    score += gained * 2;
    addFloatText(x, 3.5, z, `功勋转化 +${gained * 2}分`, "#ffd66b", 4.1);
    return;
  }
  player.xp += gained;
  addFloatText(x, 3.5, z, `${player.level >= MAX_RANK ? "功勋" : "经验"} +${gained}`, player.level >= MAX_RANK ? "#ffd66b" : "#b8f58b", 4.3);
  processRankProgress();
}

function processRankProgress() {
  if (player.pendingPromotion || player.prestigeReady) return;
  if (player.level < MAX_RANK) {
    const needed = rankXpToNext(player.level);
    if (player.xp < needed) return;
    player.xp -= needed;
    player.level++;
    evolveHero(player.level);
    openSkillChoice();
    // 晋升后也可能跨过 Boss 军衔门槛
    if (!boss && !bossWarning) trySummonBoss("军衔晋升");
    return;
  }
  if (player.xp >= COMMANDER_MERIT) {
    player.xp = COMMANDER_MERIT;
    player.prestigeReady = true;
    openPrestigePanel();
  }
}

function damageUnit(unit, amount = 1) {
  if (!unit) return false;
  const before = unit.armor;
  unit.armor = Math.max(0, unit.armor - amount);
  unit.mesh.userData.hit = 1;
  return before > 0 && unit.armor === 0;
}


/* ================= 生成敌人 / 道具 ================= */
/* 敌人头顶血条与生命数字 */
function attachHpLabel(e) {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 56;
  const g = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.9, 0.83, 1);
  sp.position.set(0, 2.35, 0);
  e.mesh.add(sp);
  e.hpLabel = { g, tex, sp };
  drawHpLabel(e);
}
function drawHpLabel(e) {
  const g = e.hpLabel.g;
  g.clearRect(0, 0, 128, 56);
  // 生命数字
  g.font = "bold 30px Arial";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.strokeStyle = "#000"; g.lineWidth = 5;
  const displayHp = Math.max(0, Math.ceil(e.hp));
  g.strokeText(displayHp, 64, 16);
  g.fillStyle = "#fff";
  g.fillText(displayHp, 64, 16);
  // 血条
  const ratio = Math.max(e.hp, 0) / e.maxHp;
  g.fillStyle = "rgba(0,0,0,.65)";
  g.fillRect(8, 38, 112, 14);
  g.fillStyle = ratio > 0.5 ? "#66bb6a" : ratio > 0.25 ? "#ffa726" : "#ef5350";
  g.fillRect(10, 40, 108 * ratio, 10);
  e.hpLabel.tex.needsUpdate = true;
}
function removeEnemy(e) {
  scene.remove(e.mesh);
  e.mesh.remove(e.hpLabel.sp);
  e.hpLabel.tex.dispose();
  e.hpLabel.sp.material.dispose();
  disposeSoldierMesh(e.mesh);
}

function spawnEnemyGroup() {
  const difficulty = 1 + distance / 1800 + bossCount * .25;
  const cap = mobileDevice ? 24 : 32;
  const remaining = Math.max(0, cap - enemies.length);
  if (!remaining) return;
  // Early game: fewer fodder packs so the opening fight is not a slog.
  const early = distance < 280;
  const weakWave = Math.random() < (early ? .08 : .2);
  const desired = weakWave
    ? (early ? 3 + Math.floor(Math.random() * 2) : 5 + Math.floor(Math.random() * 4))
    : distance >= 500 ? 3 + Math.floor(Math.random() * 5)
    : early ? 1 + Math.floor(Math.random() * 2)
    : 2 + Math.floor(Math.random() * 4);
  const groupSize = Math.min(desired, remaining);
  const baseX = rand(-ROAD_HALF + 2.2, ROAD_HALF - 2.2);
  const formation = Math.floor(Math.random() * 3);
  // 远程锁定枪兵：前两关（打完 2 个 Boss 前）不出现，后期再加压
  let gunnersLeft = bossCount >= 2 && distance >= 200
    ? Math.min(2, Math.random() < .55 ? 1 + (Math.random() < .3 ? 1 : 0) : 0)
    : 0;
  for (let i = 0; i < groupSize; i++) {
    let type = "normal";
    if (weakWave) type = "fodder";
    else if (gunnersLeft > 0 && i >= Math.ceil(groupSize / 2) && Math.random() < .55) { type = "gunner"; gunnersLeft--; }
    else {
      const roll = Math.random();
      // 5 级后多盾/重装，减少“一枪蒸发”的脆皮感
      const heavyBias = player.level >= 5 ? .22 : bossCount >= 1 ? .12 : 0;
      type = roll < (.5 - heavyBias) ? "normal" : roll < (.78 - heavyBias * .4) ? "shield" : "heavy";
    }
    let mesh, speed, radius, sc, contactDmg;
    if (type === "fodder") {
      mesh = makeSoldier(0xef5b42); mesh.scale.setScalar(.82);
      speed = rand(.13, .18) + difficulty * .01; radius = .62; sc = 7; contactDmg = DAMAGE_VALUES.normal;
    } else if (type === "normal") {
      mesh = makeSoldier(0xe23b39);
      speed = rand(.10, .15) + difficulty * .01; radius = .75; sc = 12; contactDmg = DAMAGE_VALUES.normal;
    } else if (type === "gunner") {
      mesh = makeSoldier(0x8257be, "sniper", 2);
      const sight = new THREE.Mesh(new THREE.SphereGeometry(.13, 9, 6), new THREE.MeshBasicMaterial({ color: 0xff5b77, toneMapped: false }));
      sight.position.set(0, 1.5, -.5); mesh.userData.rig.add(sight);
      speed = rand(.055, .075); radius = .78; sc = 38; contactDmg = DAMAGE_VALUES.gunner;
    } else if (type === "shield") {
      mesh = makeSoldier(0x6f93a6);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(.95, 1.25, .12), new THREE.MeshToonMaterial({ color: 0xcadae4, gradientMap: TOON_RAMP }));
      plate.position.set(0, .78, -.62); mesh.userData.rig.add(plate);
      mesh.userData.tintMats.push(plate.material);   // 让盾牌也参与受击闪白
      speed = rand(.07, .10); radius = .85; sc = 30; contactDmg = DAMAGE_VALUES.shield;
    } else {
      mesh = makeSoldier(0x9e2222); mesh.scale.set(1.65, 1.65, 1.65);
      speed = rand(.04, .06); radius = 1.25; sc = 55; contactDmg = DAMAGE_VALUES.heavy;
    }
    const column = i - (groupSize - 1) / 2;
    const row = formation === 0 ? Math.abs(column) : formation === 1 ? i % 2 : Math.floor(i / 3);
    const xOffset = formation === 2 ? (i % 3 - 1) * 2.1 : column * 1.65;
    const zOffset = formation === 0 ? -row * 2.1 : formation === 1 ? -(i % 2) * 2.4 : -row * 2.2;
    mesh.position.set(clamp(baseX + xOffset, -ROAD_HALF + 1, ROAD_HALF - 1), 0, SPAWN_Z + zOffset);
    mesh.rotation.y = Math.PI;   // 面向玩家
    scene.add(mesh);
    const hp = spawnEnemyHp(type, Math.random());
    const e = { id: nextEnemyId++, mesh, hp, maxHp: hp, type, speed, radius, score: sc, contactDmg, attackCd: type === "gunner" ? rand(90, 150) : 0 };
    attachHpLabel(e);
    enemies.push(e);
  }
}

/* 击杀反馈:只用短命火花/光环，不再撒四面体碎片（会堆成满屏纸屑） */
function shatterEnemy(e) {
  const ep = e.mesh.position;
  const tint =
    e.type === "gunner" ? 0xd59cff :
    e.type === "shield" ? 0x8dd8ed :
    e.type === "heavy"  ? 0xff6b5c :
    e.type === "fodder" ? 0xffb06a :
    0xff8a70;
  // Fodder: ring only. Elite/heavy: a few sparks. Never spawn long-lived debris meshes.
  if (e.type === "heavy" || e.elite) {
    addSparks(ep.x, 1.05, ep.z, tint, mobileDevice ? 4 : 7, .28);
  } else if (e.type !== "fodder") {
    addSparks(ep.x, 1.0, ep.z, tint, mobileDevice ? 2 : 4, .22);
  }
}

function killXpForEnemy(e) {
  // 基础 XP 再降一档；5 级后主要靠 rankDamp 控节奏
  const base =
    e.type === "fodder" ? 2 :
    e.type === "gunner" ? 4 :
    e.type === "shield" ? 4 :
    e.type === "heavy" ? 6 :
    3;
  return e.elite ? base + 4 : base;
}

/** 击杀小概率掉小技能：自动 +1 级，不弹三选一面板 */
function tryDropKillSkillChip(e, x, z) {
  if (player.pendingPromotion || player.prestigeReady || uiPaused) return;
  const chance =
    e.elite ? .28 :
    e.type === "heavy" ? .18 :
    e.type === "gunner" || e.type === "shield" ? .12 :
    e.type === "fodder" ? .06 :
    .09;
  if (Math.random() > chance) return;
  const available = SKILL_DEFS.filter(skill => skillLevel(player.skills, skill.id) < skill.maxLevel);
  if (!available.length) return;
  const skill = available[Math.floor(Math.random() * available.length)];
  player.skills[skill.id] = skillLevel(player.skills, skill.id) + 1;
  const hero = heroUnit();
  if (hero && skill.id === "armor") {
    hero.maxArmor += 8;
    hero.armor = Math.min(hero.maxArmor, hero.armor + 8);
  }
  if (skill.id === "drone") syncDrones();
  const color = skill.category === "attack" ? "#ff8a65" : skill.category === "defense" ? "#66e7ff" : "#d7a4ff";
  addImpactRing(x, .1, z, new THREE.Color(color).getHex(), 2.4);
  addFloatText(x, 3.6, z, `${skill.icon} ${skill.name} Lv.${player.skills[skill.id]}`, color, 5.2);
  addFloatText(player.x, 4.2, PLAYER_Z - 1.2, "技能碎片!", color, 4.4);
  flashScreen(color, .16);
  score += 20;
}

/* 击杀结算:得分 + 经验 + 连杀链 */
function killEnemy(e) {
  e.dead = true;
  kills++;
  score += e.score + (e.elite ? 40 : 0);
  const ep = e.mesh.position;
  grantHeroXp(killXpForEnemy(e), ep.x, ep.z + .4);
  tryDropKillSkillChip(e, ep.x, ep.z);
  shatterEnemy(e);
  addImpactRing(ep.x, .08, ep.z, e.type === "shield" ? 0x8dd8ed : 0xff765f, e.type === "heavy" ? 2.0 : 1.2);
  addFloatText(ep.x, 2.2, ep.z, "+" + (e.score + (e.elite ? 40 : 0)), e.elite ? "#d7a4ff" : "#ffd54f");
  addShake(e.type === "heavy" || e.elite ? 0.12 : 0.04);
  if (e.type === "heavy" || e.elite) triggerHitStop(1);
  else if (critT > 0 && combo > 0 && combo % 5 === 0) triggerHitStop(1);
  combo++;
  comboTimer = 150 + skillLevel(player.skills, "combo") * 45;
  trySpawnMine(ep.x, ep.z);
  const shieldSkill = skillLevel(player.skills, "shield");
  if (shieldSkill > 0) {
    player.shieldKillProgress++;
    const threshold = 28 - shieldSkill * 3;
    if (player.shieldKillProgress >= threshold) {
      player.shieldKillProgress = 0;
      player.shield = Math.min(9, player.shield + 1);
      addFloatText(player.x, 3.8, PLAYER_Z - 1, "护盾充能!", "#66e7ff", 4.2);
      addImpactRing(player.x, .08, PLAYER_Z, 0x66e7ff, 3.2);
    }
  }
  const airstrikeSkill = skillLevel(player.skills, "airstrike");
  if (airstrikeSkill > 0 && !airstrikeResolving) {
    player.airstrikeKillProgress++;
    const threshold = [30, 24, 18][airstrikeSkill - 1];
    if (player.airstrikeKillProgress >= threshold) {
      player.airstrikeKillProgress = 0;
      triggerAirstrike(airstrikeSkill);
    }
  }
  if (combo === 5)  { critT = 600; addFloatText(player.x, 5, -8, "连杀×5 暴击模式!", "#ffb300", 6.5); flashScreen("#ffb300", .22); addShockwave(player.x, .1, PLAYER_Z, 0xffb300, 4); addShake(.2); }
  if (combo === 10) { player.spreadT = Math.max(player.spreadT, 600); addFloatText(player.x, 5, -8, "连杀×10 子弹扩散!", "#ba68c8", 6.5); flashScreen("#ba68c8", .24); addShockwave(player.x, .1, PLAYER_Z, 0xba68c8, 4.6); addShake(.24); }
  if (combo >= 15)  { player.slowT = Math.max(player.slowT, 420); addFloatText(player.x, 5, -8, "连杀×15 时间减速!", "#fff176", 6.5); flashScreen("#fff176", .26); addShockwave(player.x, .1, PLAYER_Z, 0xfff176, 5); addShake(.28); triggerHitStop(2); combo = 0; }
}

/* ================= 机制技能:弹射 / 地雷 / 齐射支援 ================= */
function tryRicochet(fromEnemy, dmg, excludeIds) {
  const level = skillLevel(player.skills, "ricochet");
  if (level <= 0 || !fromEnemy) return;
  const bounces = level;
  let origin = fromEnemy.mesh.position;
  let lastId = fromEnemy.id;
  const hit = new Set(excludeIds || []);
  hit.add(lastId);
  for (let i = 0; i < bounces; i++) {
    let best = null, bestDist = 7.5 * 7.5;
    for (const e of enemies) {
      if (e.dead || hit.has(e.id)) continue;
      const dx = e.mesh.position.x - origin.x;
      const dz = e.mesh.position.z - origin.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDist) { bestDist = d2; best = e; }
    }
    if (!best) break;
    const bounceDmg = dmg * .55;
    best.hp -= bounceDmg;
    best.mesh.userData.hit = 1;
    drawHpLabel(best);
    addFloatText(best.mesh.position.x, 2.8, best.mesh.position.z, "弹射 -" + Math.round(bounceDmg), "#9ad8ff", 2.4);
    addGlowGhost((origin.x + best.mesh.position.x) / 2, 1.1, (origin.z + best.mesh.position.z) / 2, 0x8fd6ff, 1.4);
    hit.add(best.id);
    origin = best.mesh.position;
    if (best.hp <= 0) killEnemy(best);
  }
}

function trySpawnMine(x, z) {
  const level = skillLevel(player.skills, "mines");
  if (level <= 0) return;
  const chance = [.35, .5, .65][level - 1];
  if (Math.random() > chance) return;
  if (playerMines.length >= (mobileDevice ? 8 : 14)) return;
  const mul = [1.2, 1.6, 2.1][level - 1];
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb22e, transparent: true, opacity: .85, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.28, .36, .12, 10), mat);
  mesh.position.set(x, .08, z);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(.5, .72, 18),
    new THREE.MeshBasicMaterial({ color: 0xffb22e, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = .02; mesh.add(ring);
  scene.add(mesh);
  playerMines.push({
    mesh, mat, x, z,
    life: 420,
    dmg: standardProjectileDamage() * mul,
    radius: 1.55 + level * .15,
  });
}

function updatePlayerMines() {
  for (const mine of playerMines) {
    mine.life--;
    mine.mesh.position.z += worldSpeed;
    mine.z = mine.mesh.position.z;
    mine.mat.opacity = .55 + Math.sin(frame * .2) * .25;
    let triggered = false;
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.mesh.position.x - mine.mesh.position.x;
      const dz = e.mesh.position.z - mine.mesh.position.z;
      if (dx * dx + dz * dz < mine.radius * mine.radius) { triggered = true; break; }
    }
    if (triggered || mine.life <= 0) {
      if (triggered) {
        addParticles(mine.mesh.position.x, .8, mine.mesh.position.z, "#ffb22e", 14, .35);
        addShockwave(mine.mesh.position.x, .08, mine.mesh.position.z, 0xffb22e, mine.radius * 1.4);
        for (const e of enemies) {
          if (e.dead) continue;
          const dx = e.mesh.position.x - mine.mesh.position.x;
          const dz = e.mesh.position.z - mine.mesh.position.z;
          if (dx * dx + dz * dz <= mine.radius * mine.radius) {
            e.hp -= mine.dmg;
            e.mesh.userData.hit = 1;
            drawHpLabel(e);
            if (e.hp <= 0) killEnemy(e);
          }
        }
        if (boss) {
          const dx = boss.mesh.position.x - mine.mesh.position.x;
          const dz = boss.mesh.position.z - mine.mesh.position.z;
          if (dx * dx + dz * dz <= (mine.radius + 1.2) ** 2) damageBoss(mine.dmg * .7, mine.mesh.position.x, mine.mesh.position.z);
        }
      }
      mine.life = 0;
    }
  }
  compactInPlace(playerMines, mine => {
    if (mine.life > 0 && mine.mesh.position.z < 12) return true;
    scene.remove(mine.mesh);
    mine.mesh.traverse(o => {
      if (o.geometry && o.geometry !== mine.mesh.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    if (mine.mesh.geometry) mine.mesh.geometry.dispose();
    return false;
  });
}

/** 齐射支援：周期性向最近敌人/Boss 额外打出一排机关枪弹 */
function fireSalvoSupport() {
  const level = skillLevel(player.skills, "salvo");
  if (level <= 0) return;
  let target = null;
  if (boss) target = boss.mesh.position;
  else {
    let bestZ = -Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.mesh.position.z > bestZ && e.mesh.position.z < PLAYER_Z + 2) {
        bestZ = e.mesh.position.z;
        target = e.mesh.position;
      }
    }
  }
  if (!target) return;
  const count = 2 + level;
  const dmg = standardProjectileDamage() * (.55 + level * .12);
  const def = WEAPON_DEFS.rifle;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1) - .5);
    const aimX = target.x + t * 1.1;
    const dz = Math.max(6, PLAYER_Z - target.z);
    const vx = clamp((aimX - player.x) / (dz / def.speed), -.28, .28);
    const mesh = bulletMeshPool.acquire();
    mesh.visible = true;
    mesh.material = bulletMaterial("rifle");
    mesh.position.set(player.x + t * .25, 1.15, PLAYER_Z - 1.05);
    mesh.rotation.y = Math.atan2(-vx, def.speed);
    mesh.scale.set(1.05, 1.05, 1.2);
    scene.add(mesh);
    bullets.push({
      mesh, weaponId: "rifle", type: "bullet", vx, dmg,
      px: mesh.position.x, pz: mesh.position.z, speed: def.speed * 1.08,
      pierce: 1 + skillLevel(player.skills, "pierce"),
      radius: 0, blastMul: 1, starburst: false, hitIds: new Set(),
    });
  }
  addMuzzleFlash(player.x, PLAYER_Z - 1.2);
  addFloatText(player.x, 3.2, PLAYER_Z - 2, "齐射!", "#7df6ff", 3.6);
}

function updateSalvoSupport() {
  const level = skillLevel(player.skills, "salvo");
  if (level <= 0) { salvoCd = 0; return; }
  if (salvoCd > 0) { salvoCd--; return; }
  const interval = [7, 5.5, 4][level - 1] * 60;
  fireSalvoSupport();
  salvoCd = interval;
}

/* ================= 中期事件波 ================= */
function triggerRunEvent() {
  const def = pickRunEvent(eventIndex);
  eventIndex++;
  nextEventAt = nextEventDistance(distance + 20, eventIndex);
  addFloatText(0, 6.2, -16, def.label, def.color, 6.8);
  flashScreen(def.color, .28);
  addShake(.22);
  if (def.type === "elite") spawnEliteSquad();
  else if (def.type === "airdrop") spawnAirdropCrates();
  else spawnHordeWave();
}

function spawnEliteSquad() {
  for (let i = 0; i < 3; i++) {
    const type = i === 0 ? "heavy" : i === 1 ? "shield" : "gunner";
    const mesh = makeSoldier(type === "heavy" ? 0x7b1fa2 : type === "shield" ? 0x5c6bc0 : 0x8e24aa, type === "gunner" ? "sniper" : "rifle", 3);
    mesh.scale.setScalar(type === "heavy" ? 1.75 : 1.2);
    mesh.position.set(clamp((i - 1) * 3.2 + rand(-.4, .4), -ROAD_HALF + 1.2, ROAD_HALF - 1.2), 0, SPAWN_Z - i * 2.5);
    mesh.rotation.y = Math.PI;
    const aura = new THREE.Mesh(
      new THREE.RingGeometry(.55, .72, 20),
      new THREE.MeshBasicMaterial({ color: 0xd59cff, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    aura.rotation.x = -Math.PI / 2; aura.position.y = .04; mesh.add(aura);
    scene.add(mesh);
    const hp = spawnEnemyHp(type, .85, true);
    const e = {
      id: nextEnemyId++, mesh, hp, maxHp: hp, type,
      speed: type === "heavy" ? .045 : type === "shield" ? .07 : .06,
      radius: type === "heavy" ? 1.3 : .9,
      score: type === "heavy" ? 90 : 55,
      contactDmg: type === "heavy" ? DAMAGE_VALUES.heavy : type === "shield" ? DAMAGE_VALUES.shield : DAMAGE_VALUES.gunner,
      attackCd: type === "gunner" ? 60 : 0,
      elite: true,
    };
    attachHpLabel(e);
    enemies.push(e);
  }
}

function spawnAirdropCrates() {
  for (const side of [-1, 0, 1]) {
    const crate = makeCrate(side * 3.2 + rand(-.3, .3), SPAWN_Z - 4);
    crate.count = Math.max(1, Math.ceil(crate.count * .55));
    drawCrateFace(crate.g2d, crate); crate.tex.needsUpdate = true;
    crates.push(crate);
  }
  addFloatText(0, 5, -12, "三箱空投 · 靠近拾取!", "#7dffe0", 5.5);
}

function spawnHordeWave() {
  eventHordeT = 18 * 60;
  const n = mobileDevice ? 10 : 14;
  for (let i = 0; i < n; i++) {
    const mesh = makeSoldier(0xef5b42); mesh.scale.setScalar(.78);
    mesh.position.set(rand(-ROAD_HALF + 1.2, ROAD_HALF - 1.2), 0, SPAWN_Z - rand(0, 18));
    mesh.rotation.y = Math.PI;
    scene.add(mesh);
    const hp = spawnEnemyHp("fodder", .4);
    const e = {
      id: nextEnemyId++, mesh, hp, maxHp: hp, type: "fodder",
      speed: rand(.14, .2), radius: .6, score: 6, contactDmg: DAMAGE_VALUES.normal, attackCd: 0,
    };
    attachHpLabel(e);
    enemies.push(e);
  }
  addFloatText(0, 5, -12, "18秒敌潮!", "#ff8a65", 5.8);
}

/* ================= 选择门 ================= */
/* 好门：攻速/攻击 + 弹射/穿甲/暴击/分裂等枪技；坏门：减攻速或减攻击 */
function buffFireRate(mul) {
  player.fireRateMul = Math.max(.42, player.fireRateMul * mul);
  retuneLivingEnemies();
}
function buffDamage(add) {
  player.damageBonus = Math.min(.8, Math.max(0, player.damageBonus + add));
  retuneLivingEnemies();
}
/** 穿门直接 +1 技能等级（已满则退回小攻速） */
function gateGrantSkill(skillId) {
  const def = SKILL_DEFS.find(s => s.id === skillId);
  if (!def) { buffFireRate(.92); return; }
  const lv = skillLevel(player.skills, skillId);
  if (lv >= def.maxLevel) {
    buffFireRate(.90);
    addFloatText(player.x, 3.8, PLAYER_Z - 1, `${def.name}已满 · 改给攻速`, "#8fd9ff", 4.2);
    return;
  }
  player.skills[skillId] = lv + 1;
  const hero = heroUnit();
  if (hero && skillId === "armor") {
    hero.maxArmor += 8;
    hero.armor = Math.min(hero.maxArmor, hero.armor + 8);
  }
  if (skillId === "drone") syncDrones();
  if (skillId === "salvo") salvoCd = Math.min(salvoCd || 90, 90);
  addFloatText(player.x, 4.0, PLAYER_Z - 1, `${def.icon} ${def.name} Lv.${player.skills[skillId]}`, "#ffe27a", 5.0);
}
const GATE_BUFFS = [
  { text: "攻速 +16%", color: 0x4fc3f7, css: "#8fd9ff", good: true,
    apply() { buffFireRate(.84); } },
  { text: "攻击 +10%", color: 0xff7043, css: "#ff9a76", good: true,
    apply() { buffDamage(.10); } },
  { text: "↺ 弹射 +1", color: 0x9ad8ff, css: "#9ad8ff", good: true,
    apply() { gateGrantSkill("ricochet"); } },
  { text: "➹ 穿甲 +1", color: 0xd7a4ff, css: "#d7a4ff", good: true,
    apply() { gateGrantSkill("pierce"); } },
  { text: "✦ 暴击 +1", color: 0xffd54f, css: "#ffd54f", good: true,
    apply() { gateGrantSkill("critical"); } },
  { text: "⑂ 分裂 +1", color: 0xba68c8, css: "#ba68c8", good: true,
    apply() { gateGrantSkill("split"); } },
  { text: "🔥 火力 +1", color: 0xff8a65, css: "#ff8a65", good: true,
    apply() { gateGrantSkill("firepower"); } },
  { text: "⚡ 装填 +1", color: 0x81d4fa, css: "#81d4fa", good: true,
    apply() { gateGrantSkill("reload"); } },
];
const GATE_DEBUFFS = [
  { text: "攻速 -12%", color: 0x5d4037, css: "#bcaaa4", good: false,
    apply() { player.fireRateMul = Math.min(1.55, player.fireRateMul / .88); retuneLivingEnemies(); } },
  { text: "攻速 -8%",  color: 0x6d4c41, css: "#a1887f", good: false,
    apply() { player.fireRateMul = Math.min(1.55, player.fireRateMul / .92); retuneLivingEnemies(); } },
  { text: "攻击 -8%",  color: 0xb71c1c, css: "#ef5350", good: false,
    apply() { buffDamage(-.08); } },
  { text: "攻击 -5%",  color: 0xc62828, css: "#e57373", good: false,
    apply() { buffDamage(-.05); } },
];
function spawnGatePair() {
  const group = new THREE.Group();
  const gw = ROAD_HALF - 0.4;
  const mats = [];
  function door(x, colorHex, text, cssColor) {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(gw, 3.4), mat);
    m.position.set(x, 1.7, 0);
    group.add(m);
    const floorMat = mat.clone(); floorMat.opacity = .11;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(gw, 7.5), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(x, .035, 1.2); group.add(floor);
    const frameMat = new THREE.MeshStandardMaterial({
      color: colorHex, emissive: colorHex, emissiveIntensity: .58, metalness: .08, roughness: .32
    });
    const top = new THREE.Mesh(new THREE.BoxGeometry(gw + .28, .22, .28), frameMat);
    top.position.set(x, 3.5, 0); group.add(top);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(.2, 3.55, .28), frameMat);
      pillar.position.set(x + side * gw / 2, 1.76, 0); group.add(pillar);
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(.23, 0), new THREE.MeshBasicMaterial({ color: colorHex, toneMapped: false }));
      orb.position.set(x + side * gw / 2, 3.54, 0); group.add(orb);
    }
    const sp = makeTextSprite(text, cssColor, 5.5);
    sp.position.set(x, 2.2, 0.15);
    group.add(sp);
    mats.push(mat, floorMat);
  }
  const buff = GATE_BUFFS[Math.floor(Math.random() * GATE_BUFFS.length)];
  const debuff = GATE_DEBUFFS[Math.floor(Math.random() * GATE_DEBUFFS.length)];
  const buffOnLeft = Math.random() < .5;
  const left = buffOnLeft ? buff : debuff;
  const right = buffOnLeft ? debuff : buff;
  door(-ROAD_HALF / 2, left.color,  left.text,  left.css);
  door( ROAD_HALF / 2, right.color, right.text, right.css);
  group.position.z = SPAWN_Z;
  scene.add(group);
  gates.push({ group, mats, used: false, left, right, phase: Math.random() * Math.PI * 2 });
}
function disposeGate(g) {
  scene.remove(g.group);
  g.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
  });
}

/* ================= 小范围陷阱 ================= */
const TRAP_TYPES = ["spikes", "mine", "emp"];
function makeTrap(type, x, z) {
  const mesh = new THREE.Group();
  const groundMat = new THREE.MeshBasicMaterial({
    color: type === "spikes" ? 0xff7043 : type === "mine" ? 0xffb22e : 0x65d8ff,
    transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.72, type === "mine" ? 1.48 : 1.28, 30), groundMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = .035; mesh.add(ring);
  let radius = type === "spikes" ? 1.05 : type === "mine" ? 1.55 : 1.35;
  if (type === "spikes") {
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x9aa9b4, metalness: .72, roughness: .3 });
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(.12, .55, 7), spikeMat);
      spike.position.set(Math.cos(angle) * .68, .28, Math.sin(angle) * .68);
      mesh.add(spike);
    }
  } else if (type === "mine") {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(.5, .66, .22, 12), new THREE.MeshStandardMaterial({ color: 0x343b45, metalness: .68, roughness: .3 }));
    shell.position.y = .12; mesh.add(shell);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 7), new THREE.MeshBasicMaterial({ color: 0xffb22e, toneMapped: false }));
    beacon.position.y = .32; mesh.add(beacon); mesh.userData.beacon = beacon;
  } else {
    const field = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.32, .08, 24), new THREE.MeshBasicMaterial({ color: 0x3888aa, transparent: true, opacity: .42, toneMapped: false }));
    field.position.y = .05; mesh.add(field);
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(.45 + i * .23, .025, 5, 24), new THREE.MeshBasicMaterial({ color: 0x76efff, toneMapped: false }));
      arc.rotation.x = Math.PI / 2; arc.position.y = .14 + i * .06; mesh.add(arc);
    }
  }
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  return { type, mesh, radius, triggered: false, resolved: false, fuse: type === "mine" ? -1 : 0, groundMat };
}

function spawnTrapGroup() {
  const targetCurrentLane = Math.random() < .45;
  const safeX = targetCurrentLane
    ? clamp(player.x + (player.x >= 0 ? -4.4 : 4.4), -ROAD_HALF + 2.3, ROAD_HALF - 2.3)
    : rand(-ROAD_HALF + 2.3, ROAD_HALF - 2.3);
  const wanted = 1 + Math.floor(Math.random() * 3);
  const xs = [];
  if (targetCurrentLane && Math.abs(player.x - safeX) >= 2.2) xs.push(clamp(player.x, -ROAD_HALF + 1.5, ROAD_HALF - 1.5));
  for (let attempt = 0; attempt < 24 && xs.length < wanted; attempt++) {
    const x = rand(-ROAD_HALF + 1.5, ROAD_HALF - 1.5);
    if (Math.abs(x - safeX) < 2.2 || xs.some(other => Math.abs(other - x) < 2.4)) continue;
    xs.push(x);
  }
  if (!xs.length) xs.push(safeX > 0 ? -4.8 : 4.8);
  xs.forEach((x, index) => traps.push(makeTrap(TRAP_TYPES[Math.floor(Math.random() * TRAP_TYPES.length)], x, SPAWN_Z - index * 2.2)));
}

function disposeTrap(trap) {
  scene.remove(trap.mesh);
  trap.mesh.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) object.material.dispose();
  });
}

function tryDodgeDamage() {
  return Math.random() < skillLevel(player.skills, "danger") * .1;
}

function hurtHero(amount, label, color = "#ff5252", allowDodge = true, armorShare = ARMOR_SHARES.standard, source = "contact") {
  const hero = heroUnit();
  if (!hero) return false;
  const dodged = allowDodge && tryDodgeDamage();
  if (dodged) {
    addFloatText(player.x, 3.4, PLAYER_Z - 1, "危险感知 · 闪避!", "#b792ff", 4.2);
    addImpactRing(player.x, .08, PLAYER_Z, 0xb792ff, 3);
    return false;
  }
  const result = resolveHeroDamage({
    health: hero.health,
    maxHealth: hero.maxHealth,
    armor: hero.armor,
    maxArmor: hero.maxArmor,
    shield: player.shield,
  }, { amount, armorShare, source, allowDodge }, false);
  hero.health = result.health;
  hero.armor = result.armor;
  player.shield = result.shield;
  hero.mesh.userData.hit = 1;
  if (result.shieldConsumed > 0) {
    addFloatText(player.x, 3.4, PLAYER_Z - 1, "护盾抵挡!", "#66e7ff", 4.2);
    addImpactRing(player.x, .08, PLAYER_Z, 0x66e7ff, 3.2);
    return false;
  }
  player.hurtT = 18;
  addShake(source === "boss" ? .4 : .3); flashScreen(color, .38);
  if (source === "boss") triggerHitStop(4);   // Boss 技能命中:明显卡帧,强调"挨了重击"
  if (result.healthDamage > 0) {
    flashVital(healthFillEl);
    addFloatText(player.x, 3.7, PLAYER_Z - 1, `生命 -${result.healthDamage}`, "#ff3346", 5.2);
  }
  if (result.armorDamage > 0) {
    flashVital(armorFillEl);
    addFloatText(player.x, 3.0, PLAYER_Z - 1, `护甲 -${result.armorDamage}`, "#63cbff", 3.9);
  }
  if (result.dead) addFloatText(player.x, 4.3, PLAYER_Z - 1, "生命归零!", "#ff2038", 5.6);
  else if (result.armorBroken) addFloatText(player.x, 4.15, PLAYER_Z - 1, "护甲破裂!", "#72cfff", 4.1);
  if (result.dead) {
    player.soldiers = player.soldiers.filter(unit => unit.id !== hero.id);
    removePlayerUnit(hero);
  }
  return result.dead;
}

function createEnemyAimHazard(enemy) {
  // 前两关禁用远程锁定，避免开局被红圈点名
  if (bossCount < 2) return false;
  if (enemyAimHazards.length >= 2) return false;
  const group = new THREE.Group();
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xff365a, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcf70, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.92, 1.28, 34), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = .04; group.add(ring);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(.92, 34), markerMat);
  disk.rotation.x = -Math.PI / 2; disk.position.y = .025; group.add(disk);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.035, .09, 4.8, 8), ringMat);
  beam.position.y = 2.4; group.add(beam);
  group.position.set(player.x, 0, PLAYER_Z);
  scene.add(group);
  enemyAimHazards.push({ mesh: group, x: player.x, timer: 54, maxTimer: 54, markerMat, ringMat, sourceEnemyId: enemy.id });
  addFloatText(player.x, 3.7, PLAYER_Z - 1, "远程锁定!", "#ff6d83", 4.2);
  return true;
}

function disposeEnemyAimHazard(hazard) {
  scene.remove(hazard.mesh);
  hazard.mesh.traverse(object => { if (object.geometry) object.geometry.dispose(); });
  hazard.markerMat.dispose(); hazard.ringMat.dispose();
}

function updateEnemyAimHazards(t) {
  for (const hazard of enemyAimHazards) {
    hazard.timer--;
    const progress = 1 - hazard.timer / hazard.maxTimer;
    hazard.mesh.rotation.y += .08;
    hazard.mesh.scale.setScalar(.88 + progress * .25 + Math.sin(t * 18) * .04);
    hazard.markerMat.opacity = .28 + progress * .58;
    hazard.ringMat.opacity = .62 + Math.sin(t * 20) * .25;
    if (hazard.timer <= 0 && !hazard.resolved) {
      hazard.resolved = true;
      addParticles(hazard.x, .8, PLAYER_Z, "#ff526d", mobileDevice ? 18 : 28, .38);
      addImpactRing(hazard.x, .08, PLAYER_Z, 0xff526d, 2.8);
      flashScreen("#ff526d", .18); addShake(.16);
      if (Math.abs(player.x - hazard.x) < 1.25) hurtHero(DAMAGE_VALUES.gunner, "远程射击命中", "#ff526d", true, ARMOR_SHARES.ranged, "ranged");
    }
  }
  enemyAimHazards = enemyAimHazards.filter(hazard => {
    if (hazard.timer <= 0) { disposeEnemyAimHazard(hazard); return false; }
    return true;
  });
}

/* ================= 奖励核心 / 道具生效 ================= */
function spawnRewardCore(crate) {
  const group = new THREE.Group();
  const color = new THREE.Color(crate.reward.color).getHex();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.42, 1), new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: .72, metalness: .28, roughness: .22,
  }));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(.72, 14, 10), new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: .18, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.78, .045, 7, 24), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  ring.rotation.x = Math.PI / 2;
  group.add(core, glow, ring);
  const label = makeTextSprite(crate.reward.label, crate.reward.color, 3.4);
  label.position.y = 1.25; group.add(label);
  group.position.set(crate.mesh.position.x, .72, crate.mesh.position.z);
  scene.add(group);
  // Wide magnet + generous auto-pickup so multi-crate drops never miss when player runs past.
  rewardCores.push({
    mesh: group, reward: crate.reward, life: 480, phase: Math.random() * Math.PI * 2,
    collected: false, pickupRadius: 3.8, magnetRadius: 9.5, label,
  });
}

function disposeRewardCore(core) {
  scene.remove(core.mesh);
  core.mesh.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) {
      if (object.material.map) object.material.map.dispose();
      object.material.dispose();
    }
  });
}

function applyReward(r, x, z) {
  addParticles(x, 1.2, z, r.color, 24, 0.3);
  addImpactRing(x, .08, z, r.color, 2.2);
  flashScreen(r.color, .28);
  addFloatText(x, 3, z, r.label, r.color);
  switch (r.type) {
    case "xp":       grantHeroXp(r.xp || 28, x, z); break;
    case "heal": {
      const hero = heroUnit();
      if (hero) {
        const healed = Math.min(r.heal || 20, hero.maxHealth - hero.health);
        hero.health += healed;
        addFloatText(x, 3.8, z, `生命 +${healed}`, "#ff7894", 4.4);
      }
      break;
    }
    case "firerate":
      buffFireRate(.80);
      addFloatText(x, 3.6, z, "攻速提升!", "#4fc3f7", 4.2);
      break;
    case "damage":
      buffDamage(.10);
      addFloatText(x, 3.6, z, "攻击提升!", "#ff8a65", 4.2);
      break;
    case "shield":   player.shield = Math.min(player.shield + 2, 9); break;
    case "slow":     player.slowT = 420; break;
    case "coin":     score += 150; break;
  }
  score += 30;
}

function fireUnitWeapon(unit, p) {
  const def = WEAPON_DEFS.rifle;
  const damage = standardProjectileDamage();
  const dirs = inheritedShotDirections();

  unit.fireCd = effectiveFireInterval();
  unit.mesh.userData.recoil = 1;
  if (unit.tier >= 4 && frame % 3 === 0) {
    addImpactRing(p.x, 1.05, p.z - .85, def.color, 1.0);
    addParticles(p.x, 1.18, p.z - .85, def.css, 2, .12);
  }
  addMuzzleFlash(p.x + .1, p.z - 1.15);
  for (const vx of dirs) {
    const mesh = bulletMeshPool.acquire();
    mesh.visible = true;
    mesh.material = bulletMaterial("rifle");
    mesh.position.set(p.x + .1, 1.04 + unit.tier * .025, p.z - 1.0);
    mesh.rotation.y = Math.atan2(-vx, def.speed);
    mesh.scale.set(1, 1, 1);
    scene.add(mesh);
    bullets.push({
      mesh, weaponId: "rifle", type: "bullet", vx, dmg: damage,
      px: mesh.position.x, pz: mesh.position.z, speed: def.speed,
      pierce: 1 + skillLevel(player.skills, "pierce"),
      radius: 0,
      blastMul: 1,
      starburst: false,
      hitIds: new Set(),
    });
  }
}

let lastExplosionShakeFrame = -999;
let explosionCountThisFrame = 0;
let lastExplosionFrame = -1;
function explodeProjectile(b, x, z, primaryTarget = null) {
  if (lastExplosionFrame !== frame) {
    lastExplosionFrame = frame;
    explosionCountThisFrame = 0;
  }
  explosionCountThisFrame++;
  const radius = (b.radius || 2.8) * (explosionCountThisFrame === 1 ? 1 : .78);
  // Soft-cap FX when many rockets detonate same frame; damage still applies (weaker splash).
  if (explosionCountThisFrame <= 2) {
    addParticles(x, 1.1, z, "#ff8a5c", quality.level === "low" ? 6 : 10, .32);
    addSparks(x, 1.2, z, 0xffc06a, mobileDevice ? 4 : 8, .38);
    if (explosionCountThisFrame === 1) {
      addSmoke(x, 1.4, z, 2, radius * .38);
      addShockwave(x, .08, z, 0xff7a55, radius * 1.1);
    }
  }
  if (explosionCountThisFrame <= 3 && frame - lastExplosionShakeFrame > 10) {
    addShake(.1);
    flashScreen("#ff8a5c", .14);
    lastExplosionShakeFrame = frame;
  }
  // Primary hit hits hard; splash is for chip — not a second full clear.
  const stackFade = explosionCountThisFrame <= 3 ? 1 : .55;
  const primaryMul = 1.15 * (b.blastMul || 1) * stackFade;
  const splashMul = .2 * (b.blastMul || 1) * stackFade;
  let splashKills = 0;
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.mesh.position.x - x, dz = e.mesh.position.z - z;
    const distSq = dx * dx + dz * dz;
    if (distSq <= radius * radius) {
      const isPrimary = e.id === primaryTarget;
      const falloff = isPrimary ? 1 : Math.max(.35, 1 - Math.sqrt(distSq) / radius);
      const mul = (isPrimary ? primaryMul : splashMul) * falloff;
      e.hp -= b.dmg * mul;
      e.mesh.userData.hit = 1;
      drawHpLabel(e);
      if (e.hp <= 0) {
        killEnemy(e);
        if (!isPrimary) splashKills++;
      }
    }
  }
  if (splashKills >= 3) {
    addFloatText(x, 3.6, z, `溅射 ×${splashKills}`, "#ffb74d", 4.6);
    addShake(.06);
  }
  if (boss) {
    const dx = boss.mesh.position.x - x, dz = boss.mesh.position.z - z;
    const distSq = dx * dx + dz * dz;
    if (distSq <= radius * radius) {
      const isPrimary = primaryTarget === "boss";
      const falloff = isPrimary ? 1 : Math.max(.4, 1 - Math.sqrt(distSq) / radius);
      const mul = (isPrimary ? primaryMul : splashMul * .85) * falloff;
      damageBoss(b.dmg * mul, x, z);
    }
  }
}

function clearHazardsForBoss() {
  enemies.forEach(removeEnemy); enemies = [];
  crates.forEach(disposeCrate); crates = [];
  rewardCores.forEach(disposeRewardCore); rewardCores = [];
  enemyAimHazards.forEach(disposeEnemyAimHazard); enemyAimHazards = [];
  gates.forEach(disposeGate); gates = [];
  traps.forEach(disposeTrap); traps = [];
  eventHordeT = 0;
}

/**
 * Q 版「公路五害」Boss：大色块剪影 + 发光弱点核（魂骑士/Brotato 可读性）。
 */
function makeBossModel(def, bossNumber) {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  const bodyMat = new THREE.MeshToonMaterial({ color: def.color, gradientMap: TOON_RAMP });
  const armorMat = new THREE.MeshToonMaterial({
    color: def.accent, gradientMap: TOON_RAMP, emissive: def.accent, emissiveIntensity: .32,
  });
  const darkMat = new THREE.MeshToonMaterial({
    color: new THREE.Color(def.color).multiplyScalar(.4).getHex(), gradientMap: TOON_RAMP,
  });
  const metalMat = new THREE.MeshToonMaterial({ color: 0x2e3848, gradientMap: TOON_RAMP });
  const skinMat = new THREE.MeshToonMaterial({ color: 0xffd6b0, gradientMap: TOON_RAMP });
  const coreMat = new THREE.MeshBasicMaterial({ color: def.accent, toneMapped: false });
  const glowMat = new THREE.MeshBasicMaterial({ color: def.accent, toneMapped: false, transparent: true, opacity: .92 });
  const outlineMat = new THREE.MeshToonMaterial({ color: 0x1a1420, gradientMap: TOON_RAMP });

  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = rig) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };

  const shadow = new THREE.Mesh(soldierGeo.shadow, soldierShadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .02;
  shadow.scale.set(2.8, 1.5, 2.8);
  root.add(shadow);

  // 公共 chibi 底座：大头 + 短胖身 + 粗腿
  add(new THREE.SphereGeometry(.72, 18, 14), bodyMat, 0, 1.05, 0, 1.2, 1.0, 1.1);
  add(new THREE.SphereGeometry(.55, 16, 12), bodyMat, 0, 1.85, 0, 1.15, 1.1, 1.1);
  add(new THREE.SphereGeometry(.18, 10, 8), glowMat, -.2, 1.92, -.48, 1.3, 1.1, .7);
  add(new THREE.SphereGeometry(.18, 10, 8), glowMat, .2, 1.92, -.48, 1.3, 1.1, .7);
  const core = add(new THREE.IcosahedronGeometry(.28, 1), coreMat, 0, 1.15, -.55, 1, 1, 1);
  core.userData.isBossCore = true;
  for (const side of [-1, 1]) {
    add(new THREE.CapsuleGeometry(.28, .35, 6, 10), darkMat, side * .42, .42, .05, 1.2, 1, 1.2);
    add(new THREE.SphereGeometry(.32, 12, 10), metalMat, side * .45, .1, -.05, 1.4, .75, 1.5);
  }

  if (def.theme === "tank") {
    // 铁罐头大佐：圆罐头盖 + 双炮当“耳朵”
    add(new THREE.CylinderGeometry(1.05, 1.15, .55, 20), armorMat, 0, 2.35, 0, 1, 1, 1);
    add(new THREE.CylinderGeometry(.35, .4, .25, 16), glowMat, 0, 2.7, 0, 1, 1, 1);
    for (const side of [-1, 1]) {
      const cannon = add(new THREE.CylinderGeometry(.16, .22, 1.7, 12), metalMat, side * .75, 2.15, -.7, 1, 1, 1);
      cannon.rotation.x = Math.PI / 2;
      cannon.rotation.z = side * .15;
      add(new THREE.SphereGeometry(.2, 10, 8), glowMat, side * .75, 2.15, -1.55, 1, 1, 1);
      add(new THREE.BoxGeometry(.55, .5, 1.5), metalMat, side * 1.0, .35, .1, 1, 1, 1);
    }
    add(new THREE.BoxGeometry(1.6, .3, 1.3), darkMat, 0, .85, .2, 1, 1, 1);
  } else if (def.theme === "shield") {
    // 铁饼队长：半人高圆盾挡脸
    const shield = add(new THREE.CylinderGeometry(1.35, 1.35, .28, 28), armorMat, 0, 1.45, -.9, 1, 1, 1);
    shield.rotation.x = Math.PI / 2;
    add(new THREE.RingGeometry(.4, .85, 32), glowMat, 0, 1.45, -1.08, 1, 1, 1);
    add(new THREE.SphereGeometry(.22, 12, 10), coreMat, 0, 1.45, -1.12, 1, 1, 1);
    for (const side of [-1, 1]) {
      add(new THREE.SphereGeometry(.38, 12, 10), metalMat, side * 1.05, .85, -.15, 1.2, 1.1, 1.2);
    }
    add(new THREE.BoxGeometry(1.1, .85, .4), darkMat, 0, 1.2, .45, 1, 1, 1);
  } else if (def.theme === "sniper") {
    // 红点幽灵：斗篷 + 头顶大红准星
    add(new THREE.ConeGeometry(1.0, 2.0, 8), darkMat, 0, 1.6, .15, 1.1, 1.15, 1.1);
    const cape = add(new THREE.BoxGeometry(1.6, 1.4, .12), outlineMat, 0, 1.2, .55, 1, 1, 1);
    cape.rotation.x = .15;
    const barrel = add(new THREE.CylinderGeometry(.12, .18, 2.8, 12), metalMat, .6, 1.55, -1.0, 1, 1, 1);
    barrel.rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(.42, 14, 12), glowMat, 0, 2.65, 0, 1.15, 1.15, 1.15);
    add(new THREE.TorusGeometry(.32, .06, 8, 20), coreMat, 0, 2.65, 0, 1, 1, 1);
    add(new THREE.RingGeometry(.08, .18, 16), coreMat, 0, 2.65, -.4, 1, 1, 1);
  } else if (def.theme === "rocket") {
    // 爆米花将军：导弹仓大肚子 + 导弹辫
    add(new THREE.SphereGeometry(.85, 16, 14), armorMat, 0, 1.15, 0, 1.35, 1.15, 1.2);
    for (const side of [-1, 1]) {
      const pod = add(new THREE.CapsuleGeometry(.38, .85, 8, 12), armorMat, side * 1.05, 1.55, .1, 1, 1, 1.1);
      pod.rotation.z = side * .18;
      for (let i = 0; i < 3; i++) {
        const tube = add(new THREE.CylinderGeometry(.1, .1, .6, 10), coreMat,
          side * 1.05, 1.25 + i * .28, -.5, 1, 1, 1);
        tube.rotation.x = Math.PI / 2;
      }
      // 导弹辫子
      const braid = add(new THREE.CapsuleGeometry(.12, .7, 6, 8), glowMat, side * .55, 2.35, .1, 1, 1, 1);
      braid.rotation.z = side * .5;
    }
    for (const side of [-1, 1]) {
      add(new THREE.ConeGeometry(.2, .5, 10), glowMat, side * .4, 1.0, .8, 1, 1, 1).rotation.x = -Math.PI / 2;
    }
  } else if (def.theme === "final") {
    // 公路终焉王：金冠 + 多层环 + 双炮
    for (let i = 0; i < 4; i++) {
      const ring = add(new THREE.TorusGeometry(.7 + i * .22, .055, 8, 36), glowMat, 0, 1.5, .05, 1, 1, 1);
      ring.rotation.set(Math.PI / 2 + i * .1, i * .35, i * .2);
      root.userData.energyRings ||= [];
      root.userData.energyRings.push(ring);
    }
    add(new THREE.ConeGeometry(.55, .7, 6), armorMat, 0, 2.75, 0, 1, 1, 1);
    add(new THREE.OctahedronGeometry(.38, 0), coreMat, 0, 2.45, 0, 1, 1.15, 1);
    for (const side of [-1, 1]) {
      const cannon = add(new THREE.CylinderGeometry(.12, .18, 1.6, 10), metalMat, side * .85, 1.7, -.7, 1, 1, 1);
      cannon.rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(.2, 10, 8), glowMat, side * .85, 1.7, -1.45, 1, 1, 1);
    }
    add(new THREE.BoxGeometry(1.4, .35, .5), darkMat, 0, .95, .25, 1, 1, 1);
  } else {
    // 棱镜哨兵：悬浮环 + 棱镜灯塔
    for (let i = 0; i < 3; i++) {
      const ring = add(new THREE.TorusGeometry(.85 + i * .25, .06, 8, 36), glowMat, 0, 1.45, .05, 1, 1, 1);
      ring.rotation.set(Math.PI / 2 + i * .12, i * .4, i * .25);
      root.userData.energyRings ||= [];
      root.userData.energyRings.push(ring);
    }
    add(new THREE.OctahedronGeometry(.48, 0), coreMat, 0, 2.55, 0, 1, 1.25, 1);
    add(new THREE.OctahedronGeometry(.22, 0), glowMat, 0, 3.05, 0, 1, 1, 1);
    for (const side of [-1, 1]) {
      const wing = add(new THREE.BoxGeometry(.12, 1.25, .6), armorMat, side * .95, 1.65, .15, 1, 1, 1);
      wing.rotation.z = side * .45;
    }
    add(new THREE.TorusGeometry(.55, .07, 8, 24), glowMat, 0, 1.35, -.45, 1, 1, 1);
  }

  // 少量肤色下巴，强化 Q 人感
  add(new THREE.SphereGeometry(.22, 10, 8), skinMat, 0, 1.55, -.35, 1.1, .7, .8);

  const aura = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.4, 36),
    new THREE.MeshBasicMaterial({
      color: def.accent, transparent: true, opacity: .3, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }),
  );
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = .04;
  root.add(aura);
  root.userData.aura = aura;

  const legL = new THREE.Group(), legR = new THREE.Group();
  const armL = new THREE.Group(), armR = new THREE.Group();
  const gunRig = new THREE.Group();
  legL.position.set(-.4, .45, 0); legR.position.set(.4, .45, 0);
  armL.position.set(-.75, 1.5, 0); armR.position.set(.75, 1.5, 0);
  gunRig.position.set(0, 1.25, -.5);
  rig.add(legL, legR, armL, armR, gunRig);
  root.userData.rig = rig;
  root.userData.legs = [legL, legR];
  root.userData.arms = [armL, armR];
  root.userData.gunRig = gunRig;
  root.userData.head = rig;
  root.userData.face = null;
  root.userData.armBase = .2;
  root.userData.phase = Math.random() * Math.PI * 2;
  root.userData.recoil = 0;
  root.userData.hit = 0;
  root.userData.spawnT = 1;
  root.userData.mergeT = 0;
  root.userData.bossCore = core;
  root.userData.weaponId = "rifle";
  root.userData.tier = 5;
  root.userData.visualStage = 5;
  const tintSet = new Set();
  root.traverse(o => {
    if (o.isMesh && o.material && o.material.isMeshToonMaterial) tintSet.add(o.material);
  });
  root.userData.tintMats = [...tintSet];
  root.scale.setScalar(1.75);
  applyRimFresnel(root, def.accent, 1.9, 1.1);
  return root;
}

function estimateBossDps() {
  const hero = heroUnit();
  if (!hero) return 1;
  const def = WEAPON_DEFS[hero.weaponId] || WEAPON_DEFS.rifle;
  const travelFrames = 27 / Math.max(.1, def.speed);
  const explosionReach = hero.tier >= 5 ? (def.radius || 1.35) : 0;
  const hitCount = Math.max(1, inheritedShotDirections().filter(vx => Math.abs(vx * travelFrames) <= 2.35 + explosionReach).length);
  const critChance = Math.min(.75, skillLevel(player.skills, "critical") * .06 + (critT > 0 ? .35 : 0));
  const weaponDps = standardProjectileDamage() * hitCount * 60 / effectiveFireInterval() * (1 + critChance);
  const droneLevel = skillLevel(player.skills, "drone");
  const droneInterval = Math.max(24, 48 - droneLevel * 6);
  const droneDps = droneLevel * standardProjectileDamage() * .35 * 60 / droneInterval;
  return weaponDps + droneDps;
}

function currentBossRequirement() {
  if (!endlessMode && bossCount >= CAMPAIGN_BOSS_COUNT) return null;
  if (!endlessMode) return BOSS_SUMMON[bossCount];
  // 无尽：沿用战役军衔表循环，满级后额外要求跑一段距离
  const base = BOSS_SUMMON[bossCount % CAMPAIGN_BOSS_COUNT];
  return { rank: base.rank, minDistance: lastBossClearDistance + 420 };
}

function bossProgressReady() {
  const req = currentBossRequirement();
  if (!req) return false;
  if (player.level < req.rank) return false;
  if (req.minDistance != null && distance < req.minDistance) return false;
  return true;
}

function bossProgressNear() {
  const req = currentBossRequirement();
  if (!req || bossProgressReady()) return false;
  if (player.level >= req.rank - 1) return true;
  if (req.minDistance != null && distance >= req.minDistance - 80) return true;
  return false;
}

function trySummonBoss(reason = "军衔晋升") {
  if (boss || !running || uiPaused || player.pendingPromotion || player.prestigeReady) return false;
  if (!bossProgressReady()) return false;
  if (bossWarning) return false;
  bossWarning = true;
  bossSummonCd = 55;   // ~0.9s telegraph before spawn
  const next = BOSS_DEFS[bossCount % BOSS_DEFS.length];
  addFloatText(0, 6, -18, `${next.name} 感应到了你 · ${reason}!`, "#ffcc66", 6.4);
  flashScreen("#ffb85c", .28);
  return true;
}

function beginBossBattle() {
  clearHazardsForBoss();
  bossHazards.forEach(disposeBossHazard);
  bossHazards = [];
  bossProjectiles.forEach(disposeBossProjectile);
  bossProjectiles = [];
  eventHordeT = 0;
  bossWarning = true;
  const bossNumber = bossCount + 1;
  const def = BOSS_DEFS[(bossNumber - 1) % BOSS_DEFS.length];
  const estimatedDps = estimateBossDps();
  const maxHp = Math.round(bossHealth(bossNumber, estimatedDps) * (def.theme === "final" ? 1.5 : 1));
  const mesh = makeBossModel(def, bossNumber);
  mesh.position.set(0, 0, -58); mesh.rotation.y = Math.PI;
  scene.add(mesh);
  boss = {
    number: bossNumber, def, mesh, hp: maxHp, maxHp,
    attackCd: 150, attackIndex: 0,
    phase: 1, phaseAnnounced: { 2: false, 3: false },
    summoned65: false, summoned35: false,
    introT: 110, windupT: 0, pendingShots: null,
    pendingDmg: 0, lastDmgFloatFrame: 0,
  };
  bossBarEl.classList.remove("hidden");
  const chapter = endlessMode ? `无尽#${bossNumber}` : `${bossNumber}/${CAMPAIGN_BOSS_COUNT}`;
  bossNameEl.textContent = `BOSS ${chapter} · ${def.name} · 阶段1`;
  updateBossBar();
  addFloatText(0, 6.4, -24, `${def.name} 登场!`, "#ffdd77", 7);
  addFloatText(0, 4.8, -20, def.signature || "", def.accent ? `#${def.accent.toString(16).padStart(6, "0")}` : "#ffe27a", 5.2);
  flashScreen("#ffce73", .36); addShake(.38);
}

function announceBossPhase(phase) {
  if (!boss || boss.phaseAnnounced[phase]) return;
  boss.phaseAnnounced[phase] = true;
  boss.phase = phase;
  const chapter = endlessMode ? `无尽#${boss.number}` : `${boss.number}/${CAMPAIGN_BOSS_COUNT}`;
  bossNameEl.textContent = `BOSS ${chapter} · ${boss.def.name} · 阶段${phase}`;
  const label = phase === 2 ? `二阶段 · ${boss.def.signature}` : "终焉阶段 · 全力输出!";
  addFloatText(0, 6.4, -18, label, phase === 2 ? "#ffb74d" : "#ff5252", 7.2);
  flashScreen(phase === 2 ? "#ffb74d" : "#ff5252", .42);
  addShake(.4); triggerHitStop(3);
  addShockwave(boss.mesh.position.x, .1, boss.mesh.position.z, boss.def.accent, 7);
  bossHazards.forEach(disposeBossHazard); bossHazards = [];
  bossProjectiles.forEach(disposeBossProjectile); bossProjectiles = [];
  boss.pendingShots = null; boss.windupT = 0;
  boss.attackCd = 70;
  if (phase === 2) spawnBossMinions();
  if (phase === 3) {
    spawnBossMinions();
    boss.attackIndex = Math.max(boss.attackIndex, 1);
  }
}

function updateBossBar() {
  if (!boss) return;
  const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
  bossFillEl.style.transform = `scaleX(${ratio})`;
  bossHpEl.textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
}

function damageBoss(amount, x, z) {
  if (!boss || boss.introT > 0 || amount <= 0) return;
  boss.hp -= amount;
  boss.mesh.userData.hit = 1;
  // Batch float numbers so multi-rocket frames read as one punch, not laggy spam.
  boss.pendingDmg = (boss.pendingDmg || 0) + amount;
  if (!boss.lastDmgFloatFrame || frame - boss.lastDmgFloatFrame >= 4) {
    const shown = Math.round(boss.pendingDmg);
    if (shown > 0) {
      addFloatText(x, 3.2, z, `-${shown}`, "#ffd86b", shown > 40 ? 4.2 : 3.2);
      boss.pendingDmg = 0;
      boss.lastDmgFloatFrame = frame;
    }
  }
  // Throttle hit confetti; always refresh bar so HP never "freezes then teleports".
  if (frame % 4 === 0) addParticles(x, 2.2, z, boss.def.accent, 3, .16);
  updateBossBar();
  if (boss.hp <= 0) {
    if (boss.pendingDmg > 0) {
      addFloatText(x, 3.4, z, `-${Math.round(boss.pendingDmg)}`, "#ffd86b", 4.4);
      boss.pendingDmg = 0;
    }
    defeatBoss();
  }
}

function defeatBoss() {
  if (!boss) return;
  const defeated = boss;
  score += 600 * defeated.number;
  saveData.highestBoss = Math.max(saveData.highestBoss, defeated.number);
  saveData.bestScore = Math.max(saveData.bestScore, Math.floor(score));
  saveData.bestDistance = Math.max(saveData.bestDistance, Math.floor(distance));
  persistSave();
  shatterBoss(defeated);
  triggerHitStop(5); addShake(.5);
  scene.remove(defeated.mesh); disposeSoldierMesh(defeated.mesh);
  bossHazards.forEach(disposeBossHazard);
  bossHazards = [];
  bossProjectiles.forEach(disposeBossProjectile);
  bossProjectiles = [];
  boss = null; bossCount++; bossWarning = false;
  bossBarEl.classList.add("hidden");
  const repairLevel = skillLevel(player.skills, "repair");
  const hero = heroUnit();
  if (hero) {
    const healthRestored = Math.max(1, Math.round(hero.maxHealth * .15));
    hero.health = Math.min(hero.maxHealth, hero.health + healthRestored);
    addFloatText(player.x, 4.55, PLAYER_Z - 2, `生命恢复 +${healthRestored}`, "#ff7894", 4.4);
  }
  if (repairLevel > 0 && hero) {
    const ratio = [0, .2, .35, .5][repairLevel];
    const healed = Math.max(1, Math.round(hero.maxArmor * ratio));
    hero.armor = Math.min(hero.maxArmor, hero.armor + healed);
    addFloatText(player.x, 4, PLAYER_Z - 2, `战地维修 +${healed}`, "#7ff0b0", 4.4);
  }
  // Boss reward: permanent-for-run fire-rate kick (single-rifle power curve).
  // Boss 奖励：攻速 + 攻击；当场与后续小怪会按新火力变硬
  player.fireRateMul = Math.max(.42, player.fireRateMul * .88);
  player.damageBonus = Math.min(.8, player.damageBonus + .06);
  retuneLivingEnemies();
  const bossXp = 45 + defeated.number * 18;
  grantHeroXp(bossXp, player.x, PLAYER_Z - 5);
  // 打完公路五害(第5)：一次性大额经验冲刺司令，好开终焉王（绕过日常 damp）
  if (!endlessMode && defeated.number === 5 && player.level < MAX_RANK) {
    const catchUp = Math.max(200, (MAX_RANK - player.level) * 180);
    player.xp += catchUp;
    addFloatText(player.x, 4.0, PLAYER_Z - 3.5, `经验 +${catchUp}`, "#b8f58b", 5.2);
    processRankProgress();
    addFloatText(0, 5.8, -12, "五害已灭 · 冲刺司令开终焉!", "#ffd86b", 6.4);
  }
  if (defeated.def.theme === "final") {
    addFloatText(player.x, 5.2, PLAYER_Z - 5, "终焉王击破!", "#ffd86b", 6.5);
  } else {
    addFloatText(player.x, 5.2, PLAYER_Z - 5, "Boss击破 · 攻速/攻击提升!", "#8fd9ff", 6.2);
  }
  flashScreen(defeated.def.theme === "final" ? "#ffd86b" : "#8fd9ff", .35);
  if (player.level < MAX_RANK) {
    addFloatText(player.x, 4.2, PLAYER_Z - 3, `军衔 ${rankName(player.level)} ${player.level}/${MAX_RANK}`, "#b8f58b", 4.6);
  }
  addImpactRing(0, .08, -22, defeated.def.accent, 8);
  addShake(.45);
  spawnEnemyCd = 150; spawnCrateCd = 100; spawnGateCd = 360; spawnTrapCd = 300;

  killsAtLastBoss = kills;
  lastBossClearDistance = distance;
  bossWarning = false;
  // 战役终点:终焉王(第6)后弹出胜利
  if (!endlessMode && bossCount >= CAMPAIGN_BOSS_COUNT) {
    openCampaignVictory();
    return;
  }
  const nextReq = currentBossRequirement();
  if (endlessMode) {
    addFloatText(0, 5.5, -10, `无尽第 ${bossCount} 战通过!`, "#ffd86b", 6);
    if (nextReq) {
      const tip = player.level >= nextReq.rank
        ? `下战 · 再前进约 ${Math.max(50, Math.ceil((nextReq.minDistance || 0) - distance))}m`
        : `下战 · 升到 ${rankName(nextReq.rank)}`;
      addFloatText(0, 4.4, -8, tip, "#ffcc80", 5.2);
    }
  } else {
    const label = bossCount >= 5 ? `终焉试炼 · ${bossCount}/${CAMPAIGN_BOSS_COUNT}` : `战役 ${bossCount}/5`;
    addFloatText(0, 5.5, -10, label, "#ffe27a", 5.5);
    if (nextReq) {
      const tip = nextReq.rank >= MAX_RANK
        ? `终焉王 · 升到 ${rankName(nextReq.rank)}`
        : `下 Boss · 升到 ${rankName(nextReq.rank)}`;
      addFloatText(0, 4.4, -8, tip, "#b8f58b", 5.4);
    }
  }
}

function shatterBoss(target) {
  const p = target.mesh.position;
  addParticles(p.x, 2.5, p.z, target.def.accent, mobileDevice ? 50 : 75, .62);
  addParticles(p.x, 2.0, p.z, "#ffdf8a", mobileDevice ? 28 : 42, .5);
  addSparks(p.x, 2.4, p.z, target.def.accent, mobileDevice ? 24 : 46, .66);
  addSparks(p.x, 1.8, p.z, 0xffe9a8, mobileDevice ? 16 : 30, .5);
  addSmoke(p.x, 2.2, p.z, 6, 2.2);
  addShockwave(p.x, .1, p.z, target.def.accent, 6.5);
  addGlowGhost(p.x, 2.4, p.z, 0xffffff, 7);
}

function disposeBossHazard(h) {
  scene.remove(h.mesh);
  h.mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
  });
  h.materials.forEach(m => m.dispose());
}

function disposeBossProjectile(projectile) {
  scene.remove(projectile.mesh);
  projectile.mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

function bossHazardMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
}

function launchBossProjectile(kind, x, z, life = 60) {
  if (!boss) return;
  const accent = boss.def.accent;
  const color =
    kind === "beam" ? 0xff4560 :
    kind === "shell" ? 0xffc44f :
    kind === "shock" ? 0x8de8ff :
    kind === "lock" ? 0xd8a5ff :
    kind === "rain" ? 0xff9d5c :
    kind === "ring" ? 0x72f5ff :
    accent;
  const mesh = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color, depthTest: false, toneMapped: false });
  const shellMat = new THREE.MeshBasicMaterial({
    color: 0xffe0a0, transparent: true, opacity: .82, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  let body;
  if (kind === "beam") body = new THREE.Mesh(new THREE.BoxGeometry(1.25, .38, 5.2), coreMat);
  else if (kind === "shell") body = new THREE.Mesh(new THREE.SphereGeometry(.95, 12, 10), coreMat);
  else if (kind === "shock") body = new THREE.Mesh(new THREE.TorusGeometry(1.1, .18, 8, 20), coreMat);
  else if (kind === "lock") body = new THREE.Mesh(new THREE.ConeGeometry(.55, 1.8, 8), coreMat);
  else if (kind === "ring") body = new THREE.Mesh(new THREE.TorusGeometry(1.3, .14, 8, 24), coreMat);
  else body = new THREE.Mesh(new THREE.SphereGeometry(.72, 14, 10), coreMat);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(kind === "shell" ? 1.25 : .95, 12, 8), shellMat);
  body.renderOrder = glow.renderOrder = 8;
  mesh.add(body, glow);
  if (kind === "rain" || kind === "lock") {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(.45, 2.1, 10), shellMat);
    tail.rotation.x = Math.PI / 2; tail.position.z = 1.2; tail.renderOrder = 8;
    mesh.add(tail);
  }
  mesh.position.copy(boss.mesh.position).add(new THREE.Vector3(0, 2.15, -1.2));
  mesh.lookAt(x, .2, z);
  scene.add(mesh);
  bossProjectiles.push({ kind, x, z, mesh, coreMat, shellMat, life, maxLife: life });
}

/**
 * Hazard kinds (each boss uses a distinct mix):
 * beam  - long lane telegraph (tank / energy)
 * shell - large artillery circle (tank)
 * shock - wide frontal shockwave (shield)
 * lock  - tracks player then freezes (sniper)
 * rain  - scatter missile point (rocket)
 * gap   - carpet with safe gap (rocket)
 * ring  - expanding ring (energy)
 */
function createBossHazard(kind, x, z = -9, timer = 70, extra = {}) {
  const mesh = new THREE.Group();
  const materials = [];
  const accent = boss?.def?.accent || 0xff5a2e;
  const addGround = (geometry, color, opacity, y = 0) => {
    const material = bossHazardMaterial(color, opacity);
    const marker = new THREE.Mesh(geometry, material);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = y;
    marker.renderOrder = 3;
    mesh.add(marker); materials.push(material);
    return marker;
  };

  let core;
  let radius = 1.55;
  let halfWidth = 1.6;
  if (kind === "beam") {
    halfWidth = extra.halfWidth || 1.55;
    core = addGround(new THREE.PlaneGeometry(halfWidth * 2, 36), 0xff263d, .34);
    addGround(new THREE.PlaneGeometry(.14, 35), 0xffe36a, .85, .012).position.x = -halfWidth + .08;
    addGround(new THREE.PlaneGeometry(.14, 35), 0xffe36a, .85, .012).position.x = halfWidth - .08;
  } else if (kind === "shell") {
    radius = extra.radius || 2.15;
    core = addGround(new THREE.CircleGeometry(radius, 36), 0xffc44f, .42);
    addGround(new THREE.RingGeometry(radius * .72, radius, 36), 0xffe28a, .9, .018);
  } else if (kind === "shock") {
    halfWidth = extra.halfWidth || 3.4;
    core = addGround(new THREE.PlaneGeometry(halfWidth * 2, 8.5), 0x8de8ff, .4);
    addGround(new THREE.RingGeometry(1.1, 1.55, 28), 0xb8f4ff, .85, .02);
    z = PLAYER_Z - .2;
  } else if (kind === "lock") {
    radius = extra.radius || 1.25;
    core = addGround(new THREE.CircleGeometry(radius, 28), 0xd8a5ff, .4);
    addGround(new THREE.RingGeometry(radius * .7, radius, 28), 0xf0d6ff, .95, .02);
    const cross = addGround(new THREE.PlaneGeometry(.12, radius * 1.8), 0xffffff, .7, .03);
    const cross2 = addGround(new THREE.PlaneGeometry(radius * 1.8, .12), 0xffffff, .7, .03);
    mesh.userData.cross = [cross, cross2];
  } else if (kind === "rain") {
    radius = extra.radius || 1.35;
    core = addGround(new THREE.CircleGeometry(radius, 28), 0xff9d5c, .44);
    addGround(new THREE.RingGeometry(radius * .75, radius, 28), 0xffd08a, .9, .018);
  } else if (kind === "gap") {
    // Full road carpet with a safe gap around x
    const safe = extra.safeHalf || 1.7;
    halfWidth = ROAD_HALF;
    const leftW = Math.max(.4, x + ROAD_HALF - safe);
    const rightW = Math.max(.4, ROAD_HALF - x - safe);
    if (leftW > .5) {
      const left = addGround(new THREE.PlaneGeometry(leftW, 10), 0xff7043, .36);
      left.position.x = -ROAD_HALF + leftW / 2 - x;
    }
    if (rightW > .5) {
      const right = addGround(new THREE.PlaneGeometry(rightW, 10), 0xff7043, .36);
      right.position.x = ROAD_HALF - rightW / 2 - x;
    }
    core = addGround(new THREE.PlaneGeometry(safe * 2, 10), 0x66bb6a, .18);
    z = PLAYER_Z;
  } else if (kind === "ring") {
    radius = extra.radius || 2.4;
    core = addGround(new THREE.RingGeometry(radius * .55, radius, 40), 0x72f5ff, .55);
    addGround(new THREE.RingGeometry(radius * .9, radius, 40), 0xb8ffff, .9, .02);
    x = 0; z = PLAYER_Z;
  } else {
    radius = 1.5;
    core = addGround(new THREE.CircleGeometry(radius, 28), accent, .4);
  }

  if (kind !== "gap" && kind !== "beam" && kind !== "shock") {
    const beaconMat = bossHazardMaterial(0xffd168, .9);
    const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(.22, 1), beaconMat);
    beacon.position.y = .36; beacon.renderOrder = 4;
    mesh.add(beacon); materials.push(beaconMat);
    mesh.userData.beacon = beacon;
  }

  mesh.position.set(x, .06, z);
  scene.add(mesh);
  bossHazards.push({
    kind, x, z, mesh, core, materials, timer, maxTimer: timer,
    radius, halfWidth, safeHalf: extra.safeHalf || 0,
    track: kind === "lock", trackT: kind === "lock" ? Math.floor(timer * .55) : 0,
    resolved: false,
  });
}

/* Boss 攻击:预警地标 → 弹体/结算。每位 Boss 主招式不同 */
const BOSS_WINDUP = 30;
const BOSS_FLIGHT = { beam: 56, shell: 48, shock: 36, lock: 44, rain: 50, gap: 40, ring: 42 };
function queueBossShot(kind, x, z, timer, extra) {
  createBossHazard(kind, x, z, timer, extra);
  boss.pendingShots.push({ kind, x, z, life: BOSS_FLIGHT[kind] || 50 });
}

/** Boss 招式必须留出可站立的安全带（约 2.2 宽），避免“全路封死无法躲”。 */
function bossSafeLane(preferX = player.x) {
  const lanes = [-5, -2.5, 0, 2.5, 5];
  let best = lanes[0], bestD = Infinity;
  for (const lane of lanes) {
    const d = Math.abs(lane - preferX);
    if (d < bestD) { bestD = d; best = lane; }
  }
  // Bias away from the player so the safe lane is readable as a dodge target.
  const away = preferX >= 0 ? -1 : 1;
  return clamp(best + away * (Math.random() < .55 ? 2.5 : 0), -5, 5);
}

function launchBossAttack() {
  if (!boss) return;
  const core = boss.mesh.userData.bossCore;
  if (core) core.scale.setScalar(1.35);
  addParticles(boss.mesh.position.x, 3.4, boss.mesh.position.z + 1, boss.def.accent, mobileDevice ? 8 : 12, .24);
  addImpactRing(boss.mesh.position.x, .2, boss.mesh.position.z + 1, boss.def.accent, 4.2);
  addShake(.16);
  const phase = boss.phase || 1;
  const pattern = boss.attackIndex % 3;
  boss.pendingShots = [];
  const px = player.x;
  const safe = bossSafeLane(px);

  switch (boss.def.theme) {
    case "tank": {
      // Always leave the safe lane open; never double-beam + center shell that seals the road.
      if (pattern === 0) {
        queueBossShot("beam", clamp(Math.round(px / 4) * 4, -4, 4), -12, BOSS_WINDUP + BOSS_FLIGHT.beam, { halfWidth: 1.35 });
        if (phase >= 2 && Math.abs(safe) > 1.5) {
          queueBossShot("shell", clamp(-safe, -5, 5), PLAYER_Z, BOSS_WINDUP + 10 + BOSS_FLIGHT.shell, { radius: 1.55 });
        }
        addFloatText(safe, 4, -10, "压路炮 · 闪到空档!", "#ffc75f", 5);
      } else if (pattern === 1) {
        const shells = phase >= 3 ? 3 : 2;
        for (let i = 0; i < shells; i++) {
          let sx = clamp(px + rand(-4.5, 4.5), -5.5, 5.5);
          if (Math.abs(sx - safe) < 2.2) sx = clamp(safe + (sx >= safe ? 2.6 : -2.6), -5.5, 5.5);
          queueBossShot("shell", sx, PLAYER_Z + rand(-.8, 1.2), BOSS_WINDUP + 10 * i + BOSS_FLIGHT.shell, { radius: 1.55 + phase * .08 });
        }
        addFloatText(safe, 4, -8, "阵地炮 · 绿侧安全!", "#ffb74d", 5);
      } else {
        // Two outer beams; center is the safe corridor.
        queueBossShot("beam", -4.2, -12, BOSS_WINDUP + BOSS_FLIGHT.beam, { halfWidth: 1.25 });
        queueBossShot("beam", 4.2, -12, BOSS_WINDUP + BOSS_FLIGHT.beam, { halfWidth: 1.25 });
        addFloatText(0, 4, -8, "夹击炮线 · 走中间!", "#ffd06b", 5.1);
      }
      break;
    }
    case "shield": {
      if (pattern === 0) {
        queueBossShot("shock", clamp(px, -4, 4), PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.shock, { halfWidth: 2.0 + phase * .2 });
        addFloatText(safe, 4, -8, "铁饼冲撞 · 闪左右!", "#8de8ff", 5.2);
      } else if (pattern === 1) {
        // Left then right waves with gap in the middle — never a third center seal.
        queueBossShot("shock", -4.2, PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.shock, { halfWidth: 1.9 });
        queueBossShot("shock", 4.2, PLAYER_Z, BOSS_WINDUP + 14 + BOSS_FLIGHT.shock, { halfWidth: 1.9 });
        addFloatText(0, 4, -8, "盾震波 · 站中间空档!", "#91efff", 5);
      } else {
        queueBossShot("shock", clamp(px, -3.5, 3.5), PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.shock, { halfWidth: 2.4 });
        if (phase >= 2) {
          const far = px >= 0 ? -4.5 : 4.5;
          queueBossShot("shell", far, PLAYER_Z, BOSS_WINDUP + 8 + BOSS_FLIGHT.shell, { radius: 1.4 });
        }
        addFloatText(safe, 4, -8, "铁饼横扫 · 侧移!", "#a5f0ff", 5);
      }
      break;
    }
    case "sniper": {
      if (pattern === 0 || pattern === 2) {
        // One tracking lock (two on phase 3) — never a wall of locks.
        const locks = phase >= 3 ? 2 : 1;
        for (let i = 0; i < locks; i++) {
          const lx = locks === 1 ? px : px + (i === 0 ? -.9 : .9);
          queueBossShot("lock", lx, PLAYER_Z, BOSS_WINDUP + 8 * i + BOSS_FLIGHT.lock, { radius: 1.05 });
        }
        addFloatText(0, 4, -10, locks > 1 ? "双红点 · 侧移躲开!" : "红点锁定 · 快躲开!", "#ff8fb8", 5.2);
      } else {
        const slots = [-5.5, -2, 2, 5.5];
        const safeSlot = slots.reduce((best, x) => Math.abs(x - safe) < Math.abs(best - safe) ? x : best, slots[0]);
        slots.forEach(x => {
          if (x !== safeSlot) queueBossShot("lock", x, PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.lock, { radius: 1.0 });
        });
        addFloatText(safeSlot, 4, -8, "安全节点在这边!", "#ff6b9d", 5.2);
      }
      break;
    }
    case "rocket": {
      if (pattern === 0) {
        const rains = phase >= 3 ? 3 : 2;
        for (let i = 0; i < rains; i++) {
          let rx = rand(-5.5, 5.5);
          if (Math.abs(rx - safe) < 2.0) rx = clamp(safe + (rx >= safe ? 2.4 : -2.4), -5.5, 5.5);
          queueBossShot("rain", rx, PLAYER_Z + rand(-1, 1.2), BOSS_WINDUP + i * 9 + BOSS_FLIGHT.rain, { radius: 1.15 });
        }
        addFloatText(safe, 4, -8, "导弹雨 · 空档安全!", "#ffad69", 5);
      } else if (pattern === 1) {
        queueBossShot("gap", safe, PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.gap, { safeHalf: phase >= 3 ? 1.7 : 2.1 });
        addFloatText(safe, 4, -8, "地毯炸 · 钻绿色缺口!", "#ffd06b", 5.3);
      } else {
        for (let i = 0; i < 2; i++) {
          let rx = clamp(px + rand(-3.5, 3.5), -5.5, 5.5);
          if (Math.abs(rx - safe) < 2.0) rx = clamp(safe + (i === 0 ? 2.5 : -2.5), -5.5, 5.5);
          queueBossShot("rain", rx, PLAYER_Z, BOSS_WINDUP + i * 7 + BOSS_FLIGHT.rain, { radius: 1.2 });
        }
        if (phase >= 2) {
          queueBossShot("gap", safe, PLAYER_Z, BOSS_WINDUP + 14 + BOSS_FLIGHT.gap, { safeHalf: 1.9 });
        }
        addFloatText(safe, 4, -8, "将军齐射 · 跟缺口!", "#ff9d5c", 5);
      }
      break;
    }
    case "final": {
      // 终焉王：轮转五害招式，始终留空档
      const cycle = boss.attackIndex % 5;
      if (cycle === 0) {
        queueBossShot("beam", clamp(Math.round(px / 4) * 4, -4, 4), -12, BOSS_WINDUP + BOSS_FLIGHT.beam, { halfWidth: 1.3 });
        if (phase >= 2) queueBossShot("shell", clamp(-safe, -5, 5), PLAYER_Z, BOSS_WINDUP + 8 + BOSS_FLIGHT.shell, { radius: 1.5 });
        addFloatText(safe, 4, -10, "终焉压路 · 闪空档!", "#ffd86b", 5.2);
      } else if (cycle === 1) {
        queueBossShot("shock", -4.0, PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.shock, { halfWidth: 1.85 });
        queueBossShot("shock", 4.0, PLAYER_Z, BOSS_WINDUP + 12 + BOSS_FLIGHT.shock, { halfWidth: 1.85 });
        addFloatText(0, 4, -8, "终焉盾波 · 走中间!", "#ffd86b", 5);
      } else if (cycle === 2) {
        queueBossShot("lock", px, PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.lock, { radius: 1.05 });
        if (phase >= 2) queueBossShot("lock", clamp(px + (px >= 0 ? -2.2 : 2.2), -5, 5), PLAYER_Z, BOSS_WINDUP + 10 + BOSS_FLIGHT.lock, { radius: 1.0 });
        addFloatText(0, 4, -10, "终焉红点 · 侧移!", "#ffd86b", 5.2);
      } else if (cycle === 3) {
        queueBossShot("gap", safe, PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.gap, { safeHalf: 1.85 });
        if (phase >= 2) {
          let rx = clamp(px + rand(-3, 3), -5.5, 5.5);
          if (Math.abs(rx - safe) < 2) rx = clamp(safe + 2.6, -5.5, 5.5);
          queueBossShot("rain", rx, PLAYER_Z, BOSS_WINDUP + 8 + BOSS_FLIGHT.rain, { radius: 1.15 });
        }
        addFloatText(safe, 4, -8, "终焉地毯 · 钻绿缺口!", "#ffd86b", 5.3);
      } else {
        queueBossShot("ring", 0, PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.ring, { radius: 2.1 + phase * .2 });
        addFloatText(0, 4, -8, "终焉扩环 · 环外/圆心!", "#ffd86b", 5.2);
      }
      break;
    }
    case "energy":
    default: {
      // 棱镜: one readable threat at a time + always a standable lane
      if (pattern === 0) {
        queueBossShot("beam", px > 0 ? 3.2 : -3.2, -12, BOSS_WINDUP + BOSS_FLIGHT.beam, { halfWidth: 1.2 });
        if (phase >= 3) queueBossShot("shell", clamp(-px, -4.5, 4.5), PLAYER_Z, BOSS_WINDUP + 12 + BOSS_FLIGHT.shell, { radius: 1.4 });
        addFloatText(safe, 4, -10, "棱镜光刀 · 闪到空档!", "#72f5ff", 5);
      } else if (pattern === 1) {
        queueBossShot("ring", 0, PLAYER_Z, BOSS_WINDUP + BOSS_FLIGHT.ring, { radius: 2.0 + phase * .25 });
        addFloatText(0, 4, -8, "扩环 · 站到环外或圆心!", "#79fbff", 5.2);
      } else {
        queueBossShot("beam", -4.8, -12, BOSS_WINDUP + BOSS_FLIGHT.beam, { halfWidth: 1.1 });
        queueBossShot("beam", 4.8, -12, BOSS_WINDUP + 6 + BOSS_FLIGHT.beam, { halfWidth: 1.1 });
        addFloatText(0, 4, -8, "棱镜栅栏 · 走中间!", "#5ee7ff", 5);
      }
    }
  }

  boss.windupT = BOSS_WINDUP;
  boss.attackIndex++;
  // More recovery time between telegraphs so the safe lane is readable.
  boss.attackCd = Math.max(110, 230 - boss.number * 5 - (phase - 1) * 18);
}

function hitByBossHazard(h, p) {
  if (h.kind === "beam") return Math.abs(p.x - h.x) < h.halfWidth && p.z < 4;
  if (h.kind === "shock") return Math.abs(p.x - h.x) < h.halfWidth && Math.abs(p.z - PLAYER_Z) < 2.4;
  if (h.kind === "gap") return Math.abs(p.x - h.x) > h.safeHalf && Math.abs(p.z - PLAYER_Z) < 2.2;
  if (h.kind === "ring") {
    const d = Math.hypot(p.x - h.x, p.z - h.z);
    return d > h.radius * .55 && d < h.radius + .35;
  }
  // shell / lock / rain
  const dx = p.x - h.x, dz = p.z - h.z;
  return dx * dx + dz * dz < h.radius * h.radius;
}

function resolveBossHazard(h) {
  let hits = 0;
  const unit = heroUnit();
  if (unit) {
    const p = unit.mesh.position;
    if (hitByBossHazard(h, p)) {
      hits++;
      const dmg = (h.kind === "shock" || h.kind === "shell" ? 14 : 11) + (boss?.number || 1) * 2;
      hurtHero(dmg, "Boss技能命中!", "#ff5264", true, ARMOR_SHARES.boss, "boss");
      addParticles(p.x, 1.1, p.z, "#ff5b68", 16, .34);
    }
  }
  if (hits) {
    player.hurtT = 18; addShake(.32); flashScreen("#ff4f58", .34);
    addShockwave(h.x, .08, h.z, boss?.def?.accent || 0xff4c5d, h.kind === "beam" ? 4 : 2.6);
  } else {
    addImpactRing(h.x, .08, h.z, boss?.def?.accent || 0xff914d, h.kind === "ring" ? 4 : 2.2);
  }
}

function spawnBossMinions() {
  const count = Math.min(2 + Math.ceil((boss?.number || 1) / 2), 6);
  for (let i = 0; i < count; i++) {
    const hp = spawnEnemyHp("normal", .65);
    const mesh = makeSoldier(0xc83b42, "rifle", 1);
    mesh.position.set(rand(-6, 6), 0, -42 - rand(0, 8)); mesh.rotation.y = Math.PI; scene.add(mesh);
    const e = { id: nextEnemyId++, mesh, hp, maxHp: hp, type: "normal", speed: .11 + (boss?.number || 1) * .008, radius: .75, score: 25, contactDmg: DAMAGE_VALUES.normal, attackCd: 0 };
    attachHpLabel(e); enemies.push(e);
  }
}

function updateBoss(t) {
  if (!boss) return;
  const timeMul = player.slowT > 0 ? .45 : 1;
  boss.mesh.position.z += (-27 - boss.mesh.position.z) * .025;
  boss.mesh.position.x = Math.sin(t * .7) * 2.2;
  animateWalk(boss.mesh, t, 4.5, .24);
  if (boss.mesh.userData.bossCore) boss.mesh.userData.bossCore.scale.setScalar(1 + Math.sin(t * 7) * .18);
  if (boss.mesh.userData.energyRings) boss.mesh.userData.energyRings.forEach((ring, index) => {
    ring.rotation.x += .018 + index * .006;
    ring.rotation.z -= .024 + index * .004;
  });
  if (boss.introT > 0) { boss.introT--; return; }
  if (boss.windupT > 0) {
    /* 蓄力相位:核心充能膨胀 + 能量火花涌动,冷却暂停(打完这轮才计时) */
    boss.windupT -= timeMul;
    const chargeK = 1 - Math.max(0, boss.windupT) / BOSS_WINDUP;
    if (boss.mesh.userData.bossCore) boss.mesh.userData.bossCore.scale.setScalar(1.1 + chargeK * 1.9 + Math.sin(t * 26) * .16);
    if (frame % 4 === 0) addSparks(boss.mesh.position.x + rand(-1.5, 1.5), rand(2.2, 4.4), boss.mesh.position.z + rand(-.5, 1.5), boss.def.accent, 2, .12);
    if (boss.windupT <= 0) {
      /* 打击瞬间:按当前预警位置发射(锁定类会跟着玩家更新) */
      boss.pendingShots = null;
      for (const h of bossHazards) {
        if (h.resolved || h.timer <= 0) continue;
        launchBossProjectile(h.kind, h.x, h.z, Math.max(12, Math.min(BOSS_FLIGHT[h.kind] || 48, h.timer + 4)));
      }
      addShake(.32); triggerHitStop(2);
      flashScreen(`#${boss.def.accent.toString(16).padStart(6, "0")}`, .28);
      addGlowGhost(boss.mesh.position.x, 2.6, boss.mesh.position.z, boss.def.accent, 4.5);
      addSparks(boss.mesh.position.x, 2.6, boss.mesh.position.z, boss.def.accent, mobileDevice ? 8 : 14, .4);
    }
  } else {
    boss.attackCd -= timeMul;
    if (boss.attackCd <= 0) launchBossAttack();
  }
  const ratio = boss.hp / boss.maxHp;
  if (ratio <= .7 && boss.phase < 2) announceBossPhase(2);
  if (ratio <= .4 && boss.phase < 3) announceBossPhase(3);
  if (!boss.summoned65 && ratio <= .65) { boss.summoned65 = true; if (boss.phase < 2) spawnBossMinions(); }
  if (!boss.summoned35 && ratio <= .35) { boss.summoned35 = true; if (boss.phase < 3) spawnBossMinions(); }

  for (const h of bossHazards) {
    h.timer -= timeMul;
    // Sniper lock: track player for the first half, then freeze.
    if (h.track && h.trackT > 0) {
      h.trackT -= timeMul;
      h.x += (player.x - h.x) * .12;
      h.z += (PLAYER_Z - h.z) * .08;
      h.mesh.position.x = h.x;
      h.mesh.position.z = h.z;
    }
    const k = Math.max(0, h.timer / h.maxTimer);
    const pulse = .72 + Math.sin(h.timer * .55) * .2 + (1 - k) * .28;
    h.materials.forEach(m => { if (m) m.opacity = Math.min(1, pulse); });
    if (h.core?.material) h.core.material.opacity = Math.min(.78, .25 + (1 - k) * .58);
    if (h.kind === "ring") h.mesh.scale.setScalar(.65 + (1 - k) * 1.1);
    else h.mesh.scale.setScalar(1 + (1 - k) * .1);
    if (h.mesh.userData.beacon) {
      const beacon = h.mesh.userData.beacon;
      beacon.rotation.y += .16 * timeMul;
      beacon.scale.setScalar(.7 + (1 - k) * .85 + Math.sin(h.timer * .45) * .16);
    }
    if (h.timer <= 0 && !h.resolved) { h.resolved = true; resolveBossHazard(h); }
  }
  compactInPlace(bossHazards, h => {
    if (h.timer > 0) return true;
    disposeBossHazard(h);
    return false;
  });

  for (const projectile of bossProjectiles) {
    const progress = 1 - projectile.life / projectile.maxLife;
    projectile.mesh.position.lerp(new THREE.Vector3(projectile.x, .28, projectile.z), .13 + progress * .06);
    projectile.mesh.rotateZ(.18);
    projectile.shellMat.opacity = .48 + Math.sin(t * 18) * .24;
    projectile.mesh.scale.setScalar(1 + progress * .75);
    if (frame % 2 === 0) {
      const bp = projectile.mesh.position;
      addGlowGhost(bp.x, bp.y, bp.z, boss.def.accent, 1.1);
    }
    projectile.life -= timeMul;
  }
  compactInPlace(bossProjectiles, projectile => {
    if (projectile.life > 0) return true;
    addParticles(projectile.x, .9, projectile.z, "#ffb05c", mobileDevice ? 10 : 16, .35);
    addSparks(projectile.x, 1.0, projectile.z, boss.def.accent, mobileDevice ? 6 : 12, .4);
    addSmoke(projectile.x, 1.2, projectile.z, 2, 1.0);
    addShockwave(projectile.x, .1, projectile.z, boss.def.accent, 2.6);
    disposeBossProjectile(projectile);
    return false;
  });
}

/* ================= 更新 ================= */
function update() {
  frame++;
  enforceSingleHero();
  const t = frame / 60;
  if (boss) worldSpeed = .06;
  else {
    distance += worldSpeed;
    worldSpeed = 0.25 + distance / 9000;
    if (eventHordeT > 0) {
      eventHordeT--;
      worldSpeed *= 1.08;
    }
    // Boss 只按军衔召唤
    if (!boss && bossWarning && bossSummonCd > 0) {
      bossSummonCd--;
      if (bossSummonCd <= 0 && !uiPaused && !player.pendingPromotion) beginBossBattle();
      else if (bossSummonCd <= 0) bossSummonCd = 20; // wait until skill UI closes
    } else if (!boss && !bossWarning && bossProgressReady()) {
      trySummonBoss("军衔达标");
    } else if (!boss && !bossWarning && bossProgressNear() && frame % 120 === 0) {
      const req = currentBossRequirement();
      if (req) addFloatText(0, 5.6, -16, `Boss 将近 · 升到 ${rankName(req.rank)}`, "#ffd27a", 4.6);
    }
    if (!boss && !bossWarning && distance >= nextEventAt) {
      triggerRunEvent();
    }
  }
  groundTex.offset.y += worldSpeed / 30;
  weather.update(distance);
  updateRain();
  updatePlayerMines();
  updateSalvoSupport();
  speedFxEl.style.opacity = critT > 0 ? ".16" : combo >= 5 ? ".09" : "0";

  /* 树木循环 */
  for (const tr of trees) {
    tr.position.z += worldSpeed;
    tr.rotation.z = Math.sin(t * .8 + tr.userData.phase) * .012;
    if (tr.position.z > 14) {
      tr.position.z = -125;
      const side = Math.random() < 0.5 ? -1 : 1;
      tr.position.x = side * (ROAD_HALF + 2.5 + Math.random() * 5);
    }
  }

  /* 玩家移动 */
  const prevX = player.x;
  const moveMul = player.moveSlowT > 0 ? .55 : 1;
  // Slightly slower lateral move so dodging is deliberate, not twitchy.
  if (keys["arrowleft"]  || keys["a"]) { player.tx = null; player.x -= 0.14 * moveMul; }
  if (keys["arrowright"] || keys["d"]) { player.tx = null; player.x += 0.14 * moveMul; }
  if (player.tx != null) player.x += (player.tx - player.x) * 0.12 * moveMul;
  const margin = squadHalfWidth() + 0.7;
  player.x = clamp(player.x, -ROAD_HALF + margin, ROAD_HALF - margin);
  player.vx += ((player.x - prevX) - player.vx) * .28;

  /* 小队位置与动画 */
  const pos = squadPositions();
  player.soldiers.forEach((unit, i) => {
    const s = unit.mesh;
    s.position.x += (pos[i].x - s.position.x) * 0.35;
    s.position.z += (pos[i].z - s.position.z) * .28;
    animateWalk(s, t, 10.5, .58, clamp(player.vx * 4, -.9, .9));
  });
  if (player.hurtT > 0) {
    player.hurtT--;
    const on = player.hurtT > 0 && player.hurtT % 6 < 3;
    player.soldiers.forEach(unit => tintSoldier(unit.mesh, on ? 0x883333 : 0x000000));
  }

  /* buff 计时 */
  if (player.spreadT > 0) player.spreadT--;
  if (player.slowT > 0) player.slowT--;
  if (player.moveSlowT > 0) player.moveSlowT--;
  if (critT > 0) critT--;
  if (comboTimer > 0) { comboTimer--; if (comboTimer === 0) combo = 0; }   // 连杀超时归零
  shieldMesh.visible = player.shield > 0;
  if (shieldMesh.visible) {
    shieldMesh.position.set(player.x, 1.1, PLAYER_Z + 0.4);
    shieldMesh.scale.set(1 + squadHalfWidth() * 0.5, 1, 1.2);
    shieldMesh.material.opacity = 0.16 + Math.sin(t * 6) * 0.06;
  }

  /* 射击 */
  player.soldiers.forEach((unit, i) => {
    unit.fireCd--;
    if (unit.fireCd <= 0) fireUnitWeapon(unit, pos[i]);
  });
  updateDrones(t);

  /* 子弹 */
  for (const b of bullets) {
    b.mesh.position.z -= b.speed || 1.2;
    b.mesh.position.x += b.vx;
    if (frame % 2 === 0) {
      addTrailSeg(b.px, b.pz, b.mesh.position.x, b.mesh.position.z);
      b.px = b.mesh.position.x; b.pz = b.mesh.position.z;
    }
  }
  compactInPlace(bullets, b => {
    if (b.mesh.position.z < SPAWN_Z - 15 || b.dead) {
      bulletMeshPool.release(b.mesh);
      return false;
    }
    return true;
  });

  /* 生成 */
  spawnEnemyCd--;
  if (!boss && !bossWarning && spawnEnemyCd <= 0) {
    spawnEnemyGroup();
    const hordeBoost = eventHordeT > 0 ? .55 : 1;
    // Slower cadence while distance is low; ramps up after ~280.
    const baseGap = distance < 280 ? 145 - distance / 20 : 105 - distance / 15;
    spawnEnemyCd = Math.max(22, baseGap * hordeBoost);
  }
  spawnCrateCd--;
  if (!boss && !bossWarning && spawnCrateCd <= 0) {
    const side = Math.random() < .5 ? -1 : 1;
    crates.push(makeCrate(side < 0 ? rand(-ROAD_HALF + 1.6, -2.2) : rand(2.2, ROAD_HALF - 1.6), SPAWN_Z));
    spawnCrateCd = rand(280, 460);
  }
  spawnGateCd--;
  if (!boss && !bossWarning && spawnGateCd <= 0) {
    spawnGatePair();
    spawnGateCd = rand(650, 950);
  }
  spawnTrapCd--;
  if (!boss && !bossWarning && spawnTrapCd <= 0) {
    spawnTrapGroup();
    spawnTrapCd = Math.max(280, rand(420, 620) - distance / 30);
  }

  /* 选择门移动与穿门判定 */
  for (const g of gates) {
    g.group.position.z += worldSpeed;
    if (!g.used && g.group.position.z >= PLAYER_Z - 0.4) {
      g.used = true;
      const eff = player.x < 0 ? g.left : g.right;   // 按所在半边结算
      eff.apply();
      addFloatText(player.x, 4.2, -4, eff.text + "!", eff.css, 5.5);
      addParticles(player.x, 1.5, PLAYER_Z, eff.css, 20, 0.3);
      addImpactRing(player.x, .08, PLAYER_Z, eff.color, 3.8);
      flashScreen(eff.css, eff.good ? .24 : .38);
      if (!eff.good) addShake(0.18);                 // 踩坑反馈
    }
    g.mats.forEach((m, i) => {
      if (g.used) m.opacity = Math.max(0, m.opacity - 0.03);
      else m.opacity = (i % 2 === 0 ? .24 : .09) + Math.sin(t * 5 + g.phase + i) * .045;
    });
  }
  compactInPlace(gates, g => {
    if (g.group.position.z > 12) { disposeGate(g); return false; }
    return true;
  });

  /* 小范围陷阱 */
  for (const trap of traps) {
    trap.mesh.position.z += worldSpeed;
    trap.mesh.rotation.y += trap.type === "emp" ? .018 : 0;
    trap.groundMat.opacity = .22 + Math.sin(t * 7 + trap.mesh.position.x) * .1;
    if (trap.mesh.userData.beacon) {
      const beacon = trap.mesh.userData.beacon;
      beacon.scale.setScalar(.8 + Math.sin(t * (trap.fuse > 0 ? 24 : 7)) * .28);
    }
    if (trap.type === "mine" && trap.fuse < 0 && trap.mesh.position.z >= -8) trap.fuse = 30;
    if (trap.type === "mine" && trap.fuse > 0) trap.fuse--;
    if (trap.type === "mine" && trap.fuse === 0 && !trap.resolved) {
      trap.resolved = true;
      const p = trap.mesh.position;
      addParticles(p.x, .8, p.z, "#ff9b48", mobileDevice ? 22 : 34, .42);
      addImpactRing(p.x, .08, p.z, 0xff9b48, 3.2);
      addShake(.2);
      if (Math.abs(player.x - p.x) < trap.radius && Math.abs(p.z - PLAYER_Z) < 2.1) hurtHero(DAMAGE_VALUES.mine, "地雷命中", "#ff7043", true, ARMOR_SHARES.standard, "trap");
    }
    if (!trap.resolved && trap.type !== "mine" && Math.abs(trap.mesh.position.z - PLAYER_Z) < .85) {
      trap.resolved = true;
      if (Math.abs(player.x - trap.mesh.position.x) < trap.radius) {
        if (trap.type === "spikes") hurtHero(DAMAGE_VALUES.spikes, "地刺命中", "#ff7043", true, ARMOR_SHARES.standard, "trap");
        else {
          hurtHero(DAMAGE_VALUES.emp, "电磁命中", "#65d8ff", true, ARMOR_SHARES.standard, "trap");
          player.moveSlowT = Math.max(player.moveSlowT, 120);
          addFloatText(player.x, 4, PLAYER_Z - 1, "电磁减速 2秒", "#76efff", 4.1);
        }
      }
    }
  }
  compactInPlace(traps, trap => {
    if (trap.mesh.position.z > 12) { disposeTrap(trap); return false; }
    return true;
  });

  /* 敌人移动 */
  const slowMul = player.slowT > 0 ? 0.35 : 1;
  for (const e of enemies) {
    const gunnerHolding = e.type === "gunner" && e.mesh.position.z > -38;
    e.mesh.position.z += gunnerHolding ? worldSpeed * .04 : (e.speed * slowMul + worldSpeed * .5);
    e.mesh.position.x += Math.sin(t * 3 + e.mesh.userData.phase) * 0.015;
    animateWalk(e.mesh, t, 8, e.type === "heavy" ? .38 : .52);
    if (e.type === "gunner" && bossCount >= 2 && e.mesh.position.z > -64 && e.mesh.position.z < -12) {
      e.attackCd--;
      if (e.attackCd <= 0) {
        if (createEnemyAimHazard(e)) e.attackCd = rand(90, 150);
        else e.attackCd = 18;
      }
    }
  }
  updateEnemyAimHazards(t);
  updateBoss(t);
  /* 道具箱随卷轴前进 */
  for (const c of crates) {
    c.mesh.position.z += worldSpeed;
    c.mesh.position.y = 1 + Math.sin(t * 2.7 + c.phase) * .12;
    c.mesh.rotation.y += .012;
    if (c.pulse > 0) c.pulse--;
    const s = 1 + c.pulse * .018 + Math.sin(t * 4 + c.phase) * .012;
    c.mesh.scale.setScalar(s);
    c.glow.material.opacity = .15 + Math.sin(t * 4 + c.phase) * .06;
  }

  /* 奖励核心：大范围磁吸 + 靠近自动拾取（三箱并排也能一次扫光） */
  for (const core of rewardCores) {
    if (core.collected) continue;
    core.life--;
    core.mesh.position.z += worldSpeed;
    core.mesh.rotation.y += .05;
    const pulse = 1 + Math.sin(t * 6 + core.phase) * .09;
    core.mesh.scale.setScalar(pulse);
    const dx = player.x - core.mesh.position.x;
    const dz = PLAYER_Z - core.mesh.position.z;
    const distSq = dx * dx + dz * dz;
    const dist = Math.sqrt(distSq) || .001;
    // Auto-collect as soon as the core is roughly near the hero lane.
    if (dist <= core.pickupRadius) {
      core.collected = true;
      applyReward(core.reward, core.mesh.position.x, core.mesh.position.z);
      continue;
    }
    if (dist <= core.magnetRadius) {
      // Stronger pull the closer it is; multiple cores can chase the player at once.
      const pull = Math.min(.42, .12 + (1 - dist / core.magnetRadius) * .32);
      core.mesh.position.x += dx * pull;
      core.mesh.position.z += dz * pull;
      // Re-check after magnet step so same-frame multi-loot works.
      const ndx = player.x - core.mesh.position.x;
      const ndz = PLAYER_Z - core.mesh.position.z;
      if (ndx * ndx + ndz * ndz <= core.pickupRadius * core.pickupRadius) {
        core.collected = true;
        applyReward(core.reward, core.mesh.position.x, core.mesh.position.z);
      }
    }
  }
  compactInPlace(rewardCores, core => {
    if (core.collected || core.life <= 0 || core.mesh.position.z > 12) {
      disposeRewardCore(core);
      return false;
    }
    return true;
  });

  /* 子弹命中:按 Z 分桶减少子弹×敌人全量二重循环 */
  const enemyBuckets = new Map();
  for (const e of enemies) {
    if (e.dead) continue;
    const key = Math.floor(e.mesh.position.z / 4);
    let bucket = enemyBuckets.get(key);
    if (!bucket) { bucket = []; enemyBuckets.set(key, bucket); }
    bucket.push(e);
  }
  for (const b of bullets) {
    if (b.dead) continue;
    const bp = b.mesh.position;
    for (const c of crates) {
      if (c.count <= 0) continue;
      const cp = c.mesh.position;
      if (Math.abs(bp.x - cp.x) < 1.5 && Math.abs(bp.z - cp.z) < 1.3) {
        b.dead = true;
        c.count--;
        c.pulse = 6;
        drawCrateFace(c.g2d, c); c.tex.needsUpdate = true;
        addParticles(bp.x, bp.y, cp.z + 1.1, "#ffd54f", 4, 0.15);
        if (b.type === "rocket" || b.starburst) explodeProjectile(b, cp.x, cp.z);
        if (c.count <= 0) { spawnRewardCore(c); c.collected = true; }
        break;
      }
    }
    if (b.dead) continue;
    if (boss && !b.hitIds?.has("boss")) {
      const ep = boss.mesh.position;
      if (Math.abs(bp.x - ep.x) < 2.35 && Math.abs(bp.z - ep.z) < 2.5) {
        if (b.type === "rocket" || b.starburst) {
          b.dead = true;
          explodeProjectile(b, ep.x, ep.z, "boss");
        } else {
          b.hitIds?.add("boss");
          b.pierce--;
          if (b.pierce <= 0) b.dead = true;
          damageBoss(b.dmg, bp.x, bp.z);
        }
      }
    }
    if (b.dead) continue;
    const bKey = Math.floor(bp.z / 4);
    for (let bk = bKey - 1; bk <= bKey + 1; bk++) {
      const bucket = enemyBuckets.get(bk);
      if (!bucket) continue;
      for (const e of bucket) {
        if (e.dead || b.hitIds?.has(e.id)) continue;
        const ep = e.mesh.position;
        const r = e.radius;
        if (Math.abs(bp.x - ep.x) < r && Math.abs(bp.z - ep.z) < r + 0.3) {
          if (b.type === "rocket" || b.starburst) {
            b.dead = true;
            explodeProjectile(b, ep.x, ep.z, e.id);
            break;
          }
          b.hitIds?.add(e.id);
          b.pierce--;
          if (b.pierce <= 0) b.dead = true;
          let dmg = b.dmg;
          const critChance = Math.min(.75, skillLevel(player.skills, "critical") * .06 + (critT > 0 ? .35 : 0));
          const crit = Math.random() < critChance;
          if (crit) dmg *= 2;
          e.hp -= dmg;
          e.mesh.userData.hit = 1;
          drawHpLabel(e);
          const ty = e.type === "heavy" ? 4.4 : 3.0;
          if (crit) addFloatText(ep.x, ty, ep.z, "暴击 -" + dmg, "#ffb300", 3.6);
          else      addFloatText(ep.x, ty, ep.z, "-" + dmg, "#ff7043", 2.6);
          addParticles(bp.x, 1.1, bp.z, crit ? "#ffcf45" : "#ff685c", crit ? 8 : 4, 0.17);
          if (crit) addImpactRing(bp.x, 1.05, bp.z, 0xffc83d, 1.15);
          addShake(0.02);
          tryRicochet(e, dmg, b.hitIds);
          if (e.hp <= 0) killEnemy(e);
          break;
        }
      }
      if (b.dead) break;
    }
  }
  compactInPlace(bullets, b => {
    if (b.dead) { bulletMeshPool.release(b.mesh); return false; }
    return true;
  });
  compactInPlace(crates, c => {
    if (c.collected || c.mesh.position.z > 12) {
      disposeCrate(c);
      return false;
    }
    return true;
  });

  /* 敌人碰撞主角 */
  const hero = heroUnit();
  if (hero) {
    for (const e of enemies) {
      if (e.dead) continue;
      const ep = e.mesh.position;
      if (ep.z < PLAYER_Z - 1.6 || ep.z > PLAYER_Z + 2.4) continue;
      const dx = ep.x - player.x, dz = ep.z - PLAYER_Z;
      if (dx * dx + dz * dz < 1.4) {
        e.dead = true;
        addParticles(ep.x, 1.2, ep.z, "#90caf9", 12, 0.3);
        hurtHero(e.contactDmg, "敌人撞击", "#ff5252", true, ARMOR_SHARES.standard, "contact");
      }
    }
  }
  compactInPlace(enemies, e => {
    if (e.dead || e.mesh.position.z > 10) { removeEnemy(e); return false; }
    return true;
  });

  if (player.soldiers.length <= 0 && running) { endGame(); return; }

  /* 弹道残影 / 枪口火光渐隐 */
  for (const s of trailFx) {
    s.life--;
    const k = Math.max(s.life / s.maxLife, 0);
    if (s.flash) s.mesh.scale.setScalar(s.w * k);
    else { s.mesh.scale.x = s.mesh.scale.y = s.w * k; }
  }
  compactInPlace(trailFx, s => {
    if (s.life > 0) return true;
    if (s.pooled === "trail") trailSegPool.release(s.mesh);
    else if (s.pooled === "muzzle") muzzleSpritePool.release(s.mesh);
    else if (s.pooled === "spark") sparkSpritePool.release(s.mesh);
    else scene.remove(s.mesh);
    return false;
  });

  /* 冲击波 */
  for (const fx of impactFx) {
    fx.life--;
    const k = Math.max(fx.life / fx.maxLife, 0);
    const progress = 1 - k;
    fx.mesh.scale.setScalar(.2 + progress * fx.size);
    fx.mesh.material.opacity = k * .72;
    fx.mesh.position.y += .004;
  }
  compactInPlace(impactFx, fx => {
    if (fx.life > 0) return true;
    impactRingPool.release(fx.mesh);
    return false;
  });

  /* 粒子：落地或寿命到立刻回收，防止「死后纸屑」挂在画面上 */
  for (const p of particles) {
    p.mesh.position.x += p.vx;
    p.mesh.position.y += p.vy;
    p.mesh.position.z += p.vz + worldSpeed * .35;
    p.mesh.rotation.x += p.rx || 0;
    p.mesh.rotation.y += p.ry || 0;
    p.mesh.rotation.z += p.rz || 0;
    p.mesh.scale.multiplyScalar(.94);
    p.vy -= 0.02;
    p.vx *= .97; p.vz *= .97;
    p.life--;
    if (p.mesh.position.y < 0) p.life = 0;
  }
  compactInPlace(particles, p => {
    if (p.life > 0 && p.mesh.scale.x > .08) return true;
    particleMeshPool.release(p.mesh);
    return false;
  });

  /* 火花 */
  for (const s of sparks) {
    s.mesh.position.x += s.vx;
    s.mesh.position.y += s.vy;
    s.mesh.position.z += s.vz;
    s.vy -= .02;
    s.vx *= .985; s.vz *= .985;
    s.mesh.scale.multiplyScalar(.93);
    s.life--;
  }
  compactInPlace(sparks, s => {
    if (s.life > 0 && s.mesh.position.y >= 0) return true;
    sparkSpritePool.release(s.mesh);
    return false;
  });

  /* 烟雾 */
  for (const s of smokes) {
    s.mesh.position.y += s.vy;
    s.mesh.scale.multiplyScalar(s.grow);
    s.life--;
    s.mat.opacity = Math.min(.34, s.life / s.maxLife * .4);
  }
  compactInPlace(smokes, s => {
    if (s.life > 0) return true;
    smokeSpritePool.release(s.mesh);
    return false;
  });

  /* 浮动文字 */
  for (const ft of floatTexts) {
    const age = ft.maxLife - ft.life;
    const q = Math.min(age / 8, 1);
    const pop = q < 1 ? 1 + 2.70158 * Math.pow(q - 1, 3) + 1.70158 * Math.pow(q - 1, 2) : 1;
    ft.sprite.scale.set(ft.baseScale.x * pop, ft.baseScale.y * pop, 1);
    ft.sprite.position.y += age < 10 ? .075 : .045;
    ft.life--;
    ft.sprite.material.opacity = clamp(ft.life / 30, 0, 1);
  }
  compactInPlace(floatTexts, ft => {
    if (ft.life > 0) return true;
    releaseFloatText(ft);
    return false;
  });

  /* 摄像机 trauma 震动:取平方 + 平滑正弦噪声,比白噪声抖动更有冲击感、不发"麻" */
  shake *= 0.82;
  if (shake < 0.002) shake = 0;
  const sh = shake * shake;
  const ox = (Math.sin(t * 57.1) + Math.sin(t * 29.3)) * .5 * sh * 1.35;
  const oy = (Math.sin(t * 61.7) + Math.sin(t * 31.9)) * .5 * sh * 1.2;
  cameraFollowX += (player.x * .11 - cameraFollowX) * .06;
  camera.position.set(
    cameraFollowX + ox,
    cameraBase.y + Math.sin(t * 3.5) * .025 + oy,
    cameraBase.z
  );
  camera.lookAt(cameraFollowX * .55, .35, cameraBase.lookZ);
  camera.rotation.z += Math.sin(t * 54.3) * sh * .028;

  if (screenFlashT > 0) screenFlashT--;
  screenFlashEl.style.opacity = String(Math.min(.42, screenFlashT / 12));

  score += worldSpeed * 0.15;
  if (frame % 6 === 0) updateHUD();
}

/* ================= HUD ================= */
const hScore = document.getElementById("hScore");
const hArmy  = document.getElementById("hArmy");
const hDist  = document.getElementById("hDist");
const hPower = document.getElementById("hPower");
const vitalsHudEl = document.getElementById("vitalsHud");
const healthTextEl = document.getElementById("healthText");
const healthFillEl = document.getElementById("healthFill");
const healthLagEl = document.getElementById("healthLag");
const armorTextEl = document.getElementById("armorText");
const armorFillEl = document.getElementById("armorFill");
const armorLagEl = document.getElementById("armorLag");
let healthLagRatio = 1, armorLagRatio = 1;
const buffsEl = document.getElementById("buffs");
const statusToggle = document.getElementById("statusToggle");
const statsPanel = document.getElementById("statsPanel");
const statsContent = document.getElementById("statsContent");
const statsClose = document.getElementById("statsClose");
const bossBarEl = document.getElementById("bossBar");
const bossNameEl = document.getElementById("bossName");
const bossFillEl = document.getElementById("bossFill");
const bossHpEl = document.getElementById("bossHp");
const rankBadgeEl = document.getElementById("rankBadge");
const choicePanelEl = document.getElementById("choicePanel");
const choiceTitleEl = document.getElementById("choiceTitle");
const choiceSubtitleEl = document.getElementById("choiceSubtitle");
const choiceGridEl = document.getElementById("choiceGrid");
const prestigePanelEl = document.getElementById("prestigePanel");
const prestigeNowEl = document.getElementById("prestigeNow");
const prestigeLaterEl = document.getElementById("prestigeLater");
const victoryPanelEl = document.getElementById("victoryPanel");
const victoryEndEl = document.getElementById("victoryEnd");
const victoryEndlessEl = document.getElementById("victoryEndless");
const victoryTitleEl = document.getElementById("victoryTitle");
const victorySubtitleEl = document.getElementById("victorySubtitle");
let uiPaused = false;
let currentSkillOptions = [];

function openSkillChoice() {
  player.pendingPromotion = true;
  uiPaused = true;
  clearInputState();
  currentSkillOptions = chooseSkillOptions(player.skills);
  choiceTitleEl.textContent = `${rankName(player.level)} 晋升`;
  choiceSubtitleEl.textContent = `选择一项自动生效的战斗技能 · 当前武器 ${WEAPON_DEFS[weaponForRank(player.level)].label}`;
  choiceGridEl.innerHTML = "";
  currentSkillOptions.forEach((skill, index) => {
    const nextLevel = skillLevel(player.skills, skill.id) + 1;
    const button = document.createElement("button");
    button.className = `skill-card ${skill.category}`;
    button.innerHTML = `<div class="icon">${skill.icon}</div><h3>${index + 1}. ${skill.name}</h3><p>${skill.description(nextLevel)}</p><div class="level">Lv.${nextLevel} / ${skill.maxLevel}</div>`;
    button.addEventListener("click", () => selectSkill(index));
    choiceGridEl.appendChild(button);
  });
  choicePanelEl.classList.remove("hidden");
}

let airstrikeResolving = false;
function triggerAirstrike(level) {
  if (airstrikeResolving) return;
  airstrikeResolving = true;
  const alive = [];
  for (const enemy of enemies) if (!enemy.dead) alive.push(enemy);
  alive.sort((a, b) => a.mesh.position.z - b.mesh.position.z);
  const targets = alive.slice(0, 2 + level * 2);
  addFloatText(player.x, 5.2, -8, "空袭支援!", "#ffb25f", 5.8);
  flashScreen("#ffb25f", .28); addShake(.3);
  for (const target of targets) {
    const p = target.mesh.position;
    addImpactRing(p.x, .08, p.z, 0xff9b48, 2.6 + level * .4);
    addParticles(p.x, 1, p.z, "#ff9b48", mobileDevice ? 16 : 26, .42);
    target.hp -= standardProjectileDamage() * (2 + level * 1.25);
    drawHpLabel(target);
    if (target.hp <= 0 && !target.dead) killEnemy(target);
  }
  if (boss) damageBoss(standardProjectileDamage() * (1.5 + level), boss.mesh.position.x, boss.mesh.position.z);
  airstrikeResolving = false;
}

function makeDrone(index) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x344d68, metalness: .55, roughness: .28 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x75ecff, toneMapped: false });
  const body = new THREE.Mesh(new THREE.SphereGeometry(.23, 10, 7), bodyMat);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 5), glowMat);
  eye.position.z = -.21;
  group.add(body, eye);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(.34, .055, .16), bodyMat);
    wing.position.x = side * .3; wing.rotation.z = side * .2; group.add(wing);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(.055, 7, 5), glowMat);
    tip.position.set(side * .48, 0, 0); group.add(tip);
  }
  group.userData.index = index;
  group.userData.fireCd = index * 12;
  scene.add(group);
  return group;
}

function syncDrones() {
  const wanted = skillLevel(player.skills, "drone");
  while (drones.length < wanted) drones.push(makeDrone(drones.length));
  while (drones.length > wanted) {
    const drone = drones.pop();
    scene.remove(drone);
    drone.traverse(object => { if (object.geometry) object.geometry.dispose(); if (object.material) object.material.dispose(); });
  }
}

function clearDrones() {
  while (drones.length) {
    const drone = drones.pop();
    scene.remove(drone);
    drone.traverse(object => { if (object.geometry) object.geometry.dispose(); if (object.material) object.material.dispose(); });
  }
}

function updateDrones(t) {
  if (!drones.length) return;
  const hero = heroUnit();
  if (!hero) return;
  drones.forEach((drone, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const tx = player.x + side * (1.35 + row * .6);
    const tz = PLAYER_Z + .65 + row * .55;
    drone.position.x += (tx - drone.position.x) * .15;
    drone.position.y = 1.55 + Math.sin(t * 5 + index * 2.1) * .16;
    drone.position.z += (tz - drone.position.z) * .15;
    drone.rotation.y += .06;
    drone.userData.fireCd--;
    if (drone.userData.fireCd > 0) return;
    drone.userData.fireCd = Math.max(24, 48 - skillLevel(player.skills, "drone") * 6);
    let target = boss;
    if (!target) {
      let bestZ = -Infinity;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        if (enemy.mesh.position.z > bestZ) { bestZ = enemy.mesh.position.z; target = enemy; }
      }
    }
    const targetPos = target?.mesh?.position || { x: drone.position.x, y: 0, z: -40 };
    const dz = Math.max(1, drone.position.z - targetPos.z);
    const vx = clamp((targetPos.x - drone.position.x) / (dz / 1.55), -.3, .3);
    const mesh = bulletMeshPool.acquire();
    mesh.visible = true;
    mesh.material = droneBulletMat;
    mesh.scale.set(.65, .65, 1.4);
    mesh.position.copy(drone.position); mesh.position.z -= .35;
    scene.add(mesh);
    bullets.push({ mesh, weaponId: "laser", type: "drone", vx, dmg: Math.max(.5, standardProjectileDamage() * .35), px: mesh.position.x, pz: mesh.position.z, speed: 1.55, pierce: 1, radius: 0, starburst: false, hitIds: new Set() });
  });
}

function selectSkill(index) {
  const skill = currentSkillOptions[index];
  if (!skill || !player.pendingPromotion) return;
  player.skills[skill.id] = skillLevel(player.skills, skill.id) + 1;
  const hero = heroUnit();
  if (hero && skill.id === "armor") {
    hero.maxArmor += 8;
    hero.armor = Math.min(hero.maxArmor, hero.armor + 8);
  }
  syncDrones();
  if (skill.id === "salvo") salvoCd = Math.min(salvoCd || 90, 90);
  const color = skill.category === "attack" ? 0xff754d : skill.category === "defense" ? 0x66e7ff : 0xbc8cff;
  addParticles(player.x, 1.5, PLAYER_Z, `#${color.toString(16).padStart(6, "0")}`, mobileDevice ? 28 : 46, .38);
  addImpactRing(player.x, .08, PLAYER_Z, color, 5.4);
  addFloatText(player.x, 4.6, PLAYER_Z - 1, `${skill.name} Lv.${player.skills[skill.id]}`, `#${color.toString(16).padStart(6, "0")}`, 5.4);
  flashScreen(`#${color.toString(16).padStart(6, "0")}`, .34);
  choicePanelEl.classList.add("hidden");
  currentSkillOptions = [];
  player.pendingPromotion = false;
  uiPaused = false;
  lastLoopTime = performance.now();
  accumulator = 0;
  updateHUD();
  setTimeout(processRankProgress, 0);
}

function openPrestigePanel() {
  uiPaused = true;
  clearInputState();
  prestigePanelEl.classList.remove("hidden");
}

function openCampaignVictory() {
  running = false;
  uiPaused = true;
  clearInputState();
  hitStopT = 0;
  // 关掉可能挡住胜利层的面板
  choicePanelEl?.classList.add("hidden");
  prestigePanelEl?.classList.add("hidden");
  statsPanel?.classList.add("hidden");
  saveData.bestScore = Math.max(saveData.bestScore, Math.floor(score));
  saveData.bestDistance = Math.max(saveData.bestDistance, Math.floor(distance));
  persistSave();
  if (victoryTitleEl) victoryTitleEl.textContent = "战役胜利!";
  if (victorySubtitleEl) {
    victorySubtitleEl.textContent =
      `击破公路五害与终焉王 · 得分 ${Math.floor(score)} · 前进 ${Math.floor(distance)}m。可结算本局，或进入更难的无尽冲锋。`;
  }
  if (victoryPanelEl) {
    victoryPanelEl.classList.remove("hidden");
    victoryPanelEl.style.display = "grid";
    victoryPanelEl.style.pointerEvents = "auto";
  }
  addFloatText(0, 6, -8, "战役通关!", "#ffd86b", 7.5);
  flashScreen("#ffd86b", .55);
}

function continueEndlessRun() {
  if (victoryPanelEl) {
    victoryPanelEl.classList.add("hidden");
    victoryPanelEl.style.display = "";
  }
  endlessMode = true;
  killsAtLastBoss = kills;
  lastBossClearDistance = distance;
  bossWarning = false;
  bossSummonCd = 0;
  running = true;
  uiPaused = false;
  lastLoopTime = performance.now();
  accumulator = 0;
  const req = currentBossRequirement();
  addFloatText(0, 5.5, -10, "无尽冲锋开启 · Boss 会更强!", "#ff8a65", 6.2);
  if (req) addFloatText(0, 4.4, -8, `下战 · 升到 ${rankName(req.rank)}`, "#ffcc80", 5);
  flashScreen("#ff8a65", .3);
}

function endCampaignVictory() {
  if (victoryPanelEl) {
    victoryPanelEl.classList.add("hidden");
    victoryPanelEl.style.display = "";
  }
  uiPaused = false;
  running = false;
  resultText.innerHTML =
    "战役胜利!<br>得分 <b style='color:#ffd54f'>" + Math.floor(score) +
    "</b> · 击杀 <b style='color:#ff8a65'>" + kills +
    "</b> · 前进 <b style='color:#4fc3f7'>" + Math.floor(distance) + " m</b>" +
    "<br><span style='font-size:14px;color:#b8f58b'>已击败公路五害 + 终焉王</span>";
  startBtn.textContent = "再来一局";
  saveData.bestScore = Math.max(saveData.bestScore, Math.floor(score));
  saveData.bestDistance = Math.max(saveData.bestDistance, Math.floor(distance));
  persistSave();
  renderProgressText();
  hud.classList.add("hidden");
  vitalsHudEl.classList.add("hidden");
  statusToggle.classList.add("hidden");
  rankBadgeEl.classList.add("hidden");
  choicePanelEl.classList.add("hidden");
  prestigePanelEl.classList.add("hidden");
  statsPanel.classList.add("hidden");
  overlay.classList.add("game-over");
  overlay.classList.remove("hidden");
}

victoryEndEl?.addEventListener("click", endCampaignVictory);
victoryEndlessEl?.addEventListener("click", continueEndlessRun);

function performPrestige() {
  saveData.bestScore = Math.max(saveData.bestScore, Math.floor(score));
  saveData.bestDistance = Math.max(saveData.bestDistance, Math.floor(distance));
  saveData.prestigeCount += 1;
  saveData.medals = Math.min(20, saveData.medals + 1);
  persistSave();
  prestigePanelEl.classList.add("hidden");
  player.prestigeReady = false;
  uiPaused = false;
  running = false;
  startGame();
  addFloatText(0, 5.5, -4, `司令勋章 ×${saveData.medals}`, "#ffd86b", 6.6);
  flashScreen("#ffd86b", .6);
}

prestigeNowEl?.addEventListener("click", performPrestige);
prestigeLaterEl?.addEventListener("click", () => {
  prestigePanelEl?.classList.add("hidden");
  uiPaused = false;
  lastLoopTime = performance.now();
  accumulator = 0;
});
const bulletMeshPool = new ObjectPool(
  () => {
    const mesh = new THREE.Mesh(bulletGeo, bulletMat);
    mesh.add(new THREE.Mesh(trailGeo, trailMat));
    mesh.visible = false;
    return mesh;
  },
  mesh => {
    scene.remove(mesh);
    mesh.visible = false;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.material = bulletMat;
  },
  quality.level === "low" ? 48 : 96,
);
function setHudText(el, text, pulse = false) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (pulse) {
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    setTimeout(() => el.classList.remove("pop"), 260);
  }
}
function updateHUD() {
  const hero = heroUnit();
  const weapon = hero ? WEAPON_DEFS[hero.weaponId] : WEAPON_DEFS.rifle;
  const nextXp = player.level >= MAX_RANK ? COMMANDER_MERIT : rankXpToNext(player.level);
  setHudText(hScore, "★ " + Math.floor(score));
  setHudText(hDist, Math.floor(distance) + " m");
  setHudText(hArmy, `${rankName(player.level)} ${player.level}/${MAX_RANK} · ${player.xp}/${nextXp} ${player.level >= MAX_RANK ? "功勋" : "XP"}`, true);
  setHudText(hPower, "战力 " + Math.round(totalPower()), true);
  if (hero) {
    healthTextEl.textContent = `生命 ${Math.ceil(hero.health)}/${hero.maxHealth}`;
    armorTextEl.textContent = `护甲 ${Math.ceil(hero.armor)}/${hero.maxArmor}`;
    const hr = clamp(hero.health / hero.maxHealth, 0, 1);
    const ar = clamp(hero.armor / hero.maxArmor, 0, 1);
    healthFillEl.style.transform = `scaleX(${hr})`;
    armorFillEl.style.transform = `scaleX(${ar})`;
    // 余血影层:受伤后缓慢排空,healed 时立即跟上——制造格斗游戏式"扣血拖影"
    healthLagRatio = hr > healthLagRatio ? hr : healthLagRatio + (hr - healthLagRatio) * .3;
    armorLagRatio = ar > armorLagRatio ? ar : armorLagRatio + (ar - armorLagRatio) * .3;
    healthLagEl.style.transform = `scaleX(${Math.max(hr, healthLagRatio)})`;
    armorLagEl.style.transform = `scaleX(${Math.max(ar, armorLagRatio)})`;
  }
  let b = `<span style="color:${weapon.css}">${weapon.label} · 火力阶段 ${weaponStageForRank(player.level)}/6 · 射速×${(1 / player.fireRateMul).toFixed(2)}</span>`;
  if (hero) b += `<span style="color:#ff8295">生命 ${Math.ceil(hero.health)}/${hero.maxHealth}</span>`;
  if (combo >= 2)         b += `<span style="color:#ff5722">连杀 ×${combo}</span>`;
  if (critT > 0)          b += `<span style="color:#ffb300">暴击模式 ${Math.ceil(critT / 60)}s</span>`;
  if (player.shield > 0)  b += `<span style="color:#4dd0e1">🛡 护盾 ×${player.shield}</span>`;
  if (player.spreadT > 0) b += `<span style="color:#ba68c8">散弹 ${Math.ceil(player.spreadT / 60)}s</span>`;
  if (player.slowT > 0)   b += `<span style="color:#fff176">减缓 ${Math.ceil(player.slowT / 60)}s</span>`;
  if (player.damageBonus > 0) b += `<span style="color:#ff8a65">火力 +${Math.round(player.damageBonus * 100)}%</span>`;
  if (skillLevel(player.skills, "ricochet") > 0) b += `<span style="color:#9ad8ff">弹射 Lv.${skillLevel(player.skills, "ricochet")}</span>`;
  if (skillLevel(player.skills, "mines") > 0) b += `<span style="color:#ffb22e">地雷 Lv.${skillLevel(player.skills, "mines")}</span>`;
  if (skillLevel(player.skills, "salvo") > 0) b += `<span style="color:#7df6ff">齐射 Lv.${skillLevel(player.skills, "salvo")}</span>`;
  if (eventHordeT > 0) b += `<span style="color:#ff8a65">敌潮 ${Math.ceil(eventHordeT / 60)}s</span>`;
  if (boss) b += `<span style="color:#ffd54f">${boss.def.name} · 阶段${boss.phase || 1}</span>`;
  else if (bossWarning) b += `<span style="color:#ffb74d">Boss 降临中…</span>`;
  else {
    const req = currentBossRequirement();
    if (req && !endlessMode) {
      const tag = bossCount >= 5 ? "终焉" : "战役";
      b += `<span style="color:#ffe27a">${tag} ${Math.min(bossCount, 5)}/5 · 升${rankName(req.rank)}</span>`;
    } else if (req) {
      b += `<span style="color:#ff8a65">无尽 · 升${rankName(req.rank)}</span>`;
    } else if (!endlessMode) b += `<span style="color:#ffe27a">战役 ${Math.min(bossCount, 5)}/5</span>`;
    else b += `<span style="color:#ff8a65">无尽 · ${bossCount} 战</span>`;
  }
  b += `<span style="color:#4fc3f7">每轮 ${inheritedShotDirections().length} 弹 · ${(60 / effectiveFireInterval()).toFixed(1)}轮/秒</span>`;
  if (saveData.medals > 0) b += `<span style="color:#ffd86b">司令勋章 ×${saveData.medals}</span>`;
  buffsEl.innerHTML = b;
  rankBadgeEl.textContent = `豆丁 · ${rankName(player.level)} · ${weapon.label} · ${weather.id === "rain" ? "小雨" : weather.id === "mist" ? "薄雾" : weather.id === "dusk" ? "黄昏" : "阴天"}`;
}

function renderStatsPanel() {
  const hero = heroUnit();
  const weapon = hero ? WEAPON_DEFS[hero.weaponId] : WEAPON_DEFS.rifle;
  const nextXp = player.level >= MAX_RANK ? COMMANDER_MERIT : rankXpToNext(player.level);
  const rows = [];
  rows.push(["总战力", Math.round(totalPower())]);
  rows.push(["击杀 / 距离", `${kills} / ${Math.floor(distance)}m`]);
  rows.push(["军衔", `${rankName(player.level)} · ${player.level} / ${MAX_RANK}`]);
  rows.push(["当前武器", weapon.label]);
  rows.push([player.level >= MAX_RANK ? "司令功勋" : "经验", `${player.xp} / ${nextXp}`]);
  rows.push(["攻击加成", `+${Math.round(player.damageBonus * 100)}%`]);
  rows.push(["射击", `${inheritedShotDirections().length}弹 / ${(60 / effectiveFireInterval()).toFixed(1)}轮每秒`]);
  rows.push(["护盾", player.shield]);
  rows.push(["主角生命", hero ? `${Math.ceil(hero.health)} / ${hero.maxHealth}` : "0 / 0"]);
  rows.push(["主角护甲", hero ? `${Math.max(0, hero.armor)} / ${hero.maxArmor}` : "0 / 0"]);
  if (player.spreadT > 0) rows.push(["散弹增益", `${Math.ceil(player.spreadT / 60)}秒`]);
  if (player.slowT > 0) rows.push(["时间减缓", `${Math.ceil(player.slowT / 60)}秒`]);
  if (critT > 0) rows.push(["暴击模式", `${Math.ceil(critT / 60)}秒`]);
  const skillText = SKILL_DEFS.filter(skill => skillLevel(player.skills, skill.id) > 0).map(skill => `${skill.name} Lv.${skillLevel(player.skills, skill.id)}`).join(" · ");
  rows.push(["本局技能", skillText || "暂无"]);
  rows.push(["司令勋章", `${saveData.medals} / 20`]);
  if (player.prestigeReady) rows.push(["转生", `<button id="statsPrestige" style="padding:5px 12px;border:0;border-radius:12px;background:#d99a27;color:#fff;font-weight:900">授勋转生</button>`]);
  {
    const req = currentBossRequirement();
    const progress = endlessMode
      ? `无尽 · 已过 ${bossCount} 战` + (req ? ` · 升 ${rankName(req.rank)}` : "")
      : `${Math.min(bossCount, CAMPAIGN_BOSS_COUNT)} / ${CAMPAIGN_BOSS_COUNT} Boss` +
        (req ? ` · 升到 ${rankName(req.rank)}` : "");
    rows.push(["战役进度", progress]);
  }
  rows.push(["最高Boss", saveData.highestBoss]);
  rows.push(["历史最佳", `${saveData.bestScore}分 / ${saveData.bestDistance}m`]);
  statsContent.innerHTML = rows.map(([title, value]) => `<div class="stat-row"><span class="stat-title">${title}</span><b>${value}</b></div>`).join("");
  document.getElementById("statsPrestige")?.addEventListener("click", () => {
    statsPanel.classList.add("hidden");
    openPrestigePanel();
  });
}
statusToggle?.addEventListener("click", () => {
  if (!running) return;
  clearInputState(); renderStatsPanel(); uiPaused = true; accumulator = 0; statsPanel?.classList.remove("hidden");
});
statsClose?.addEventListener("click", () => {
  statsPanel?.classList.add("hidden"); uiPaused = false; lastLoopTime = performance.now(); accumulator = 0;
});

/* ================= 开始 / 结束 ================= */
const overlay = document.getElementById("overlay");
const hud = document.getElementById("hud");
const resultText = document.getElementById("resultText");
const progressText = document.getElementById("progressText");
const startBtn = document.getElementById("startBtn");
const installBtn = document.getElementById("installBtn");
const installTip = document.getElementById("installTip");
const controlHint = document.getElementById("controlHint");
const controlText = document.getElementById("controlText");

function renderProgressText() {
  if (!progressText) return;
  progressText.textContent = `机关枪体系　司令勋章：${saveData.medals}　最高Boss：${saveData.highestBoss}　最远：${saveData.bestDistance}m`;
}
renderProgressText();

if (mobileDevice && controlText) controlText.textContent = "按住屏幕左右滑动来移动主角";

let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  installBtn?.classList.remove("hidden");
});
installBtn?.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn?.classList.add("hidden");
});
window.addEventListener("appinstalled", () => {
  installBtn?.classList.add("hidden");
  installTip?.classList.add("hidden");
});

function releaseTrailFx(s) {
  if (s.pooled === "trail") trailSegPool.release(s.mesh);
  else if (s.pooled === "muzzle") muzzleSpritePool.release(s.mesh);
  else if (s.pooled === "spark") sparkSpritePool.release(s.mesh);
  else scene.remove(s.mesh);
}

function clearWorld() {
  bullets.forEach(b => bulletMeshPool.release(b.mesh));
  particles.forEach(p => particleMeshPool.release(p.mesh));
  trailFx.forEach(releaseTrailFx);
  impactFx.forEach(fx => impactRingPool.release(fx.mesh));
  impactFx = [];
  enemies.forEach(removeEnemy);
  crates.forEach(disposeCrate);
  rewardCores.forEach(disposeRewardCore);
  rewardCores = [];
  enemyAimHazards.forEach(disposeEnemyAimHazard);
  enemyAimHazards = [];
  gates.forEach(disposeGate);
  gates = [];
  traps.forEach(disposeTrap);
  traps = [];
  clearDrones();
  playerMines.forEach(mine => {
    scene.remove(mine.mesh);
    mine.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  });
  playerMines = [];
  salvoCd = 0;
  if (boss) { scene.remove(boss.mesh); disposeSoldierMesh(boss.mesh); boss = null; }
  bossHazards.forEach(disposeBossHazard);
  bossHazards = [];
  bossProjectiles.forEach(disposeBossProjectile);
  bossProjectiles = [];
  bossBarEl.classList.add("hidden");
  floatTexts.forEach(releaseFloatText);
  sparks.forEach(s => sparkSpritePool.release(s.mesh));
  smokes.forEach(s => smokeSpritePool.release(s.mesh));
  bullets = []; enemies = []; crates = []; rewardCores = []; enemyAimHazards = []; particles = []; floatTexts = []; trailFx = [];
  sparks = []; smokes = []; hitStopT = 0; eventHordeT = 0;
}

function startGame() {
  if (demoSoldier.parent) { scene.remove(demoSoldier); disposeSoldierMesh(demoSoldier); }
  clearWorld();
  camera.position.set(0, cameraBase.y, cameraBase.z);   // 复位摄像机(待机演示会移动它)
  camera.lookAt(0, 0, cameraBase.lookZ);
  player.soldiers.forEach(removePlayerUnit);
  player.soldiers = [];
  nextUnitId = 1; nextEnemyId = 1;
  player.x = 0; player.tx = null; player.vx = 0; player.lastX = 0;
  player.damageBonus = 0; player.fireRateMul = 1;
  player.shield = 0; player.spreadT = 0; player.slowT = 0; player.hurtT = 0; player.moveSlowT = 0;
  player.xp = 0; player.level = 1; player.skills = {}; player.pendingPromotion = false; player.prestigeReady = false;
  player.shieldKillProgress = 0; player.airstrikeKillProgress = 0;
  createHero();
  frame = 0; score = 0; kills = 0; distance = 0; worldSpeed = 0.25;
  combo = 0; comboTimer = 0; critT = 0; shake = 0;
  bossCount = 0; killsAtLastBoss = 0; lastBossClearDistance = 0; bossWarning = false; bossSummonCd = 0; endlessMode = false;
  eventIndex = 0; nextEventAt = 180; eventHordeT = 0;
  victoryPanelEl?.classList.add("hidden");
  cameraFollowX = 0; screenFlashT = 0;
  screenFlashEl.style.opacity = "0"; speedFxEl.style.opacity = "0";
  spawnEnemyCd = 110; spawnCrateCd = 130; spawnGateCd = 450; spawnTrapCd = 320;
  weather.reset();
  overlay.classList.add("hidden");
  overlay.classList.remove("game-over");
  choicePanelEl.classList.add("hidden");
  prestigePanelEl.classList.add("hidden");
  hud.classList.remove("hidden");
  vitalsHudEl.classList.remove("hidden");
  statusToggle.classList.remove("hidden");
  rankBadgeEl.classList.remove("hidden");
  statsPanel.classList.add("hidden"); uiPaused = false;
  updateHUD();
  running = true;
  accumulator = 0;
  lastLoopTime = performance.now();
  if (mobileDevice) {
    controlHint.classList.add("show");
    setTimeout(() => controlHint.classList.remove("show"), 2200);
  }
}

function endGame() {
  running = false;
  speedFxEl.style.opacity = "0";
  activePointerId = null;
  player.tx = null;
  resultText.innerHTML =
    "游戏结束!<br>得分 <b style='color:#ffd54f'>" + Math.floor(score) +
    "</b> · 击杀 <b style='color:#ff8a65'>" + kills +
    "</b> · 前进 <b style='color:#4fc3f7'>" + Math.floor(distance) + " m</b>";
  startBtn.textContent = "再来一局";
  saveData.bestScore = Math.max(saveData.bestScore, Math.floor(score));
  saveData.bestDistance = Math.max(saveData.bestDistance, Math.floor(distance));
  persistSave();
  renderProgressText();
  bossBarEl.classList.add("hidden");
  hud.classList.add("hidden");
  vitalsHudEl.classList.add("hidden");
  statusToggle.classList.add("hidden");
  rankBadgeEl.classList.add("hidden");
  choicePanelEl.classList.add("hidden");
  prestigePanelEl.classList.add("hidden");
  victoryPanelEl?.classList.add("hidden");
  statsPanel.classList.add("hidden"); uiPaused = false;
  overlay.classList.add("game-over");
  overlay.classList.remove("hidden");
}
function requestStartGame() {
  if (!running) startGame();
}
// 尽早挂上，main 一 load 完就能点开始（不必等 demo/loop 之后）
(globalThis as any).__soldierRushStart = requestStartGame;
(globalThis as any).__soldierRushReady = true;

/* ================= 主循环 ================= */
let lastLoopTime = performance.now();
let accumulator = 0;
const FIXED_STEP = 1 / 60;
function loop(now = performance.now()) {
  requestAnimationFrame(loop);
  const elapsed = Math.min((now - lastLoopTime) / 1000, 0.1);
  lastLoopTime = now;
  if (running) {
    if (!uiPaused) {
      if (hitStopT > 0) {
        hitStopT--;           // 卡帧:冻结模拟一小段,放大打击瞬间的"重量感"
        accumulator = 0;
      } else {
        accumulator += elapsed;
        while (running && accumulator >= FIXED_STEP) {
          update();
          accumulator -= FIXED_STEP;
        }
        if (!running) accumulator = 0;
      }
    } else accumulator = 0;
  } else {
    // 待机时缓慢旋转展示
    const t = now / 1000;
    camera.position.x = Math.sin(t * 0.3) * 3;
    camera.position.y = cameraBase.y;
    camera.position.z = cameraBase.z;
    camera.lookAt(0, 0, cameraBase.lookZ);
    groundTex.offset.y += elapsed * 0.12;
    if (demoSoldier.parent) {
      animateWalk(demoSoldier, t, 2.2, .12, Math.sin(t * .5) * .12);   // 舒缓待机而非行军
      demoSoldier.rotation.y = Math.sin(t * .4) * .22;
      if (demoSoldier.userData.rig) demoSoldier.userData.rig.position.y += Math.sin(t * 1.6) * .03;
    }
  }
  composer.render();
}

/* 待机展示:放一个士兵 */
const demoSoldier = makeSoldier(0x2a5a8a, "rifle", 3);
applyRimFresnel(demoSoldier, 0xffe8a0, 2.1, .95);
demoSoldier.position.set(0, 0, -2);
demoSoldier.scale.set(2.15, 2.15, 2.15);
scene.add(demoSoldier);

const buildTagEl = document.getElementById("buildTag");
if (buildTagEl) buildTagEl.textContent = `版本 ${BUILD_VERSION} · ${__BUILD_TIME__}`;
const versionTagEl = document.getElementById("versionTag");
if (versionTagEl) {
  // 左下角常驻版本，方便对照是否刷到最新包
  const shortTime = String(__BUILD_TIME__ || "").replace("T", " ").slice(5, 16);
  versionTagEl.textContent = `${BUILD_VERSION}${shortTime ? " · " + shortTime : ""}`;
}

try {
  loop();
  requestAnimationFrame(() => {
    try { composer.render(); } catch { /* ignore */ }
  });
} catch (error) {
  console.error("Soldier Rush render boot failed", error);
}

try {
  void hydrateNativeSave().then(nativeSave => {
    if (!nativeSave) return;
    saveData = nativeSave;
    renderProgressText();
  }).catch(() => {
    // Preferences may fail in some browsers; localStorage already loaded.
  });
} catch {
  // ignore
}
