"use strict";

/* ================= 基础场景 ================= */
const ROAD_HALF = 8;          // 道路半宽
const SPAWN_Z = -100;         // 敌人生成位置
const PLAYER_Z = 0;
const MAX_SQUAD = 15;
const MAX_TIER = 5;
const MERGE_POWER = 3.4;
const SAVE_KEY = "soldierRush.save.v1";
const TIER_SKILLS = {
  2: { name: "twinShot", label: "双重射击" },
  3: { name: "pierce", label: "穿透弹" },
  4: { name: "novaVolley", label: "新星齐射" },
  5: { name: "starburst", label: "星爆弹幕" },
};

const WEAPON_DEFS = {
  rifle:   { label: "步枪",   color: 0x5aa9ff, css: "#74b9ff", damage: 2,  fireRate: 24, speed: 1.28, type: "bullet",  unlockBoss: 0 },
  smg:     { label: "冲锋枪", color: 0x63e6be, css: "#63e6be", damage: 1,  fireRate: 9,  speed: 1.38, type: "smg",     unlockBoss: 1 },
  shotgun: { label: "霰弹枪", color: 0xffb454, css: "#ffbd66", damage: 1,  fireRate: 38, speed: 1.18, type: "shotgun", unlockBoss: 2 },
  sniper:  { label: "狙击枪", color: 0xd59cff, css: "#d7a4ff", damage: 10, fireRate: 64, speed: 1.82, type: "pierce",  unlockBoss: 3, pierce: 3 },
  rocket:  { label: "火箭筒", color: 0xff766b, css: "#ff8177", damage: 8,  fireRate: 78, speed: .82,  type: "rocket",  unlockBoss: 4, radius: 2.8 },
  laser:   { label: "激光枪", color: 0x76f4ff, css: "#7df6ff", damage: 2,  fireRate: 7,  speed: 1.75, type: "laser",   unlockBoss: 5, pierce: 4 },
};
const WEAPON_ORDER = Object.keys(WEAPON_DEFS);
const BOSS_DEFS = [
  { name: "坦克指挥官", color: 0x496d42, accent: 0xffc44f, unlock: "smg" },
  { name: "盾甲巨兵",   color: 0x526f87, accent: 0x8de8ff, unlock: "shotgun" },
  { name: "狙击机甲",   color: 0x604f84, accent: 0xd8a5ff, unlock: "sniper" },
  { name: "火箭巨兽",   color: 0x8b3e36, accent: 0xff9d5c, unlock: "rocket" },
  { name: "能量守卫",   color: 0x256f78, accent: 0x72f5ff, unlock: "laser" },
];

function defaultSave() {
  return { version: 1, unlockedWeapons: ["rifle"], highestBoss: 0, bestScore: 0, bestDistance: 0 };
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.unlockedWeapons)) return defaultSave();
    const unlocked = WEAPON_ORDER.filter(id => parsed.unlockedWeapons.includes(id));
    return {
      version: 1,
      unlockedWeapons: unlocked.includes("rifle") ? unlocked : ["rifle", ...unlocked],
      highestBoss: Math.max(0, Number(parsed.highestBoss) || 0),
      bestScore: Math.max(0, Number(parsed.bestScore) || 0),
      bestDistance: Math.max(0, Number(parsed.bestDistance) || 0),
    };
  } catch (_) { return defaultSave(); }
}
let saveData = loadSave();
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveData)); } catch (_) {}
}

const mobileDevice = matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const lowPowerDevice = mobileDevice && (!navigator.deviceMemory || navigator.deviceMemory <= 4);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("cv"), antialias: !lowPowerDevice, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobileDevice ? (lowPowerDevice ? 1 : 1.35) : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;

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
scene.background = makeSkyTexture();
scene.fog = new THREE.Fog(0xc9eaff, 58, 138);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);
const cameraBase = { y: 9.5, z: 11, lookZ: -20 };

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

scene.add(new THREE.HemisphereLight(0xf4fbff, 0x5b7651, 1.3));
const sun = new THREE.DirectionalLight(0xfff0c7, 1.4);
sun.position.set(15, 30, 10);
scene.add(sun);
const skyFill = new THREE.DirectionalLight(0x78bfff, 0.55);
skyFill.position.set(-18, 12, -25);
scene.add(skyFill);

function makeSunGlow() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 7, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,252,214,1)");
  grad.addColorStop(.22, "rgba(255,225,135,.9)");
  grad.addColorStop(1, "rgba(255,210,110,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: .78, depthWrite: false, fog: false, toneMapped: false }));
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
  updateCameraLayout();
});

/* ================= 地面(滚动纹理) ================= */
function makeGroundTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d");
  // 明亮低多边形草地
  const grass = g.createLinearGradient(0, 0, 512, 0);
  grass.addColorStop(0, "#72bd69"); grass.addColorStop(.5, "#86ce74"); grass.addColorStop(1, "#72bd69");
  g.fillStyle = grass; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 180; i++) {
    g.fillStyle = Math.random() < .5 ? "rgba(56,138,73,.17)" : "rgba(213,244,151,.16)";
    const s = 3 + Math.random() * 8;
    g.fillRect(Math.random() * 512, Math.random() * 512, s, s * .55);
  }
  // 道路(中间 16/36 比例)
  const rl = 512 * (0.5 - ROAD_HALF / 36), rr = 512 * (0.5 + ROAD_HALF / 36);
  const road = g.createLinearGradient(rl, 0, rr, 0);
  road.addColorStop(0, "#cdbd98"); road.addColorStop(.18, "#eadcba"); road.addColorStop(.5, "#f4e9cc"); road.addColorStop(.82, "#eadcba"); road.addColorStop(1, "#cdbd98");
  g.fillStyle = road; g.fillRect(rl, 0, rr - rl, 512);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = Math.random() < .5 ? "rgba(166,139,96,.12)" : "rgba(255,255,255,.19)";
    const s = 3 + Math.random() * 5;
    g.fillRect(rl + Math.random() * (rr - rl), Math.random() * 512, s, s);
  }
  // 道路软边与路缘高光
  g.fillStyle = "#477d52"; g.fillRect(rl - 8, 0, 8, 512); g.fillRect(rr, 0, 8, 512);
  g.fillStyle = "#fff1b8"; g.fillRect(rl, 0, 5, 512); g.fillRect(rr - 5, 0, 5, 512);
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

/* ================= 3D 士兵模型 ================= */
const soldierGeo = {
  torso: new THREE.CapsuleGeometry(0.32, 0.3, 4, 8),
  limb: new THREE.CapsuleGeometry(0.105, 0.28, 3, 6),
  head: new THREE.SphereGeometry(0.27, 10, 7),
  helmet: new THREE.SphereGeometry(0.31, 10, 6),
  hand: new THREE.SphereGeometry(0.115, 7, 5),
  boot: new THREE.BoxGeometry(0.24, 0.15, 0.34),
  cube: new THREE.BoxGeometry(1, 1, 1),
  shadow: new THREE.CircleGeometry(0.58, 18),
};
const sharedSoldierGeometries = new Set(Object.values(soldierGeo));
const soldierShadowMat = new THREE.MeshBasicMaterial({ color: 0x17344b, transparent: true, opacity: 0.2, depthWrite: false });

