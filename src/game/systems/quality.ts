export type QualityLevel = "high" | "medium" | "low";

export interface QualityProfile {
  level: QualityLevel;
  pixelRatio: number;
  particleCap: number;
  rainCount: number;
  bloom: boolean;
  dynamicShadows: boolean;
  targetFps: 30 | 60;
  rimFresnel: boolean;
  smoke: boolean;
}

export function detectQuality(mobile: boolean, lowPower: boolean, prefer: QualityLevel | "auto" = "auto"): QualityProfile {
  const level: QualityLevel =
    prefer === "high" || prefer === "medium" || prefer === "low"
      ? prefer
      : lowPower
        ? "low"
        : "high";

  if (level === "low") {
    return {
      level: "low",
      pixelRatio: 1,
      particleCap: 170,
      rainCount: 42,
      bloom: false,
      dynamicShadows: false,
      targetFps: 30,
      rimFresnel: false,
      smoke: false,
    };
  }

  if (level === "medium") {
    return {
      level: "medium",
      pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1.25 : 1.5),
      particleCap: mobile ? 220 : 300,
      rainCount: mobile ? 56 : 90,
      bloom: false,
      dynamicShadows: false,
      targetFps: 60,
      rimFresnel: false,
      smoke: true,
    };
  }

  return {
    level: "high",
    pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2),
    particleCap: mobile ? 280 : 420,
    rainCount: mobile ? 76 : 128,
    bloom: true,
    dynamicShadows: !mobile,
    targetFps: 60,
    rimFresnel: true,
    smoke: true,
  };
}
