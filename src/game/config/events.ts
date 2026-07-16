export type RunEventType = "elite" | "airdrop" | "horde";

export interface RunEventDefinition {
  type: RunEventType;
  label: string;
  color: string;
  distanceGap: number;
}

/** Mid-run events keep the 200–600m stretch from feeling like pure grind. */
export const RUN_EVENTS: readonly RunEventDefinition[] = [
  { type: "elite", label: "精英小队!", color: "#c79bff", distanceGap: 180 },
  { type: "airdrop", label: "紧急空投!", color: "#7dffe0", distanceGap: 180 },
  { type: "horde", label: "敌潮来袭!", color: "#ff8a65", distanceGap: 180 },
] as const;

export function nextEventDistance(currentDistance: number, eventIndex: number): number {
  const base = 180 + eventIndex * 180;
  return Math.max(base, Math.floor(currentDistance) + 1);
}

export function pickRunEvent(eventIndex: number): RunEventDefinition {
  return RUN_EVENTS[eventIndex % RUN_EVENTS.length];
}