function makeSoldier(mainColor, weaponId = "rifle", tier = 1) {
  const g = new THREE.Group();
  const rig = new THREE.Group();
  g.add(rig);
  const weapon = WEAPON_DEFS[weaponId] || WEAPON_DEFS.rifle;
  const mat = (c, metalness = .02, roughness = .78) => new THREE.MeshStandardMaterial({
    color: c, metalness, roughness, flatShading: true, emissive: 0x000000, emissiveIntensity: .42
  });
  const dark = new THREE.Color(mainColor).multiplyScalar(0.55).getHex();

  function part(geo, material, x, y, z, sx = 1, sy = 1, sz = 1, parent = rig) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  }

  const uniformMat = mat(mainColor);
  const darkMat = mat(dark);
  const skinMat = mat(0xffc697);
  const trouserMat = mat(0x26394b);
  const gunMat = mat(0x28323d, .42, .38);
  const accentMat = mat(weapon.color, .12, .42);
  const glowMat = new THREE.MeshBasicMaterial({ color: weapon.color, toneMapped: false });
  const hairMat = mat(new THREE.Color(mainColor).lerp(new THREE.Color(0x172033), .62).getHex(), .08, .5);

  const shadow = new THREE.Mesh(soldierGeo.shadow, soldierShadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .018; shadow.scale.y = .62;
  g.add(shadow);

  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-.17, .56, 0); legR.position.set(.17, .56, 0);
  rig.add(legL, legR);
  part(soldierGeo.limb, trouserMat, 0, -.25, 0, 1, 1.05, 1, legL);
  part(soldierGeo.limb, trouserMat, 0, -.25, 0, 1, 1.05, 1, legR);
  part(soldierGeo.boot, gunMat, 0, -.53, -.07, 1, 1, 1, legL);
  part(soldierGeo.boot, gunMat, 0, -.53, -.07, 1, 1, 1, legR);

  part(soldierGeo.torso, uniformMat, 0, .98, 0, 1.12, 1.04, .86);
  part(soldierGeo.cube, darkMat, 0, 1.04, -.30, .54, .46, .12); // 胸甲
  if (!lowPowerDevice) part(soldierGeo.cube, darkMat, 0, .75, -.02, .72, .13, .48); // 腰带

  const head = part(soldierGeo.head, skinMat, 0, 1.58, -.03, 1.16, 1.22, 1.04);
  part(soldierGeo.helmet, hairMat, 0, 1.78, .03, 1.22, .56, 1.14);
  part(new THREE.ConeGeometry(.22, .52, 5), hairMat, -.22, 1.91, .02, 1, 1, 1.1).rotation.z = -.42;
  part(new THREE.ConeGeometry(.18, .42, 5), hairMat,  .22, 1.88, .02, 1, 1, 1.1).rotation.z = .36;
  part(soldierGeo.cube, accentMat, 0, 1.72, -.31, .72, .075, .07);
  if (!lowPowerDevice) part(soldierGeo.cube, darkMat, 0, 1.61, -.27, .67, .08, .5); // 帽檐
  let face = null;
  if (!lowPowerDevice || tier >= 2) {
    const eyeWhite = mat(0xfffbf1, 0, .35), pupilMat = glowMat;
    const eyeGeo = new THREE.SphereGeometry(.085, 8, 6), pupilGeo = new THREE.SphereGeometry(.048, 7, 5);
    for (const side of [-1, 1]) {
      part(eyeGeo, eyeWhite, side * .12, 1.61, -.29, 1, 1.18, .5);
      part(pupilGeo, pupilMat, side * .12, 1.61, -.336, 1, 1.12, .4);
    }
    face = part(soldierGeo.cube, hairMat, 0, 1.44, -.3, .19, .028, .025);
  }

  if (tier >= 2) {
    part(new THREE.IcosahedronGeometry(.23, 0), accentMat, -.48, 1.28, -.02, 1, 1, 1);
    part(new THREE.IcosahedronGeometry(.23, 0), accentMat,  .48, 1.28, -.02, 1, 1, 1);
    part(soldierGeo.cube, glowMat, 0, 1.14, -.39, .13, .13, .04);
  }
  if (tier >= 3) {
    part(new THREE.ConeGeometry(.12, .55, 5), accentMat, 0, 2.11, .02, 1, 1, 1);
    part(soldierGeo.cube, darkMat, 0, 1.05, .29, .7, .78, .12);
    for (const side of [-1, 1]) part(new THREE.ConeGeometry(.13, .65, 5), glowMat, side * .44, 1.02, .28, 1, 1, 1).rotation.z = side * .7;
  }
  if (tier >= 4) {
    const aura = new THREE.Mesh(new THREE.RingGeometry(.58, .72, 24), new THREE.MeshBasicMaterial({
      color: weapon.color, transparent: true, opacity: .28, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    aura.rotation.x = -Math.PI / 2; aura.position.y = .035; g.add(aura); g.userData.aura = aura;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.38, .035, 6, 20), glowMat);
    halo.position.set(0, 2.12, .02); halo.rotation.x = Math.PI / 2; rig.add(halo); g.userData.halo = halo;
    for (const side of [-1, 1]) {
      const wing = part(soldierGeo.cube, accentMat, side * .76, 1.22, .2, .18, .56, .08);
      wing.rotation.z = side * .48;
    }
  }
  if (tier >= 5) {
    part(new THREE.CylinderGeometry(.32, .47, .18, 6), glowMat, 0, 2.08, .01, 1, 1, 1);
    for (const side of [-1, 1]) {
      const crown = part(new THREE.ConeGeometry(.11, .42, 5), glowMat, side * .19, 2.3, -.02, 1, 1, 1);
      crown.rotation.z = side * .22;
    }
    const cape = part(soldierGeo.cube, accentMat, 0, 1.0, .42, .72, .95, .06);
    cape.rotation.x = -.15;
  }

  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-.38, 1.24, -.02); armR.position.set(.38, 1.24, -.02);
  const armBase = weaponId === "rocket" ? .9 : weaponId === "sniper" ? 1.16 : weaponId === "shotgun" ? 1.02 : 1.08;
  armL.rotation.x = armR.rotation.x = armBase;
  rig.add(armL, armR);
  part(soldierGeo.limb, uniformMat, 0, -.19, 0, 1, .9, 1, armL);
  part(soldierGeo.limb, uniformMat, 0, -.19, 0, 1, .9, 1, armR);
  if (!lowPowerDevice) {
    part(soldierGeo.hand, skinMat, 0, -.39, 0, .86, .86, .86, armL);
    part(soldierGeo.hand, skinMat, 0, -.39, 0, .86, .86, .86, armR);
  }

  const gunRig = new THREE.Group();
  gunRig.position.set(.1, 1.14, -.58); rig.add(gunRig);
  if (weaponId === "smg") {
    part(soldierGeo.cube, gunMat, 0, 0, 0, .16, .18, .58, gunRig);
    part(soldierGeo.cube, accentMat, 0, .02, -.36, .08, .08, .2, gunRig);
    part(soldierGeo.cube, darkMat, -.05, -.16, .04, .11, .28, .14, gunRig);
  } else if (weaponId === "shotgun") {
    part(soldierGeo.cube, gunMat, 0, 0, -.06, .19, .16, .9, gunRig);
    part(soldierGeo.cube, accentMat, 0, -.02, -.48, .2, .18, .22, gunRig);
  } else if (weaponId === "sniper") {
    part(soldierGeo.cube, gunMat, 0, 0, -.12, .11, .13, 1.18, gunRig);
    part(soldierGeo.cube, accentMat, 0, .13, -.18, .13, .1, .28, gunRig);
    part(soldierGeo.cube, darkMat, -.05, -.16, .12, .1, .3, .13, gunRig);
  } else if (weaponId === "rocket") {
    part(soldierGeo.cube, gunMat, 0, .02, -.06, .3, .28, 1.05, gunRig);
    part(soldierGeo.cube, accentMat, 0, .02, -.63, .4, .38, .18, gunRig);
    gunRig.position.y += .12;
  } else if (weaponId === "laser") {
    part(soldierGeo.cube, accentMat, 0, 0, -.08, .18, .18, .9, gunRig);
    part(soldierGeo.cube, gunMat, 0, -.02, .28, .25, .22, .24, gunRig);
    const coreMat = new THREE.MeshBasicMaterial({ color: weapon.color, toneMapped: false });
    part(soldierGeo.cube, coreMat, 0, .02, -.58, .08, .08, .26, gunRig);
  } else {
    part(soldierGeo.cube, gunMat, 0, 0, 0, .13, .14, .76, gunRig);
    part(soldierGeo.cube, accentMat, 0, .035, -.48, .07, .07, .28, gunRig);
    part(soldierGeo.cube, darkMat, -.05, -.16, .08, .10, .30, .13, gunRig);
  }

  g.userData.rig = rig;
  g.userData.legs = [legL, legR];
  g.userData.arms = [armL, armR];
  g.userData.gunRig = gunRig;
  g.userData.head = head;
  g.userData.face = face;
  g.userData.weaponId = weaponId;
  g.userData.tier = tier;
  g.userData.armBase = armBase;
  g.userData.phase = Math.random() * Math.PI * 2;
  g.userData.recoil = 0;
  g.userData.hit = 0;
  g.userData.spawnT = 1;
  g.userData.mergeT = 0;
  rig.scale.setScalar(.12);
  return g;
}
function animateWalk(soldier, t, speed = 10, amp = 0.55, lean = 0) {
  const p = t * speed + soldier.userData.phase;
  const ud = soldier.userData;
  ud.legs[0].rotation.x =  Math.sin(p) * amp;
  ud.legs[1].rotation.x = -Math.sin(p) * amp;
  ud.arms[0].rotation.x = ud.armBase - Math.sin(p) * .09 - ud.recoil * .2;
  ud.arms[1].rotation.x = ud.armBase + Math.sin(p) * .09 - ud.recoil * .2;
  ud.gunRig.position.z = -.58 + ud.recoil * .13;
  ud.rig.position.y = .035 + Math.abs(Math.sin(p)) * .075;
  ud.rig.rotation.x = Math.sin(p * 2) * .018;
  ud.rig.rotation.z = -lean * .16 + Math.sin(p * 3) * ud.hit * .08;
  ud.recoil *= .56;
  ud.hit *= .72;
  if (ud.aura) {
    ud.aura.rotation.z += .025;
    ud.aura.material.opacity = .2 + Math.sin(t * 5 + ud.phase) * .08;
  }
  if (ud.halo) {
    ud.halo.rotation.z += .045;
    ud.halo.position.y = 2.12 + Math.sin(t * 4 + ud.phase) * .055;
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

/* ================= 道具箱 ================= */
const REWARDS = [
  { type: "weapon",   label: "武器兵", color: "#8bc34a", weight: 28 },
  { type: "firerate", label: "射速+",  color: "#4fc3f7", weight: 14 },
  { type: "damage",   label: "火力+",  color: "#ff8a65", weight: 14 },
  { type: "spread",   label: "散弹",   color: "#ba68c8", weight: 12 },
  { type: "shield",   label: "护盾",   color: "#4dd0e1", weight: 12 },
  { type: "bomb",     label: "炸弹",   color: "#ef5350", weight: 8  },
  { type: "slow",     label: "减缓",   color: "#fff176", weight: 8  },
  { type: "coin",     label: "金币",   color: "#ffd54f", weight: 12 },
];
function pickRecruitWeapon() {
  const unlocked = saveData.unlockedWeapons.filter(id => WEAPON_DEFS[id]);
  if (!unlocked.length) return "rifle";
  const pairCandidates = unlocked.filter(id => {
    const counts = new Map();
    player.soldiers.filter(u => u.weaponId === id && u.tier < MAX_TIER).forEach(u => counts.set(u.tier, (counts.get(u.tier) || 0) + 1));
    return [...counts.values()].some(n => n % 3 === 2);
  });
  if (pairCandidates.length && Math.random() < .62) return pairCandidates[Math.floor(Math.random() * pairCandidates.length)];
  if (Math.random() < .72) {
    return unlocked.slice().sort((a, b) =>
      player.soldiers.filter(u => u.weaponId === a).length - player.soldiers.filter(u => u.weaponId === b).length
    )[0];
  }
  return unlocked[Math.floor(Math.random() * unlocked.length)];
}
function pickReward() {
  const total = REWARDS.reduce((s, r) => s + r.weight, 0);
  let n = Math.random() * total;
  let reward = REWARDS[0];
  for (const r of REWARDS) { n -= r.weight; if (n <= 0) { reward = r; break; } }
  if (reward.type !== "weapon") return { ...reward };
  const weaponId = pickRecruitWeapon();
  const def = WEAPON_DEFS[weaponId];
  return { ...reward, weaponId, label: def.label + "兵", color: def.css, colorHex: def.color };
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
  const count = 5 + Math.floor(Math.random() * 11);   // 5~15 次
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
const flashGeo = new THREE.IcosahedronGeometry(1, 0);
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe783, transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const TRAIL_FX_CAP = mobileDevice ? 280 : 500;
function addTrailSeg(x0, z0, x1, z1) {
  if (trailFx.length >= TRAIL_FX_CAP) return;
  const dx = x1 - x0, dz = z1 - z0;
  const m = new THREE.Mesh(segGeo, segMat);
  m.position.set((x0 + x1) / 2, 1.0, (z0 + z1) / 2);
  m.rotation.y = Math.atan2(dx, dz);
  m.scale.set(0.14, 0.14, Math.hypot(dx, dz) + 0.1);
  scene.add(m);
  trailFx.push({ mesh: m, life: 10, maxLife: 10, w: 0.14 });
}
function addMuzzleFlash(x, z) {
  if (trailFx.length >= TRAIL_FX_CAP) return;
  const m = new THREE.Mesh(flashGeo, flashMat);
  m.position.set(x, 1.0, z);
  m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
  scene.add(m);
  trailFx.push({ mesh: m, life: 5, maxLife: 5, w: 0.6, flash: true });
}
const particleGeo = new THREE.TetrahedronGeometry(0.19, 0);
const pMatCache = {};
function pMat(color) { return pMatCache[color] || (pMatCache[color] = new THREE.MeshBasicMaterial({ color, toneMapped: false })); }
const ringGeo = new THREE.RingGeometry(.34, .48, 24);
let impactFx = [];
function addImpactRing(x, y, z, color, size = 1.2) {
  if (impactFx.length > (mobileDevice ? 18 : 30)) return;
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: .72, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false
  });
  const mesh = new THREE.Mesh(ringGeo, material);
  mesh.position.set(x, y, z); mesh.rotation.x = -Math.PI / 2; mesh.scale.setScalar(.2);
  scene.add(mesh);
  impactFx.push({ mesh, material, life: 22, maxLife: 22, size });
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
  shield: 0, spreadT: 0, slowT: 0, hurtT: 0,
};
let nextUnitId = 1;
let nextEnemyId = 1;
let bullets = [];        // {mesh, vx, dmg, px, pz}
let trailFx = [];        // 弹道残影/枪口火光 {mesh, life, maxLife, w, flash}
let enemies = [];        // {mesh, hp, maxHp, speed, big, hpBar}
let crates = [];
let particles = [];      // {mesh, vx, vy, vz, life}
let floatTexts = [];     // {sprite, life}
let spawnEnemyCd = 60, spawnCrateCd = 150;
let gates = [], spawnGateCd = 500;          // 选择门
let walls = [], spawnWallCd = 320;          // 阻碍墙壁
let combo = 0, comboTimer = 0, critT = 0;   // 连杀 / 暴击模式
let shake = 0;                              // 摄像机震动强度
let cameraFollowX = 0, screenFlashT = 0;
let boss = null, bossCount = 0, nextBossDistance = 500, bossWarning = false;
let bossHazards = [];
const screenFlashEl = document.getElementById("screenFlash");
const speedFxEl = document.getElementById("speedFx");
function addShake(a) { shake = Math.min(shake + a, 0.45); }
function flashScreen(color = "#ffffff", strength = .35) {
  screenFlashT = Math.max(screenFlashT, strength * 12);
  screenFlashEl.style.background = color;
  screenFlashEl.style.opacity = String(Math.min(.42, screenFlashT / 12));
}

/* ================= 输入 ================= */
const keys = {};
window.addEventListener("keydown", e => {
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
const cvEl = document.getElementById("cv");
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
  const cap = mobileDevice ? 220 : 340;
  for (let i = 0; i < n && particles.length < cap; i++) {
    const m = new THREE.Mesh(particleGeo, pMat(color));
    m.position.set(x, y, z);
    m.scale.setScalar(rand(0.75, 1.75));
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    particles.push({
      mesh: m,
      vx: rand(-spd, spd), vy: rand(0.05, spd * 1.6), vz: rand(-spd, spd),
      rx: rand(-.18, .18), ry: rand(-.18, .18), rz: rand(-.18, .18),
      life: rand(22, 42),
    });
    scene.add(m);
  }
}

function makeTextSprite(text, color, size = 4.6) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const g = c.getContext("2d");
  g.font = "900 66px Microsoft YaHei";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.strokeStyle = "rgba(12,27,46,.9)"; g.lineWidth = 13;
  g.strokeText(text, 256, 64);
  g.fillStyle = color;
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  sprite.scale.set(size, size * 0.25, 1);
  return sprite;
}

function addFloatText(x, y, z, text, color, size = 4.6) {
  const sprite = makeTextSprite(text, color, size);
  sprite.position.set(x, y, z);
  scene.add(sprite);
  const baseScale = sprite.scale.clone();
  sprite.scale.multiplyScalar(.12);
  floatTexts.push({ sprite, life: 60, maxLife: 60, baseScale });
}

/* ================= 小队管理 ================= */
function squadPositions() {
  const n = player.soldiers.length;
  const pos = [];
  let remaining = n, row = 0;
  while (remaining > 0) {
    const count = Math.min(remaining, 4);
    for (let i = 0; i < count; i++) {
      pos.push({ x: player.x - (count - 1) * .58 + i * 1.16, z: PLAYER_Z + row * 1.35 });
    }
    remaining -= count; row++;
  }
  return pos;
}
function squadHalfWidth() { return (Math.min(player.soldiers.length, 4) - 1) * 0.58; }

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
  const weapon = WEAPON_DEFS[unit.weaponId];
  const shots = weapon.type === "shotgun" ? 5 : 1;
  return ((weapon.damage + player.damageBonus) * shots * 60 / (weapon.fireRate * player.fireRateMul)) * Math.pow(MERGE_POWER, unit.tier - 1);
}
function totalPower() { return player.soldiers.reduce((sum, unit) => sum + unitPower(unit), 0); }

