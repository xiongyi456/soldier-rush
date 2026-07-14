export type QualityLevel = "high" | "low";

export interface QualityProfile {
  level: QualityLevel;
  pixelRatio: number;
  particleCap: number;
  rainCount: number;
  bloom: boolean;
  dynamicShadows: boolean;
  targetFps: 30 | 60;
}

export function detectQuality(mobile: boolean, lowPower: boolean): QualityProfile {
  if (lowPower) {
    return { level: "low", pixelRatio: 1, particleCap: 170, rainCount: 42, bloom: false, dynamicShadows: false, targetFps: 30 };
  }
  return {
    level: "high",
    pixelRatio: Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2),
    particleCap: mobile ? 280 : 420,
    rainCount: mobile ? 76 : 128,
    bloom: true,
    dynamicShadows: !mobile,
    targetFps: 60,
  };
}
