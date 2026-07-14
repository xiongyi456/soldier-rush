# 士兵冲锋 3D：司令之路

原创战斗 Q 版单人 3D 冲锋游戏。项目使用 Vite、TypeScript 和 Three.js，可作为网页/PWA运行，也已准备好通过 Capacitor 封装 Android 与 iOS。

## 当前玩法

- 只控制一名主角，角色自动射击，玩家通过键盘、鼠标或触屏左右移动。
- 从新兵、列兵、下士一路晋升到将军和司令，共13级军衔。
- 每次晋升暂停战斗，从攻击、防御、战术/支援三张技能卡中选择一项。
- 武器在关键军衔进化：步枪、冲锋枪、霰弹枪、狙击枪、火箭筒、激光枪。
- 新武器累计继承历史弹道、穿透、星爆和历史最快射速，升级后不会突然变慢。
- 主角拥有独立生命和护甲：护甲只吸收部分伤害，护甲耗尽后仍可战斗，生命归零才会结束游戏。Boss技能会优先造成明显的生命伤害。
- 武器采用分阶段总火力预算，多弹道主要增加覆盖范围，不再让后期伤害指数膨胀；普通敌人、远程兵、盾兵和重装兵会组成可读阵型。
- 250米后会出现远程兵，先在玩家当前位置显示约0.9秒锁定圈；及时换位可以完全躲开攻击。
- 武器箱打破后会掉落道路上的奖励核心，需要移动到附近拾取。经验、医疗、火力、护盾等奖励不再隔空自动生效。
- 道路上会出现地刺、延时地雷和电磁减速区，所有组合都会保留可躲避通道，陷阱不会挡住子弹。
- 每500米挑战一次 Boss。五种 Boss 分别拥有重炮、盾击、狙击、导弹和能量主题技能，生命会按当前实际输出估算，正常命中时目标战斗时长约10–15秒。
- 天气会在阴天、小雨、薄雾和黄昏之间变化，天气只影响画面，不改变命中和移动规则。
- 司令功勋圆满后可以授勋转生。本局军衔、武器与技能会重置，永久司令勋章保留。

## 技术结构

- Vite + TypeScript 严格模式
- Three.js ES Modules
- GLTFLoader、AnimationMixer、Meshopt、KTX2 资源管线
- EffectComposer 与分级辉光效果
- vite-plugin-pwa 离线缓存
- Capacitor Android/iOS 壳与原生存档适配
- 对象池复用高速弹道对象

当前仓库没有附带正式商业 GLB 角色模型，因此默认使用程序化原创战斗 Q 版角色。将符合规范的 `hero.glb` 放到 `public/assets/models/` 后即可接入骨骼模型；详细节点和动画命名见该目录的说明文件。

## 本地运行

需要 Node.js 与 npm。

```powershell
npm install
npm run dev
```

浏览器打开终端显示的地址。也可以在 Windows 中直接运行：

```powershell
./start-mobile-server.ps1
```

## 手机同一 Wi-Fi 试玩

```powershell
./start-mobile-server.ps1 -Port 8080
```

手机和电脑连接同一个 Wi-Fi，然后打开脚本显示的局域网地址，例如 `http://192.168.1.5:8080`。

## 构建与预览

```powershell
npm run build
npm run preview
```

生产文件生成在 `dist/`。PWA manifest 和 Service Worker 会由构建自动生成，不再手工维护缓存版本。

## Android / iOS

仓库已经包含 `android/` 和 `ios/` 平台工程。修改 Web 游戏后同步构建：

```powershell
npm run cap:sync
```

打开原生工程：

```powershell
npm run cap:android
npm run cap:ios
```

iOS 工程需要在 macOS/Xcode 中构建。Android 需要 Android Studio 和可用的 SDK。

## 操作方式

- 电脑：方向键、A/D 或鼠标拖动。
- 手机：按住画面左右滑动。
- 技能选择：点击技能卡，电脑也可按数字键 1、2、3。
- 状态按钮：查看军衔、武器、技能、生命、护甲、勋章和转生状态。

## 存档兼容

- Web 使用 localStorage。
- Capacitor 原生版本使用 Preferences，并与 Web 存档适配器保持相同结构。
- v1 存档会自动迁移到 v2，保留已解锁武器、最高 Boss、最高分与最远距离。
- v2 新增司令勋章、转生次数和画质设置。

## 性能策略

- 中端手机以60 FPS为目标，低性能设备降低像素比、粒子、雨滴和后处理。
- 主角正式模型建议15k–25k三角面、1K纹理、70根以内骨骼。
- 核心首屏资源建议压缩后控制在12 MB以内，Boss模型按需加载。