function canMergeWith(weaponId, tier = 1) {
  return tier < MAX_TIER && player.soldiers.filter(u => u.weaponId === weaponId && u.tier === tier).length >= 2;
}

function createPlayerUnit(weaponId = "rifle", tier = 1, x = player.x, z = PLAYER_Z) {
  const def = WEAPON_DEFS[weaponId] || WEAPON_DEFS.rifle;
  const color = new THREE.Color(0x2389df).lerp(new THREE.Color(def.color), .16 + tier * .08).getHex();
  const mesh = makeSoldier(color, weaponId, tier);
  mesh.scale.setScalar(1.08 + tier * .035);
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const maxArmor = Math.pow(3, tier - 1);
  return { id: nextUnitId++, mesh, weaponId, tier, armor: maxArmor, maxArmor, fireCd: Math.random() * def.fireRate };
}

function removePlayerUnit(unit) {
  scene.remove(unit.mesh);
  disposeSoldierMesh(unit.mesh);
}

function addSoldierUnit(weaponId = "rifle", tier = 1, options = {}) {
  if (!WEAPON_DEFS[weaponId]) weaponId = "rifle";
  if (player.soldiers.length >= MAX_SQUAD && !canMergeWith(weaponId, tier)) {
    score += 100;
    if (!options.quiet) addFloatText(player.x, 3.5, PLAYER_Z - 1, "编队已满 +100", "#ffd54f", 4.2);
    return false;
  }
  const unit = createPlayerUnit(weaponId, tier, options.x, options.z);
  player.soldiers.push(unit);
  if (!options.skipMerge) mergeSoldiers();
  return true;
}

