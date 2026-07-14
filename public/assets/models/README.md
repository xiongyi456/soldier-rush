# 角色 GLB 资源约定

将正式主角模型放在本目录并命名为 `hero.glb`。运行时当前会使用程序化战斗 Q 版角色作为回退，美术资产接入时通过 `AssetManager` 加载。

## 主角模型规范

- 角色约 3.5 个头高，15k–25k 三角面，骨骼不超过 70 根。
- 纹理使用 1K 图集；推荐 KTX2，模型推荐 Meshopt 压缩。
- 根节点朝向 `-Z`，脚底位于 `Y=0`，身高统一约 2.2 个 Three.js 单位。
- 武器插槽命名为 `weapon_socket_r`。
- 可切换装备节点：`gear_recruit`、`gear_nco`、`gear_officer`、`gear_senior`、`gear_commander`。
- 军衔徽章节点：`rank_01` 至 `rank_13`。

## 动画剪辑名称

- `idle`
- `run`
- `strafe_left`
- `strafe_right`
- `shoot_rifle`
- `shoot_heavy`
- `shoot_laser`
- `hit`
- `dodge`
- `rank_up`
- `death`
- `victory`
- `prestige`

模型缺失或加载失败时不得阻止游戏开始。
