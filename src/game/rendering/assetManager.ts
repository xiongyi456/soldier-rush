import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

export interface AnimatedAsset {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
}

export class AssetManager {
  private readonly gltf: GLTFLoader;
  private readonly cache = new Map<string, Promise<GLTF>>();

  constructor(renderer: THREE.WebGLRenderer) {
    const ktx2 = new KTX2Loader().setTranscoderPath("./basis/").detectSupport(renderer);
    this.gltf = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  }

  loadGLTF(url: string): Promise<GLTF> {
    let request = this.cache.get(url);
    if (!request) {
      request = this.gltf.loadAsync(url);
      this.cache.set(url, request);
    }
    return request;
  }

  async instantiateAnimated(url: string): Promise<AnimatedAsset> {
    const source = await this.loadGLTF(url);
    const root = cloneSkeleton(source.scene) as THREE.Group;
    const mixer = new THREE.AnimationMixer(root);
    const clips = new Map(source.animations.map(clip => [clip.name.toLowerCase(), clip]));
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    return { root, mixer, clips };
  }
}