function mergeSoldiers() {
  let merged = true;
  while (merged) {
    merged = false;
    for (const weaponId of WEAPON_ORDER) {
      for (let tier = 1; tier < MAX_TIER; tier++) {
        const same = player.soldiers.filter(u => u.weaponId === weaponId && u.tier === tier);
        if (same.length < 3) continue;
        const chosen = same.slice(0, 3);
        const x = chosen.reduce((s, u) => s + u.mesh.position.x, 0) / 3;
        const z = chosen.reduce((s, u) => s + u.mesh.position.z, 0) / 3;
        const ids = new Set(chosen.map(u => u.id));
        player.soldiers = player.soldiers.filter(u => !ids.has(u.id));
        chosen.forEach(removePlayerUnit);
        const upgraded = createPlayerUnit(weaponId, tier + 1, x, z);
        upgraded.mesh.userData.mergeT = 1;
        player.soldiers.push(upgraded);
        const def = WEAPON_DEFS[weaponId];
        addImpactRing(x, .08, z, def.color, 3 + tier * .5);
        addParticles(x, 1.2, z, def.css, 20 + tier * 4, .3);
        const nextTier = tier + 1;
        const skill = TIER_SKILLS[nextTier];
        addFloatText(x, 3.7, z, `${def.label} T${nextTier}!`, def.css, 5.2);
        if (skill) addFloatText(x, 4.45, z, skill.label, "#fff4aa", 5.2);
        flashScreen(def.css, .22);
        merged = true;
        break;
      }
      if (merged) break;
    }
  }
}

function recruitSoldiers(count, weaponId = null) {
  for (let i = 0; i < count; i++) addSoldierUnit(weaponId || pickRecruitWeapon());
}

function damageUnit(unit, amount = 1) {
  if (!unit) return false;
  unit.armor -= amount;
  unit.mesh.userData.hit = 1;
  if (unit.armor > 0) return false;
  player.soldiers = player.soldiers.filter(u => u.id !== unit.id);
  removePlayerUnit(unit);
  return true;
}

function setSquadSize(n) {
  n = clamp(n, 0, MAX_SQUAD);
  while (player.soldiers.length < n) {
    if (!addSoldierUnit(pickRecruitWeapon(), 1, { silent: true })) break;
  }
  while (player.soldiers.length > n) {
    const unit = player.soldiers.slice().sort((a, b) => a.tier - b.tier || a.armor - b.armor)[0];
    player.soldiers = player.soldiers.filter(u => u.id !== unit.id);
    removePlayerUnit(unit);
  }
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
  const groupSize = Math.min(1 + Math.floor(Math.random() * difficulty * 1.6), 6);
  const baseX = rand(-ROAD_HALF + 1.5, ROAD_HALF - 1.5);
  for (let i = 0; i < groupSize; i++) {
    const roll = Math.random();
    const type = roll < 0.62 ? "normal" : roll < 0.85 ? "shield" : "heavy";
    let mesh, hp, speed, radius, sc, contactDmg = 1;
    if (type === "normal") {
      /* 普通兵:1 血,速度快 */
      mesh = makeSoldier(0xd93030);
      hp = 1;
      speed = rand(0.10, 0.16) + difficulty * 0.012;
      radius = 0.75; sc = 10;
    } else if (type === "shield") {
      /* 盾兵:持盾牌,需多次攻击 */
      mesh = makeSoldier(0x607d8b);
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 1.25, 0.12),
        new THREE.MeshStandardMaterial({ color: 0xb9d2dc, metalness: .45, roughness: .35, flatShading: true })
      );
      plate.position.set(0, 0.78, -0.62);
      mesh.userData.rig.add(plate);
      hp = 6 + Math.floor(difficulty * 3);
      speed = rand(0.07, 0.10);
      radius = 0.85; sc = 30;
    } else {
      /* 重装兵:移动慢,撞到损失 2 名士兵 */
      mesh = makeSoldier(0x8e1b1b);
      mesh.scale.set(1.7, 1.7, 1.7);
      hp = 12 + Math.floor(difficulty * 4);
      speed = rand(0.04, 0.06);
      radius = 1.25; sc = 50;
      contactDmg = 2;
    }
    mesh.position.set(
      clamp(baseX + rand(-3, 3), -ROAD_HALF + 1, ROAD_HALF - 1),
      0, SPAWN_Z + rand(-12, 0)
    );
    mesh.rotation.y = Math.PI;   // 面向玩家
    scene.add(mesh);
    const e = { id: nextEnemyId++, mesh, hp, maxHp: hp, type, speed, radius, score: sc, contactDmg };
    attachHpLabel(e);
    enemies.push(e);
  }
}

/* 敌人击碎:按兵种颜色炸出方块碎片 */
function shatterEnemy(e) {
  const ep = e.mesh.position;
  const colors = e.type === "shield" ? ["#607d8b", "#b0bec5", "#2f3640"] :
                 e.type === "heavy"  ? ["#8e1b1b", "#5c1212", "#2f3640"] :
                                       ["#d93030", "#2f3640", "#ffcc99"];
  const n = e.type === "heavy" ? 26 : 16;
  const hMul = e.type === "heavy" ? 1.6 : 1;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(particleGeo, pMat(colors[i % colors.length]));
    m.position.set(ep.x + rand(-0.4, 0.4), rand(0.2, 1.6) * hMul, ep.z + rand(-0.3, 0.3));
    m.scale.setScalar(rand(0.8, 2.6));
    m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    particles.push({
      mesh: m, vx: rand(-0.3, 0.3), vy: rand(0.1, 0.38), vz: rand(-0.25, 0.25),
      rx: rand(-.2,.2), ry: rand(-.2,.2), rz: rand(-.2,.2), life: rand(25, 50)
    });
    scene.add(m);
  }
}

/* 击杀结算:得分 + 连杀链 */
function killEnemy(e) {
  e.dead = true;
  kills++;
  score += e.score;
  const ep = e.mesh.position;
  shatterEnemy(e);
  addImpactRing(ep.x, .08, ep.z, e.type === "shield" ? 0x8dd8ed : 0xff765f, e.type === "heavy" ? 2.6 : 1.5);
  addFloatText(ep.x, 2.2, ep.z, "+" + e.score, "#ffd54f");
  addShake(e.type === "heavy" ? 0.16 : 0.07);
  combo++;
  comboTimer = 150;   // 2.5 秒内继续击杀可延续连杀
  if (combo === 5)  { critT = 600; addFloatText(player.x, 5, -8, "连杀×5 暴击模式!", "#ffb300", 6.5); }
  if (combo === 10) { player.spreadT = Math.max(player.spreadT, 600); addFloatText(player.x, 5, -8, "连杀×10 子弹扩散!", "#ba68c8", 6.5); }
  if (combo >= 15)  { player.slowT = Math.max(player.slowT, 420); addFloatText(player.x, 5, -8, "连杀×15 时间减速!", "#fff176", 6.5); combo = 0; }
}

