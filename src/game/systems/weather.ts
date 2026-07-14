import * as THREE from "three";

export type WeatherId = "overcast" | "rain" | "mist" | "dusk";

interface WeatherPreset {
  id: WeatherId;
  sky: THREE.Color;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  exposure: number;
  hemi: number;
  sun: number;
  fill: number;
  rain: number;
}

const PRESETS: readonly WeatherPreset[] = [
  { id: "overcast", sky: new THREE.Color(0x718ca2), fog: new THREE.Color(0x91a8b5), fogNear: 46, fogFar: 116, exposure: .78, hemi: .82, sun: .7, fill: .34, rain: 0 },
  { id: "rain", sky: new THREE.Color(0x42566b), fog: new THREE.Color(0x667987), fogNear: 38, fogFar: 94, exposure: .7, hemi: .68, sun: .42, fill: .28, rain: 1 },
  { id: "mist", sky: new THREE.Color(0x84949b), fog: new THREE.Color(0xaeb9b9), fogNear: 24, fogFar: 72, exposure: .74, hemi: .76, sun: .52, fill: .32, rain: .08 },
  { id: "dusk", sky: new THREE.Color(0x564f70), fog: new THREE.Color(0x806f78), fogNear: 42, fogFar: 106, exposure: .72, hemi: .7, sun: .62, fill: .42, rain: 0 },
] as const;

export class WeatherController {
  private current = PRESETS[0];
  private target = PRESETS[0];
  private mix = 1;
  private nextDistance = 320;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly hemi: THREE.HemisphereLight,
    private readonly sun: THREE.DirectionalLight,
    private readonly fill: THREE.DirectionalLight,
  ) {
    scene.background = this.current.sky.clone();
    scene.fog = new THREE.Fog(this.current.fog.clone(), this.current.fogNear, this.current.fogFar);
    this.apply(this.current);
  }

  get id(): WeatherId { return this.target.id; }
  get rainStrength(): number { return THREE.MathUtils.lerp(this.current.rain, this.target.rain, this.mix); }

  reset(): void {
    this.current = PRESETS[0];
    this.target = PRESETS[0];
    this.mix = 1;
    this.nextDistance = 320;
    this.apply(this.current);
  }

  update(distance: number): void {
    if (distance >= this.nextDistance) {
      const choices = PRESETS.filter(item => item.id !== this.target.id);
      this.current = this.sample();
      this.target = choices[Math.floor(Math.random() * choices.length)];
      this.mix = 0;
      this.nextDistance = distance + 300 + Math.random() * 150;
    }
    if (this.mix < 1) this.mix = Math.min(1, this.mix + 1 / 240);
    this.apply(this.sample());
  }

  private sample(): WeatherPreset {
    const t = this.mix;
    return {
      id: this.target.id,
      sky: this.current.sky.clone().lerp(this.target.sky, t),
      fog: this.current.fog.clone().lerp(this.target.fog, t),
      fogNear: THREE.MathUtils.lerp(this.current.fogNear, this.target.fogNear, t),
      fogFar: THREE.MathUtils.lerp(this.current.fogFar, this.target.fogFar, t),
      exposure: THREE.MathUtils.lerp(this.current.exposure, this.target.exposure, t),
      hemi: THREE.MathUtils.lerp(this.current.hemi, this.target.hemi, t),
      sun: THREE.MathUtils.lerp(this.current.sun, this.target.sun, t),
      fill: THREE.MathUtils.lerp(this.current.fill, this.target.fill, t),
      rain: THREE.MathUtils.lerp(this.current.rain, this.target.rain, t),
    };
  }

  private apply(value: WeatherPreset): void {
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(value.sky);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(value.fog);
      this.scene.fog.near = value.fogNear;
      this.scene.fog.far = value.fogFar;
    }
    this.renderer.toneMappingExposure = value.exposure;
    this.hemi.intensity = value.hemi;
    this.sun.intensity = value.sun;
    this.fill.intensity = value.fill;
  }
}
