export type SkillCategory = "attack" | "defense" | "tactical" | "support";

export interface SkillDefinition {
  id: string;
  name: string;
  category: SkillCategory;
  icon: string;
  maxLevel: number;
  description: (nextLevel: number) => string;
}

export const SKILL_DEFS: readonly SkillDefinition[] = [
  { id: "firepower", name: "火力训练", category: "attack", icon: "🔥", maxLevel: 5, description: l => `总伤害提高 ${l * 10}%` },
  { id: "reload", name: "快速装填", category: "attack", icon: "⚡", maxLevel: 5, description: l => `射击间隔累计缩短 ${l * 6}%` },
  { id: "critical", name: "暴击专精", category: "attack", icon: "✦", maxLevel: 4, description: l => `常驻暴击率提高 ${l * 6}%` },
  { id: "split", name: "分裂弹道", category: "attack", icon: "⑂", maxLevel: 3, description: l => `增加第 ${l} 对分裂弹道` },
  { id: "pierce", name: "穿甲弹", category: "attack", icon: "➹", maxLevel: 4, description: l => `额外穿透 ${l} 个目标` },
  { id: "blast", name: "爆破专家", category: "attack", icon: "💥", maxLevel: 4, description: l => `爆炸范围 +${l * 12}%，爆炸伤害 +${l * 10}%` },
  { id: "ricochet", name: "弹射核心", category: "attack", icon: "↺", maxLevel: 3, description: l => `命中后弹射至附近敌人，最多 ${l} 次，伤害 55%` },
  { id: "armor", name: "强化装甲", category: "defense", icon: "🛡", maxLevel: 5, description: l => `最大护甲累计 +${l * 8}` },
  { id: "shield", name: "护盾发生器", category: "defense", icon: "⬡", maxLevel: 4, description: l => `每 ${28 - l * 3} 次击杀获得护盾` },
  { id: "repair", name: "战地维修", category: "defense", icon: "✚", maxLevel: 3, description: l => `击败 Boss 后恢复 ${[20, 35, 50][l - 1]}% 护甲` },
  { id: "danger", name: "危险感知", category: "defense", icon: "◉", maxLevel: 4, description: l => `${l * 10}% 概率闪避陷阱或接触伤害` },
  { id: "study", name: "战场学习", category: "tactical", icon: "★", maxLevel: 5, description: l => `经验获取提高 ${l * 12}%` },
  { id: "combo", name: "连杀维持", category: "tactical", icon: "∞", maxLevel: 4, description: l => `连杀窗口延长 ${(l * .75).toFixed(2)} 秒` },
  { id: "supply", name: "军需专家", category: "tactical", icon: "▣", maxLevel: 4, description: l => `武器箱所需命中减少 ${l * 8}%` },
  { id: "mines", name: "感应地雷", category: "tactical", icon: "◎", maxLevel: 3, description: l => `击杀时 ${[35, 50, 65][l - 1]}% 埋雷，半径内造成 ${[1.2, 1.6, 2.1][l - 1]} 倍弹伤` },
  { id: "drone", name: "僚机支援", category: "support", icon: "◆", maxLevel: 3, description: l => `部署 ${l} 架自动射击僚机` },
  { id: "airstrike", name: "自动空袭", category: "support", icon: "☄", maxLevel: 3, description: l => `每 ${[30, 24, 18][l - 1]} 次击杀发动空袭` },
  { id: "salvo", name: "齐射支援", category: "support", icon: "⇉", maxLevel: 3, description: l => `每 ${[7, 5.5, 4][l - 1]} 秒自动向最近敌人齐射 ${2 + l} 发` },
] as const;

export type SkillLevels = Record<string, number>;

export function skillLevel(levels: SkillLevels, id: string): number {
  return Math.max(0, levels[id] ?? 0);
}

export function chooseSkillOptions(levels: SkillLevels, random = Math.random): SkillDefinition[] {
  const available = SKILL_DEFS.filter(skill => skillLevel(levels, skill.id) < skill.maxLevel);
  const take = (category: SkillCategory): SkillDefinition | undefined => {
    const group = available.filter(skill => skill.category === category);
    return group.length ? group[Math.floor(random() * group.length)] : undefined;
  };
  const selected: SkillDefinition[] = [];
  for (const category of ["attack", "defense"] as const) {
    const item = take(category);
    if (item) selected.push(item);
  }
  const utility = available.filter(skill => skill.category === "tactical" || skill.category === "support");
  if (utility.length) selected.push(utility[Math.floor(random() * utility.length)]);
  for (const skill of available.sort(() => random() - .5)) {
    if (selected.length >= 3) break;
    if (!selected.some(item => item.id === skill.id)) selected.push(skill);
  }
  return selected.slice(0, 3);
}