/* ================= 选择门(Left / Right Gate) ================= */
/* 门效果池:正负混合,每对门随机抽两个不同效果,穿门前看清颜色与文字! */
const GATE_EFFECTS = [
  { text: "攻击 +3",   color: 0xff7043, css: "#ff9a76", good: true,
    apply() { player.damageBonus += 3; } },
  { text: "射速 +20%", color: 0x4fc3f7, css: "#8fd9ff", good: true,
    apply() { player.fireRateMul = Math.max(.45, player.fireRateMul * .8); } },
  { text: "+2 兵",     color: 0x8bc34a, css: "#aed581", good: true,
    apply() { recruitSoldiers(2); } },
  { text: "攻击 -3",   color: 0xb71c1c, css: "#ef5350", good: false,
    apply() { player.damageBonus = Math.max(0, player.damageBonus - 3); } },
  { text: "射速 -20%", color: 0x5d4037, css: "#bcaaa4", good: false,
    apply() { player.fireRateMul = Math.min(1.8, player.fireRateMul * 1.25); } },
  { text: "-2 兵",     color: 0x7b1fa2, css: "#ce93d8", good: false,
    apply() { setSquadSize(player.soldiers.length - 2); player.hurtT = 18; } },
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
  /* 随机抽两个不同效果(可能全增益、全减益或混合,需要抉择) */
  const i = Math.floor(Math.random() * GATE_EFFECTS.length);
  let j = Math.floor(Math.random() * (GATE_EFFECTS.length - 1));
  if (j >= i) j++;
  const left = GATE_EFFECTS[i], right = GATE_EFFECTS[j];
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

/* ================= 阻碍墙壁 ================= */
/* 单面墙壁挡住部分路宽:被扫到的士兵直接阵亡,子弹也会被阻挡 */
function makeWallTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#909090"; g.fillRect(0, 0, 256, 128);            // 混凝土底
  for (let i = 0; i < 90; i++) {
    g.fillStyle = Math.random() < .5 ? "#878787" : "#9c9c9c";
    g.fillRect(Math.random() * 256, Math.random() * 128, 7, 7);
  }
  g.fillStyle = "#6f6f6f"; g.fillRect(0, 34, 256, 4); g.fillRect(0, 82, 256, 4);  // 砌缝
  for (let x = -32; x < 288; x += 32) {                            // 顶部黄黑警示斜纹
    g.fillStyle = ((x / 32) % 2 === 0) ? "#fbc02d" : "#212121";
    g.beginPath();
    g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 4, 24); g.lineTo(x - 12, 24);
    g.closePath(); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const wallGeo = new THREE.BoxGeometry(1, 2.2, 0.7);
const wallMat = new THREE.MeshStandardMaterial({ map: makeWallTexture(), roughness: .86, metalness: .02 });
function spawnWall() {
  const halfW = rand(2.0, 3.6);                                    // 挡住 1/4 ~ 1/2 路宽
  const m = new THREE.Mesh(wallGeo, wallMat);
  m.scale.x = halfW * 2;
  m.position.set(rand(-ROAD_HALF + halfW, ROAD_HALF - halfW), 1.1, SPAWN_Z - 4);
  scene.add(m);
  walls.push({ mesh: m, halfW, hit: false });
}

/* ================= 道具生效 ================= */
function applyReward(crate) {
  const { x, z } = { x: crate.mesh.position.x, z: crate.mesh.position.z };
  const r = crate.reward;
  addParticles(x, 1.2, z, r.color, 24, 0.3);
  addImpactRing(x, .08, z, r.color, 2.2);
  flashScreen(r.color, .28);
  addFloatText(x, 3, z, r.label, r.color);
  switch (r.type) {
    case "weapon":   addSoldierUnit(r.weaponId); break;
    case "firerate": player.fireRateMul = Math.max(.45, player.fireRateMul * .88); break;
    case "damage":   player.damageBonus += 1; break;
    case "spread":   player.spreadT = 600; break;                        // 10 秒散弹
    case "shield":   player.shield = Math.min(player.shield + 3, 9); break;
    case "slow":     player.slowT = 420; break;                          // 7 秒减缓
    case "coin":     score += 150; break;
    case "bomb": {
      addParticles(x, 1.5, z, "#ff9800", 40, 0.5);
      addImpactRing(x, .1, z, 0xff9800, 5.5);
      addShake(0.4);
      for (const e of enemies) {
        e.dead = true;
        kills++; score += e.score;
        shatterEnemy(e);
      }
      addFloatText(player.x, 4, -6, "全屏轰炸!", "#ff9800");
      break;
    }
  }
  score += 30;
}

function fireUnitWeapon(unit, p) {
  const def = WEAPON_DEFS[unit.weaponId] || WEAPON_DEFS.rifle;
  const tierMul = Math.pow(MERGE_POWER, unit.tier - 1);
  const damage = Math.max(1, (def.damage + player.damageBonus) * tierMul);
  let dirs = [0];
  if (def.type === "shotgun") dirs = [-.2, -.1, 0, .1, .2];
  else if (def.type === "smg") dirs = [rand(-.035, .035)];
  if (unit.tier === 2) dirs = dirs.flatMap(vx => [vx - .07, vx + .07]);
  if (unit.tier === 4) dirs = dirs.flatMap(vx => [vx - .16, vx, vx + .16]);
  if (unit.tier >= 5) dirs = dirs.flatMap(vx => [vx - .22, vx - .11, vx, vx + .11, vx + .22]);
  if (player.spreadT > 0 && def.type !== "shotgun") dirs = [-.12, 0, .12];
  else if (player.spreadT > 0) dirs = [-.28, -.2, -.1, 0, .1, .2, .28];

  unit.fireCd = Math.max(4, def.fireRate * player.fireRateMul);
  unit.mesh.userData.recoil = 1;
  if (unit.tier >= 4) {
    addImpactRing(p.x, 1.05, p.z - .85, def.color, unit.tier === 5 ? 1.7 : 1.15);
    addParticles(p.x, 1.18, p.z - .85, def.css, unit.tier === 5 ? 9 : 5, .16);
  }
  addMuzzleFlash(p.x + .1, p.z - 1.15);
  for (const vx of dirs) {
    const mesh = new THREE.Mesh(bulletGeo, bulletMaterial(unit.weaponId));
    mesh.position.set(p.x + .1, 1.04 + unit.tier * .025, p.z - 1.0);
    mesh.rotation.y = Math.atan2(-vx, def.speed);
    if (def.type === "rocket") mesh.scale.set(2.2, 2.2, 2.8);
    else if (def.type === "laser") mesh.scale.set(.72, .72, 3.2);
    else if (def.type === "pierce") mesh.scale.z = 1.8;
    mesh.add(new THREE.Mesh(trailGeo, trailMat));
    scene.add(mesh);
    bullets.push({
      mesh, weaponId: unit.weaponId, type: def.type, vx, dmg: damage,
      px: mesh.position.x, pz: mesh.position.z, speed: def.speed,
      pierce: Math.max(def.pierce || 1, unit.tier >= 3 ? 2 + unit.tier : 1),
      radius: def.radius || (unit.tier >= 5 ? 1.35 : 0), starburst: unit.tier >= 5, hitIds: new Set(),
    });
  }
}

function explodeProjectile(b, x, z) {
  const radius = b.radius || 2.8;
  addParticles(x, 1.1, z, "#ff8a5c", 28, .42);
  addImpactRing(x, .08, z, 0xff7a55, radius * 1.35);
  addShake(.18); flashScreen("#ff8a5c", .2);
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = e.mesh.position.x - x, dz = e.mesh.position.z - z;
    if (dx * dx + dz * dz <= radius * radius) {
      e.hp -= b.dmg;
      e.mesh.userData.hit = 1;
      drawHpLabel(e);
      if (e.hp <= 0) killEnemy(e);
    }
  }
  if (boss) {
    const dx = boss.mesh.position.x - x, dz = boss.mesh.position.z - z;
    if (dx * dx + dz * dz <= radius * radius) damageBoss(b.dmg, x, z);
  }
}

function clearHazardsForBoss() {
  enemies.forEach(removeEnemy); enemies = [];
  crates.forEach(disposeCrate); crates = [];
  gates.forEach(disposeGate); gates = [];
  walls.forEach(w => scene.remove(w.mesh)); walls = [];
}

function makeBossModel(def, bossNumber) {
  const weaponIds = ["smg", "shotgun", "sniper", "rocket", "laser"];
  const mesh = makeSoldier(def.color, weaponIds[(bossNumber - 1) % weaponIds.length], 5);
  mesh.scale.setScalar(2.65);
  const armorMat = new THREE.MeshStandardMaterial({
    color: def.accent, emissive: def.accent, emissiveIntensity: .28, metalness: .38, roughness: .32, flatShading: true
  });
  const coreMat = new THREE.MeshBasicMaterial({ color: def.accent, toneMapped: false });
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.IcosahedronGeometry(.34, 0), armorMat);
    shoulder.position.set(side * .58, 1.3, 0); mesh.userData.rig.add(shoulder);
  }
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.18, 0), coreMat);
  core.position.set(0, 1.05, -.39); mesh.userData.rig.add(core);
  mesh.userData.bossCore = core;
  return mesh;
}

function beginBossBattle() {
  clearHazardsForBoss();
  bossHazards.forEach(disposeBossHazard);
  bossHazards = [];
  const bossNumber = bossCount + 1;
  const def = BOSS_DEFS[(bossNumber - 1) % BOSS_DEFS.length];
  const maxHp = Math.round(420 * Math.pow(1.7, bossNumber - 1));
  const mesh = makeBossModel(def, bossNumber);
  mesh.position.set(0, 0, -58); mesh.rotation.y = Math.PI;
  scene.add(mesh);
  boss = { number: bossNumber, def, mesh, hp: maxHp, maxHp, attackCd: 150, attackIndex: 0, summoned65: false, summoned35: false, introT: 110 };
  bossBarEl.classList.remove("hidden");
  bossNameEl.textContent = `BOSS ${bossNumber} · ${def.name}`;
  updateBossBar();
  addFloatText(0, 6, -24, `${def.name} 登场!`, "#ffdd77", 7);
  flashScreen("#ffce73", .36); addShake(.38);
}

function updateBossBar() {
  if (!boss) return;
  const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
  bossFillEl.style.transform = `scaleX(${ratio})`;
  bossHpEl.textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
}

function damageBoss(amount, x, z) {
  if (!boss || boss.introT > 0) return;
  boss.hp -= amount;
  boss.mesh.userData.hit = 1;
  addParticles(x, 2.2, z, boss.def.accent, 5, .18);
  if (frame % 3 === 0) updateBossBar();
  if (boss.hp <= 0) defeatBoss();
}

function unlockBossWeapon(bossNumber) {
  const def = BOSS_DEFS[(bossNumber - 1) % BOSS_DEFS.length];
  const weaponId = def.unlock;
  if (!weaponId || saveData.unlockedWeapons.includes(weaponId)) return null;
  saveData.unlockedWeapons.push(weaponId);
  saveData.unlockedWeapons = WEAPON_ORDER.filter(id => saveData.unlockedWeapons.includes(id));
  return weaponId;
}

function defeatBoss() {
  if (!boss) return;
  const defeated = boss;
  const unlock = unlockBossWeapon(defeated.number);
  score += 600 * defeated.number;
  saveData.highestBoss = Math.max(saveData.highestBoss, defeated.number);
  saveData.bestScore = Math.max(saveData.bestScore, Math.floor(score));
  saveData.bestDistance = Math.max(saveData.bestDistance, Math.floor(distance));
  persistSave();
  shatterBoss(defeated);
  scene.remove(defeated.mesh); disposeSoldierMesh(defeated.mesh);
  bossHazards.forEach(disposeBossHazard);
  bossHazards = [];
  boss = null; bossCount++; nextBossDistance += 500; bossWarning = false;
  bossBarEl.classList.add("hidden");
  if (unlock) {
    const def = WEAPON_DEFS[unlock];
    addSoldierUnit(unlock, 1, { silent: true });
    addFloatText(player.x, 5.2, PLAYER_Z - 5, `解锁 ${def.label}!`, def.css, 6.2);
    flashScreen(def.css, .4);
  } else {
    recruitSoldiers(2);
    addFloatText(player.x, 5.2, PLAYER_Z - 5, "Boss击破!", "#ffe27a", 6.2);
  }
  addImpactRing(0, .08, -22, defeated.def.accent, 8);
  addShake(.45);
  spawnEnemyCd = 150; spawnCrateCd = 100; spawnGateCd = 360; spawnWallCd = 300;
}

function shatterBoss(target) {
  const p = target.mesh.position;
  addParticles(p.x, 2.5, p.z, target.def.accent, mobileDevice ? 65 : 95, .62);
  addParticles(p.x, 2.0, p.z, "#ffdf8a", mobileDevice ? 35 : 55, .5);
}

function disposeBossHazard(h) {
  scene.remove(h.mesh);
  h.mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
  });
  h.materials.forEach(m => m.dispose());
}

function bossHazardMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, toneMapped: false
  });
}

function createBossHazard(kind, x, z = -9) {
  const mesh = new THREE.Group();
  const materials = [];
  const addGroundMarker = (geometry, color, opacity, y = 0) => {
    const material = bossHazardMaterial(color, opacity);
    const marker = new THREE.Mesh(geometry, material);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = y;
    marker.renderOrder = 3;
    mesh.add(marker); materials.push(material);
    return marker;
  };

  let core;
  if (kind === "lane") {
    core = addGroundMarker(new THREE.PlaneGeometry(3.25, 36), 0xff263d, .34);
    addGroundMarker(new THREE.PlaneGeometry(.15, 35.4), 0xffe36a, .8, .012).position.x = -1.42;
    addGroundMarker(new THREE.PlaneGeometry(.15, 35.4), 0xffe36a, .8, .012).position.x = 1.42;
    for (const offset of [-.7, 0, .7]) {
      const stripe = addGroundMarker(new THREE.PlaneGeometry(.22, 33), 0xff5c68, .48, .018);
      stripe.position.x = offset;
    }
  } else {
    core = addGroundMarker(new THREE.CircleGeometry(1.58, 36), 0xff5a2e, .46);
    addGroundMarker(new THREE.RingGeometry(1.22, 1.52, 36), 0xffd95c, .92, .018);
    const beaconMat = bossHazardMaterial(0xffd168, .92);
    const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(.28, 1), beaconMat);
    beacon.position.y = .38; beacon.renderOrder = 4;
    mesh.add(beacon); materials.push(beaconMat);
    mesh.userData.beacon = beacon;
  }

  mesh.position.set(x, .06, z);
  scene.add(mesh);
  bossHazards.push({ kind, x, z, mesh, core, materials, timer: kind === "lane" ? 74 : 62, maxTimer: kind === "lane" ? 74 : 62, radius: 1.55 });
}

function launchBossAttack() {
  if (!boss) return;
  const core = boss.mesh.userData.bossCore;
  if (core) core.scale.setScalar(2.4);
  addParticles(boss.mesh.position.x, 3.4, boss.mesh.position.z + 1, boss.def.accent, 16, .28);
  if (boss.attackIndex % 2 === 0) {
    const lane = clamp(Math.round(player.x / 4) * 4, -4, 4);
    createBossHazard("lane", lane, -12);
    addFloatText(lane, 3.3, -10, "危险车道!", "#ff6673", 4.2);
  } else {
    for (let i = 0; i < 3; i++) createBossHazard("missile", clamp(player.x + rand(-3.2, 3.2), -6.5, 6.5), rand(-1.5, 3.5));
    addFloatText(player.x, 3.3, -6, "导弹来袭!", "#ffad61", 4.2);
  }
  boss.attackIndex++;
  boss.attackCd = Math.max(120, 245 - boss.number * 9);
}

function resolveBossHazard(h) {
  let hits = 0;
  for (const unit of player.soldiers.slice()) {
    const p = unit.mesh.position;
    const inside = h.kind === "lane" ? Math.abs(p.x - h.x) < 1.6 : ((p.x - h.x) ** 2 + (p.z - h.z) ** 2 < h.radius ** 2);
    if (!inside) continue;
    hits++;
    damageUnit(unit, 1 + Math.floor((boss?.number || 1) / 3));
    addParticles(p.x, 1.1, p.z, h.kind === "lane" ? "#ff5b68" : "#ff9a5b", 12, .3);
  }
  if (hits) { player.hurtT = 18; addShake(.34); flashScreen("#ff4f58", .36); }
  addImpactRing(h.x, .08, h.z, h.kind === "lane" ? 0xff4c5d : 0xff914d, h.kind === "lane" ? 4 : 2.5);
}

function spawnBossMinions() {
  const count = Math.min(2 + Math.ceil((boss?.number || 1) / 2), 6);
  for (let i = 0; i < count; i++) {
    const hp = 3 + (boss?.number || 1) * 2;
    const mesh = makeSoldier(0xc83b42, "rifle", 1);
    mesh.position.set(rand(-6, 6), 0, -42 - rand(0, 8)); mesh.rotation.y = Math.PI; scene.add(mesh);
    const e = { id: nextEnemyId++, mesh, hp, maxHp: hp, type: "normal", speed: .11 + (boss?.number || 1) * .008, radius: .75, score: 25, contactDmg: 1 };
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
  if (boss.introT > 0) { boss.introT--; return; }
  boss.attackCd -= timeMul;
  if (boss.attackCd <= 0) launchBossAttack();
  const ratio = boss.hp / boss.maxHp;
  if (!boss.summoned65 && ratio <= .65) { boss.summoned65 = true; spawnBossMinions(); }
  if (!boss.summoned35 && ratio <= .35) { boss.summoned35 = true; spawnBossMinions(); }

  for (const h of bossHazards) {
    h.timer -= timeMul;
    const k = h.timer / h.maxTimer;
    const pulse = .72 + Math.sin(h.timer * .55) * .2 + (1 - k) * .28;
    h.materials.forEach(m => m.opacity = Math.min(1, pulse));
    h.core.material.opacity = Math.min(.78, .25 + (1 - k) * .58);
    h.mesh.scale.setScalar(1 + (1 - k) * .12);
    if (h.mesh.userData.beacon) {
      const beacon = h.mesh.userData.beacon;
      beacon.rotation.y += .16 * timeMul;
      beacon.scale.setScalar(.7 + (1 - k) * .85 + Math.sin(h.timer * .45) * .16);
    }
    if (h.timer <= 0 && !h.resolved) { h.resolved = true; resolveBossHazard(h); }
  }
  bossHazards = bossHazards.filter(h => {
    if (h.timer <= 0) { disposeBossHazard(h); return false; }
    return true;
  });
}

/* ================= 更新 ================= */
function update() {
  frame++;
  const t = frame / 60;
  if (boss) worldSpeed = .06;
  else {
    distance += worldSpeed;
    worldSpeed = 0.25 + distance / 9000;
    if (!bossWarning && distance >= nextBossDistance - 50) {
      bossWarning = true;
      addFloatText(0, 6, -20, `Boss将在 ${Math.ceil(nextBossDistance - distance)}m 后出现`, "#ffcc66", 6.2);
      flashScreen("#ffb85c", .22);
    }
    if (distance >= nextBossDistance) beginBossBattle();
  }
  groundTex.offset.y += worldSpeed / 30;
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
  if (keys["arrowleft"]  || keys["a"]) { player.tx = null; player.x -= 0.22; }
  if (keys["arrowright"] || keys["d"]) { player.tx = null; player.x += 0.22; }
  if (player.tx != null) player.x += (player.tx - player.x) * 0.2;
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

  /* 子弹 */
  for (const b of bullets) {
    b.mesh.position.z -= b.speed || 1.2;
    b.mesh.position.x += b.vx;
    if (frame % 2 === 0) {                              // 每 2 帧铺一段残影,连成扫射光轨
      addTrailSeg(b.px, b.pz, b.mesh.position.x, b.mesh.position.z);
      b.px = b.mesh.position.x; b.pz = b.mesh.position.z;
    }
  }
  bullets = bullets.filter(b => {
    if (b.mesh.position.z < SPAWN_Z - 15 || b.dead) { scene.remove(b.mesh); return false; }
    return true;
  });

  /* 生成 */
  spawnEnemyCd--;
  if (!boss && !bossWarning && spawnEnemyCd <= 0) {
    spawnEnemyGroup();
    spawnEnemyCd = Math.max(32, 105 - distance / 15);
  }
  spawnCrateCd--;
  if (!boss && !bossWarning && spawnCrateCd <= 0) {
    crates.push(makeCrate(rand(-ROAD_HALF + 2, ROAD_HALF - 2), SPAWN_Z));
    spawnCrateCd = rand(280, 460);
  }
  spawnGateCd--;
  if (!boss && !bossWarning && spawnGateCd <= 0) {
    spawnGatePair();
    spawnGateCd = rand(650, 950);
  }
  spawnWallCd--;
  if (!boss && !bossWarning && spawnWallCd <= 0) {
    spawnWall();
    spawnWallCd = Math.max(280, rand(420, 640) - distance / 25);   // 越到后期越密
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
  gates = gates.filter(g => {
    if (g.group.position.z > 12) { disposeGate(g); return false; }
    return true;
  });

  /* 墙壁随卷轴前进 */
  for (const w of walls) w.mesh.position.z += worldSpeed;

  /* 敌人移动 */
  const slowMul = player.slowT > 0 ? 0.35 : 1;
  for (const e of enemies) {
    e.mesh.position.z += (e.speed * slowMul + worldSpeed * 0.5);
    e.mesh.position.x += Math.sin(t * 3 + e.mesh.userData.phase) * 0.015;
    animateWalk(e.mesh, t, 8, e.type === "heavy" ? .38 : .52);
  }
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

  /* 子弹命中 */
  for (const b of bullets) {
    if (b.dead) continue;
    const bp = b.mesh.position;
    // 墙壁阻挡
    for (const w of walls) {
      const wp = w.mesh.position;
      if (Math.abs(bp.x - wp.x) < w.halfW && Math.abs(bp.z - wp.z) < 0.9) {
        b.dead = true;
        if (b.type === "rocket" || b.starburst) explodeProjectile(b, bp.x, wp.z);
        else addParticles(bp.x, rand(0.6, 1.8), wp.z + 0.6, "#bdbdbd", 3, 0.12);
        break;
      }
    }
    if (b.dead) continue;
    // 箱子
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
        if (c.count <= 0) { applyReward(c); c.collected = true; }
        break;
      }
    }
    if (b.dead) continue;
    // Boss
    if (boss && !b.hitIds?.has("boss")) {
      const ep = boss.mesh.position;
      if (Math.abs(bp.x - ep.x) < 2.35 && Math.abs(bp.z - ep.z) < 2.5) {
        if (b.type === "rocket" || b.starburst) {
          b.dead = true;
          explodeProjectile(b, ep.x, ep.z);
        } else {
          b.hitIds?.add("boss");
          b.pierce--;
          if (b.pierce <= 0) b.dead = true;
          damageBoss(b.dmg, bp.x, bp.z);
        }
      }
    }
    if (b.dead) continue;
    // 敌人
    for (const e of enemies) {
      if (e.dead || b.hitIds?.has(e.id)) continue;
      const ep = e.mesh.position;
      const r = e.radius;
      if (Math.abs(bp.x - ep.x) < r && Math.abs(bp.z - ep.z) < r + 0.3) {
        if (b.type === "rocket" || b.starburst) {
          b.dead = true;
          explodeProjectile(b, ep.x, ep.z);
          break;
        }
        b.hitIds?.add(e.id);
        b.pierce--;
        if (b.pierce <= 0) b.dead = true;
        let dmg = b.dmg;
        const crit = critT > 0 && Math.random() < 0.35;
        if (crit) dmg *= 2;
        e.hp -= dmg;
        e.mesh.userData.hit = 1;
        drawHpLabel(e);                                                   // 实时刷新头顶血量
        const ty = e.type === "heavy" ? 4.4 : 3.0;
        if (crit) addFloatText(ep.x, ty, ep.z, "暴击 -" + dmg, "#ffb300", 3.6);
        else      addFloatText(ep.x, ty, ep.z, "-" + dmg, "#ff7043", 2.6);
        addParticles(bp.x, 1.1, bp.z, crit ? "#ffcf45" : "#ff685c", crit ? 8 : 4, 0.17);
        if (crit) addImpactRing(bp.x, 1.05, bp.z, 0xffc83d, 1.15);
        addShake(0.02);                                                   // 命中微震
        if (e.hp <= 0) killEnemy(e);
        break;
      }
    }
  }
  bullets = bullets.filter(b => { if (b.dead) { scene.remove(b.mesh); return false; } return true; });
  crates = crates.filter(c => {
    if (c.collected || c.mesh.position.z > 12) {
      disposeCrate(c);
      return false;
    }
    return true;
  });

  /* 敌人碰撞小队 */
  const collisionUnits = player.soldiers.slice();
  for (const e of enemies) {
    if (e.dead) continue;
    const ep = e.mesh.position;
    if (ep.z < PLAYER_Z - 1.6 || ep.z > PLAYER_Z + 2.4) continue;
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i], unit = collisionUnits[i];
      if (!unit || !player.soldiers.includes(unit)) continue;
      const dx = ep.x - p.x, dz = ep.z - p.z;
      if (dx * dx + dz * dz < 1.4) {
        e.dead = true;
        addParticles(ep.x, 1.2, ep.z, "#90caf9", 12, 0.3);
        if (player.shield > 0) {
          player.shield = Math.max(0, player.shield - e.contactDmg);
          addShake(0.12);
          addImpactRing(player.x, .08, PLAYER_Z, 0x66e7ff, 3.2);
          flashScreen("#66e7ff", .22);
          addFloatText(player.x, 3.2, PLAYER_Z - 1, "护盾抵挡!", "#4dd0e1");
        } else {
          const lost = damageUnit(unit, e.contactDmg);
          player.hurtT = 18;
          addShake(0.3);                                                  // 受击强震
          addImpactRing(player.x, .08, PLAYER_Z, 0xff5c64, 3.5);
          flashScreen("#ff4050", .42);
          addFloatText(player.x, 3.2, PLAYER_Z - 1, lost ? "士兵阵亡!" : "护甲 -" + e.contactDmg, "#ff5252");
        }
        break;
      }
    }
  }
  enemies = enemies.filter(e => {
    if (e.dead || e.mesh.position.z > 10) { removeEnemy(e); return false; }
    return true;
  });

  /* 墙壁撞击判定:墙体 x 范围内的士兵被撞倒,全灭则游戏结束 */
  for (const w of walls) {
    if (!w.hit && w.mesh.position.z >= PLAYER_Z - 0.6) {
      w.hit = true;
      const wx = w.mesh.position.x;
      let lost = 0, hitCount = 0;
      for (const unit of player.soldiers.slice()) {
        const s = unit.mesh;
        if (Math.abs(s.position.x - wx) < w.halfW + 0.25) {
          addParticles(s.position.x, 1.2, s.position.z, "#90caf9", 10, 0.28);
          hitCount++;
          if (damageUnit(unit, 3)) lost++;
        }
      }
      if (hitCount > 0) {
        player.hurtT = 18;
        addShake(0.3);
        addImpactRing(wx, .08, PLAYER_Z, 0xff5c64, 4.2);
        flashScreen("#ff4050", .42);
        addFloatText(wx, 3.6, PLAYER_Z - 1, lost ? "撞墙 -" + lost + "兵" : "护甲受损", "#ff5252");
      }
    }
  }
  walls = walls.filter(w => {
    if (w.mesh.position.z > 12) { scene.remove(w.mesh); return false; }
    return true;
  });

  if (player.soldiers.length <= 0 && running) { endGame(); return; }

  /* 弹道残影 / 枪口火光渐隐(收窄至消失) */
  for (const s of trailFx) {
    s.life--;
    const k = Math.max(s.life / s.maxLife, 0);
    if (s.flash) s.mesh.scale.setScalar(s.w * k);
    else { s.mesh.scale.x = s.mesh.scale.y = s.w * k; }
  }
  trailFx = trailFx.filter(s => { if (s.life <= 0) { scene.remove(s.mesh); return false; } return true; });

  /* 冲击波 */
  for (const fx of impactFx) {
    fx.life--;
    const k = Math.max(fx.life / fx.maxLife, 0);
    const progress = 1 - k;
    fx.mesh.scale.setScalar(.2 + progress * fx.size);
    fx.mesh.material.opacity = k * .72;
    fx.mesh.position.y += .004;
  }
  impactFx = impactFx.filter(fx => {
    if (fx.life <= 0) { scene.remove(fx.mesh); fx.material.dispose(); return false; }
    return true;
  });

  /* 粒子 */
  for (const p of particles) {
    p.mesh.position.x += p.vx;
    p.mesh.position.y += p.vy;
    p.mesh.position.z += p.vz;
    p.mesh.rotation.x += p.rx || 0;
    p.mesh.rotation.y += p.ry || 0;
    p.mesh.rotation.z += p.rz || 0;
    p.mesh.scale.multiplyScalar(.972);
    p.vy -= 0.012;
    p.vx *= .99; p.vz *= .99;
    p.life--;
  }
  particles = particles.filter(p => { if (p.life <= 0) { scene.remove(p.mesh); return false; } return true; });

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
  floatTexts = floatTexts.filter(ft => {
    if (ft.life <= 0) {
      scene.remove(ft.sprite);
      ft.sprite.material.map.dispose(); ft.sprite.material.dispose();
      return false;
    }
    return true;
  });

  /* 摄像机震动(位置抖动后自然衰减,基础视角保持固定) */
  shake *= 0.82;
  if (shake < 0.002) shake = 0;
  cameraFollowX += (player.x * .11 - cameraFollowX) * .06;
  camera.position.set(
    cameraFollowX + (Math.random() - 0.5) * 2 * shake,
    cameraBase.y + Math.sin(t * 3.5) * .025 + (Math.random() - 0.5) * 2 * shake,
    cameraBase.z
  );
  camera.lookAt(cameraFollowX * .55, .35, cameraBase.lookZ);

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
const buffsEl = document.getElementById("buffs");
const statusToggle = document.getElementById("statusToggle");
const statsPanel = document.getElementById("statsPanel");
const statsContent = document.getElementById("statsContent");
const statsClose = document.getElementById("statsClose");
const bossBarEl = document.getElementById("bossBar");
const bossNameEl = document.getElementById("bossName");
const bossFillEl = document.getElementById("bossFill");
const bossHpEl = document.getElementById("bossHp");
let uiPaused = false;
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
  setHudText(hScore, "★ " + Math.floor(score));
  setHudText(hDist, Math.floor(distance) + " m");
  setHudText(hArmy, "小队 ×" + player.soldiers.length, true);
  setHudText(hPower, "战力 " + Math.round(totalPower()), true);
  let b = "";
  for (const weaponId of WEAPON_ORDER) {
    const units = player.soldiers.filter(u => u.weaponId === weaponId);
    if (!units.length) continue;
    const tiers = [];
    for (let tier = MAX_TIER; tier >= 1; tier--) {
      const count = units.filter(u => u.tier === tier).length;
      if (count) tiers.push(`T${tier}×${count}`);
    }
    const def = WEAPON_DEFS[weaponId];
    b += `<span style="color:${def.css}">${def.label} ${tiers.join(" ")}</span>`;
  }
  if (combo >= 2)         b += `<span style="color:#ff5722">连杀 ×${combo}</span>`;
  if (critT > 0)          b += `<span style="color:#ffb300">暴击模式 ${Math.ceil(critT / 60)}s</span>`;
  if (player.shield > 0)  b += `<span style="color:#4dd0e1">🛡 护盾 ×${player.shield}</span>`;
  if (player.spreadT > 0) b += `<span style="color:#ba68c8">散弹 ${Math.ceil(player.spreadT / 60)}s</span>`;
  if (player.slowT > 0)   b += `<span style="color:#fff176">减缓 ${Math.ceil(player.slowT / 60)}s</span>`;
  if (player.damageBonus > 0) b += `<span style="color:#ff8a65">火力 +${player.damageBonus}</span>`;
  if (player.fireRateMul < 1) b += `<span style="color:#4fc3f7">射速 +${Math.round((1 / player.fireRateMul - 1) * 100)}%</span>`;
  buffsEl.innerHTML = b;
}

function renderStatsPanel() {
  const rows = [];
  rows.push(["总战力", Math.round(totalPower())]);
  rows.push(["击杀 / 距离", `${kills} / ${Math.floor(distance)}m`]);
  rows.push(["全队攻击加成", `+${player.damageBonus}`]);
  rows.push(["全队射速", `${Math.round(100 / player.fireRateMul)}%`]);
  rows.push(["护盾", player.shield]);
  rows.push(["编队护甲", `${player.soldiers.reduce((s,u)=>s+Math.max(0,u.armor),0)} / ${player.soldiers.reduce((s,u)=>s+u.maxArmor,0)}`]);
  for (const weaponId of WEAPON_ORDER) {
    const def = WEAPON_DEFS[weaponId];
    const units = player.soldiers.filter(u => u.weaponId === weaponId);
    const unlocked = saveData.unlockedWeapons.includes(weaponId);
    if (!unlocked && !units.length) continue;
    const tiers = [];
    for (let tier = MAX_TIER; tier >= 1; tier--) {
      const count = units.filter(u => u.tier === tier).length;
      if (count) tiers.push(`T${tier}×${count}`);
    }
    rows.push([def.label, units.length ? tiers.join(" · ") : "已解锁"]);
  }
  if (player.spreadT > 0) rows.push(["散弹增益", `${Math.ceil(player.spreadT / 60)}秒`]);
  if (player.slowT > 0) rows.push(["时间减缓", `${Math.ceil(player.slowT / 60)}秒`]);
  if (critT > 0) rows.push(["暴击模式", `${Math.ceil(critT / 60)}秒`]);
  rows.push(["最高Boss", saveData.highestBoss]);
  rows.push(["历史最佳", `${saveData.bestScore}分 / ${saveData.bestDistance}m`]);
  statsContent.innerHTML = rows.map(([title, value]) => `<div class="stat-row"><span class="stat-title">${title}</span><b>${value}</b></div>`).join("");
}
statusToggle.addEventListener("click", () => {
  if (!running) return;
  clearInputState(); renderStatsPanel(); uiPaused = true; accumulator = 0; statsPanel.classList.remove("hidden");
});
statsClose.addEventListener("click", () => {
  statsPanel.classList.add("hidden"); uiPaused = false; lastLoopTime = performance.now(); accumulator = 0;
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
  const weapons = saveData.unlockedWeapons.map(id => WEAPON_DEFS[id]?.label).filter(Boolean).join(" · ");
  progressText.textContent = `已解锁：${weapons}　最高Boss：${saveData.highestBoss}　最远：${saveData.bestDistance}m`;
}
renderProgressText();

if (mobileDevice) controlText.textContent = "按住屏幕左右滑动来移动小队";

let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  installBtn.classList.remove("hidden");
});
installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installBtn.classList.add("hidden");
});
window.addEventListener("appinstalled", () => {
  installBtn.classList.add("hidden");
  installTip.classList.add("hidden");
});

function clearWorld() {
  for (const a of [bullets, particles, trailFx]) a.forEach(o => scene.remove(o.mesh));
  impactFx.forEach(fx => { scene.remove(fx.mesh); fx.material.dispose(); });
  impactFx = [];
  enemies.forEach(removeEnemy);
  crates.forEach(disposeCrate);
  gates.forEach(disposeGate);
  gates = [];
  walls.forEach(w => scene.remove(w.mesh));   // 几何/材质共享,无需 dispose
  walls = [];
  if (boss) { scene.remove(boss.mesh); disposeSoldierMesh(boss.mesh); boss = null; }
  bossHazards.forEach(disposeBossHazard);
  bossHazards = [];
  bossBarEl.classList.add("hidden");
  floatTexts.forEach(ft => { scene.remove(ft.sprite); ft.sprite.material.map.dispose(); ft.sprite.material.dispose(); });
  bullets = []; enemies = []; crates = []; particles = []; floatTexts = []; trailFx = [];
}

function startGame() {
  if (demoSoldier.parent) { scene.remove(demoSoldier); disposeSoldierMesh(demoSoldier); }
  clearWorld();
  camera.position.set(0, cameraBase.y, cameraBase.z);   // 复位摄像机(待机演示会移动它)
  camera.lookAt(0, 0, cameraBase.lookZ);
  setSquadSize(0);
  nextUnitId = 1; nextEnemyId = 1;
  player.x = 0; player.tx = null; player.vx = 0; player.lastX = 0;
  player.damageBonus = 0; player.fireRateMul = 1;
  player.shield = 0; player.spreadT = 0; player.slowT = 0; player.hurtT = 0;
  addSoldierUnit("rifle", 1, { silent: true });
  frame = 0; score = 0; kills = 0; distance = 0; worldSpeed = 0.25;
  combo = 0; comboTimer = 0; critT = 0; shake = 0;
  bossCount = 0; nextBossDistance = 500; bossWarning = false;
  cameraFollowX = 0; screenFlashT = 0;
  screenFlashEl.style.opacity = "0"; speedFxEl.style.opacity = "0";
  spawnEnemyCd = 60; spawnCrateCd = 130; spawnGateCd = 450; spawnWallCd = 320;
  overlay.classList.add("hidden");
  overlay.classList.remove("game-over");
  hud.classList.remove("hidden");
  statusToggle.classList.remove("hidden");
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
  statusToggle.classList.add("hidden");
  statsPanel.classList.add("hidden"); uiPaused = false;
  overlay.classList.add("game-over");
  overlay.classList.remove("hidden");
}
startBtn.addEventListener("click", () => { if (!running) startGame(); });

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
      accumulator += elapsed;
      while (running && accumulator >= FIXED_STEP) {
        update();
        accumulator -= FIXED_STEP;
      }
      if (!running) accumulator = 0;
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
      animateWalk(demoSoldier, t, 4.5, .34, Math.sin(t * .7) * .18);
      demoSoldier.rotation.y = Math.sin(t * .45) * .16;
    }
  }
  renderer.render(scene, camera);
}

/* 待机展示:放一个士兵 */
const demoSoldier = makeSoldier(0x1e88e5);
demoSoldier.position.set(0, 0, -2);
demoSoldier.scale.set(2, 2, 2);
scene.add(demoSoldier);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(() => {}));
}

loop();
