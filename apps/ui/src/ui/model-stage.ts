import {
  Box3,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
  ACESFilmicToneMapping,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** How a mesh looks: a colour token without its `--color-` prefix, and how rough and metallic its surface is. */
export interface ModelFinish {
  readonly token: string;
  readonly roughness: number;
  readonly metalness: number;
}

/** One mesh of a piece; `phase` makes it glow in that motor phase's turn and colour while powered. */
export interface ModelMesh {
  readonly geometry: BufferGeometry;
  readonly finish: ModelFinish;
  readonly phase?: { readonly index: number; readonly token: string };
}

/** A piece a viewer can pick. `offset` is how far it travels upward when taken apart, and `spins` is the rotor's. */
export interface ModelPiece<Id extends string> {
  readonly id: Id;
  readonly offset: number;
  readonly spins: boolean;
  readonly meshes: readonly ModelMesh[];
}

/**
 * A model made of pieces, seen from `elevation` radians above its side; `polePairs` sets how fast its `phases` cycle
 * against the rotor.
 */
export interface Model<Id extends string> {
  readonly pieces: readonly ModelPiece<Id>[];
  readonly elevation: number;
  readonly phases: number;
  readonly polePairs: number;
}

/** A rectangle in the canvas's own pixels. */
export interface ScreenBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** What drives a stage and what it reports. */
export interface ModelStageOptions<Id extends string> {
  readonly host: HTMLElement;
  readonly label: string;
  readonly model: Model<Id>;
  readonly onHover: (id: Id | null) => void;
  readonly onPick: (id: Id | null) => void;
  readonly onFrame: (boxOf: (id: Id) => ScreenBox) => void;
}

/** A running 3D view of a model. */
export interface ModelStage<Id extends string> {
  readonly setExplode: (amount: number) => void;
  readonly setSelected: (id: Id | null) => void;
  readonly setPowered: (powered: boolean) => void;
  readonly pieceAt: (clientX: number, clientY: number) => Id | null;
  readonly boxOf: (id: Id) => ScreenBox;
  readonly dispose: () => void;
}

const VIEW = {
  fov: 32,
  near: 1,
  far: 900,
  azimuth: 0.72,
  heightMargin: 1.05,
  widthMargin: 0.92,
  compactHeight: 1.1,
  nearSide: 0.5,
  minDistanceRatio: 0.3,
  maxDistanceRatio: 3,
  damping: 0.08,
  maxPixelRatio: 2,
  exposure: 1.05,
} as const;

const LIGHT = {
  environment: 0.85,
  environmentBlur: 0.04,
  key: 2.2,
  keyX: 0.6,
  keyY: 1.4,
  keyZ: 0.9,
  rim: 1.2,
  rimX: -0.9,
  rimY: 0.3,
  rimZ: -0.8,
  shadowSize: 1024,
  shadowBias: -0.0004,
  shadowNormalBias: 0.05,
  shadowReach: 1.6,
  shadowOpacity: 0.28,
} as const;

const FLOOR = {
  rings: 4,
  first: 0.6,
  step: 0.4,
  segments: 128,
  gap: 0.25,
  lineOpacity: 0.35,
  catcherRatio: 2.4,
} as const;

const MOTION = {
  explodeRate: 5,
  spinRate: 1.6,
  turnsPerSecond: 1.1,
  settled: 0.0005,
  maxStep: 0.1,
  millisecondsPerSecond: 1000,
} as const;

const LOOK = { ghostOpacity: 0.1, tint: 0.22, phaseGlow: 0.9 } as const;
const CLICK_SLOP_PIXELS = 5;
const WHOLE_TURN = Math.PI + Math.PI;
const HALF = 0.5;
const TWO = 2;
const THREE = 3;
const SIGNAL = "signal";
const FLOOR_TOKEN = "line-strong";
const DATA_THEME = "data-theme";

/**
 * Reads a colour token as the document resolves it now.
 *
 * @param token - The token's name without its `--color-` prefix.
 * @returns The colour.
 */
export const tokenColour = (token: string): Color =>
  new Color(getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim());

/**
 * How one piece looks given what is selected and hovered: every other piece ghosts around a selection, and a hovered
 * piece is tinted unless it is already the selected one.
 *
 * @param id - The piece.
 * @param selected - The selected piece, if any.
 * @param hovered - The hovered piece, if any.
 * @returns Whether it ghosts and whether it is tinted.
 */
export const lookOf = (id: string, selected: string | null, hovered: string | null) => ({
  ghost: selected !== null && selected !== id,
  tinted: hovered === id && selected !== id,
});

/**
 * How strongly a phase's coils glow at a point in the electrical cycle.
 *
 * @param angle - The electrical angle in radians.
 * @param phase - The phase's index.
 * @param phases - How many phases there are.
 * @returns From 0 (off) to 1 (fully driven).
 */
export const phaseLevel = (angle: number, phase: number, phases: number): number =>
  Math.max(0, Math.sin(angle - (phase * WHOLE_TURN) / phases));

const smoothStep = (amount: number): number => amount * amount * (THREE - TWO * amount);

const approach = (current: number, target: number, rate: number, step: number): number => {
  const next = current + (target - current) * Math.min(1, step * rate);
  return Math.abs(target - next) < MOTION.settled ? target : next;
};

/**
 * Starts a 3D view of a model in `host`, which it fills: drag to turn, scroll to zoom. It draws only when something
 * changed, and redraws in the new colours when the theme changes.
 *
 * @param options - The host, the canvas's accessible label, the model and the callbacks.
 * @returns The running stage, or null when the browser has no WebGL.
 */
export const createModelStage = <Id extends string>(options: ModelStageOptions<Id>): ModelStage<Id> | null => {
  const { host, label, model, onHover, onPick, onFrame } = options;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: true, alpha: true });
  if (context === null) {
    return null;
  }
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  canvas.className = "block size-full cursor-grab touch-none active:cursor-grabbing";
  host.append(canvas);

  const renderer = new WebGLRenderer({ canvas, context, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, VIEW.maxPixelRatio));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = VIEW.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), LIGHT.environmentBlur);
  scene.environment = environment.texture;
  scene.environmentIntensity = LIGHT.environment;

  const painted: { readonly material: MeshStandardMaterial; readonly token: string }[] = [];
  const lit: { readonly material: MeshStandardMaterial; readonly index: number; readonly token: string }[] = [];
  const parts = model.pieces.map((piece) => {
    const group = new Group();
    const materials = piece.meshes.map(({ geometry, finish, phase }) => {
      const material = new MeshStandardMaterial({ roughness: finish.roughness, metalness: finish.metalness });
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      painted.push({ material, token: finish.token });
      if (phase !== undefined) {
        lit.push({ material, ...phase });
      }
      return material;
    });
    scene.add(group);
    return { piece, group, materials, bounds: new Box3().setFromObject(group) };
  });

  const ground = model.pieces.flatMap(({ meshes }) => meshes.flatMap(({ geometry }) => {
    const position = geometry.getAttribute("position");
    return Array.from({ length: position.count }, (_vertex, index) =>
      ({ x: position.getX(index), z: position.getZ(index) }));
  }));
  const radius = ground.reduce((widest, { x, z }) => Math.max(widest, Math.hypot(x, z)), 0);
  const along = ground.map(({ x, z }) => x * Math.sin(VIEW.azimuth) + z * Math.cos(VIEW.azimuth));
  const depth = along.reduce((far, at) => Math.max(far, at), -Infinity)
    - along.reduce((near, at) => Math.min(near, at), Infinity);
  const lowAt = (amount: number): number =>
    Math.min(...parts.map(({ piece, bounds }) => bounds.min.y + piece.offset * amount));
  const highAt = (amount: number): number =>
    Math.max(...parts.map(({ piece, bounds }) => bounds.max.y + piece.offset * amount));

  const key = new DirectionalLight(undefined, LIGHT.key);
  key.position.set(radius * LIGHT.keyX, radius * LIGHT.keyY, radius * LIGHT.keyZ).multiplyScalar(TWO);
  key.castShadow = true;
  key.shadow.mapSize.set(LIGHT.shadowSize, LIGHT.shadowSize);
  const reach = (highAt(1) - lowAt(1)) * LIGHT.shadowReach;
  Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: reach * TWO * TWO });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = LIGHT.shadowBias;
  key.shadow.normalBias = LIGHT.shadowNormalBias;
  const rim = new DirectionalLight(tokenColour(SIGNAL), LIGHT.rim);
  rim.position.set(radius * LIGHT.rimX, radius * LIGHT.rimY, radius * LIGHT.rimZ);
  scene.add(key, rim);

  const floor = new Group();
  const floorLine = new LineBasicMaterial({ transparent: true, opacity: FLOOR.lineOpacity });
  const ringGeometries = Array.from({ length: FLOOR.rings }, (_ring, ring) => {
    const ringRadius = radius * (FLOOR.first + ring * FLOOR.step);
    const points = Array.from({ length: FLOOR.segments + 1 }, (_point, point) => {
      const angle = (point / FLOOR.segments) * WHOLE_TURN;
      return new Vector3(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius);
    });
    const geometry = new BufferGeometry().setFromPoints(points);
    floor.add(new Line(geometry, floorLine));
    return geometry;
  });
  const catcherGeometry = new CircleGeometry(radius * FLOOR.catcherRatio, FLOOR.segments);
  const catcherMaterial = new ShadowMaterial({ opacity: LIGHT.shadowOpacity });
  const catcher = new Mesh(catcherGeometry, catcherMaterial);
  catcher.rotation.x = -Math.PI * HALF;
  catcher.receiveShadow = true;
  floor.add(catcher);
  scene.add(floor);

  const camera = new PerspectiveCamera(VIEW.fov, 1, VIEW.near, VIEW.far);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = VIEW.damping;
  controls.enablePan = false;

  const lens = TWO * Math.tan(MathUtils.degToRad(VIEW.fov) * HALF);
  const distanceAt = (amount: number): number => {
    const seen = (highAt(amount) - lowAt(amount)) * Math.cos(model.elevation)
      + depth * Math.sin(model.elevation);
    const height = Math.max(seen, radius * VIEW.compactHeight);
    const byHeight = (height * VIEW.heightMargin) / lens;
    const byWidth = (radius * TWO * VIEW.widthMargin) / (lens * camera.aspect);
    return Math.max(byHeight, byWidth) + radius * VIEW.nearSide;
  };

  let exploded = 0;
  let explodeTarget = 0;
  let selected: Id | null = null;
  let hovered: Id | null = null;
  let powered = false;
  let spin = 0;
  let rotor = 0;
  let dirty = true;
  let previous = 0;

  const frameCamera = (): void => {
    const eased = smoothStep(exploded);
    const offset = camera.position.clone().sub(controls.target);
    controls.target.y = (lowAt(eased) + highAt(eased)) * HALF;
    offset.setLength(distanceAt(eased));
    camera.position.copy(controls.target).add(offset);
  };

  const placePieces = (): void => {
    const eased = smoothStep(exploded);
    for (const { piece, group } of parts) {
      group.position.y = piece.offset * eased;
      group.rotation.y = piece.spins ? rotor : 0;
    }
    floor.position.y = lowAt(eased) - radius * FLOOR.gap;
  };

  const applyLooks = (): void => {
    const tint = tokenColour(SIGNAL);
    for (const { piece, materials, group } of parts) {
      const { ghost, tinted } = lookOf(piece.id, selected, hovered);
      for (const material of materials) {
        if (material.transparent !== ghost) {
          material.transparent = ghost;
          material.depthWrite = !ghost;
          material.needsUpdate = true;
        }
        material.opacity = ghost ? LOOK.ghostOpacity : 1;
        material.emissive.copy(tinted ? tint : new Color());
        material.emissiveIntensity = tinted ? LOOK.tint : 0;
      }
      group.traverse((object) => {
        object.castShadow = !ghost;
      });
    }
    renderer.shadowMap.needsUpdate = true;
    dirty = true;
  };

  const applyColours = (): void => {
    for (const { material, token } of painted) {
      material.color.copy(tokenColour(token));
    }
    floorLine.color.copy(tokenColour(FLOOR_TOKEN));
    rim.color.copy(tokenColour(SIGNAL));
    applyLooks();
  };

  const glowPhases = (): void => {
    const angle = rotor * model.polePairs;
    for (const { material, index, token } of lit) {
      material.emissive.copy(tokenColour(token));
      material.emissiveIntensity = spin * phaseLevel(angle, index, model.phases) * LOOK.phaseGlow;
    }
  };

  const resize = (): void => {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCamera();
    dirty = true;
  };

  camera.position.set(
    Math.cos(model.elevation) * Math.sin(VIEW.azimuth),
    Math.sin(model.elevation),
    Math.cos(model.elevation) * Math.cos(VIEW.azimuth),
  );
  applyColours();
  placePieces();
  resize();
  controls.minDistance = distanceAt(0) * VIEW.minDistanceRatio;
  controls.maxDistance = distanceAt(1) * VIEW.maxDistanceRatio;
  controls.update();
  controls.addEventListener("change", () => {
    dirty = true;
  });

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const groups = parts.map(({ group }) => group);
  const pieceAt = (clientX: number, clientY: number): Id | null => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * TWO - 1,
      1 - ((clientY - rect.top) / rect.height) * TWO,
    );
    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObjects(groups, true);
    return parts.find(({ group }) => group === hit?.object.parent)?.piece.id ?? null;
  };

  const setHovered = (id: Id | null): void => {
    if (hovered !== id) {
      hovered = id;
      onHover(id);
      applyLooks();
    }
  };

  const listening = new AbortController();
  const { signal } = listening;
  let pressedAt: { readonly x: number; readonly y: number } | null = null;
  canvas.addEventListener("pointerdown", ({ clientX, clientY }) => {
    pressedAt = { x: clientX, y: clientY };
  }, { signal });
  canvas.addEventListener("pointermove", ({ clientX, clientY, buttons }) => {
    if (buttons === 0) {
      setHovered(pieceAt(clientX, clientY));
    }
  }, { signal });
  canvas.addEventListener("pointerleave", () => {
    setHovered(null);
  }, { signal });
  canvas.addEventListener("pointerup", ({ clientX, clientY }) => {
    if (pressedAt !== null && Math.hypot(clientX - pressedAt.x, clientY - pressedAt.y) < CLICK_SLOP_PIXELS) {
      onPick(pieceAt(clientX, clientY));
    }
    pressedAt = null;
  }, { signal });

  const sizes = new ResizeObserver(resize);
  sizes.observe(host);
  const themes = new MutationObserver(applyColours);
  themes.observe(document.documentElement, { attributes: true, attributeFilter: [DATA_THEME] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyColours, { signal });

  const corner = new Vector3();
  const box = new Box3();
  const boxOf = (id: Id): ScreenBox => {
    box.makeEmpty();
    for (const { group } of parts.filter(({ piece }) => piece.id === id)) {
      box.expandByObject(group);
    }
    camera.updateMatrixWorld();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).project(camera);
          const screenX = (corner.x + 1) * HALF * host.clientWidth;
          const screenY = (1 - corner.y) * HALF * host.clientHeight;
          left = Math.min(left, screenX);
          right = Math.max(right, screenX);
          top = Math.min(top, screenY);
          bottom = Math.max(bottom, screenY);
        }
      }
    }
    return { left, top, width: right - left, height: bottom - top };
  };

  renderer.setAnimationLoop((time) => {
    const step = Math.min((time - previous) / MOTION.millisecondsPerSecond, MOTION.maxStep);
    previous = time;
    if (exploded !== explodeTarget) {
      exploded = approach(exploded, explodeTarget, MOTION.explodeRate, step);
      placePieces();
      frameCamera();
      renderer.shadowMap.needsUpdate = true;
      dirty = true;
    }
    const spinTarget = powered ? 1 : 0;
    if (spin > 0 || spinTarget > 0) {
      spin = approach(spin, spinTarget, MOTION.spinRate, step);
      rotor += spin * step * MOTION.turnsPerSecond;
      placePieces();
      glowPhases();
      dirty = true;
    }
    controls.update();
    if (dirty) {
      dirty = false;
      renderer.render(scene, camera);
      onFrame(boxOf);
    }
  });

  return {
    setExplode: (amount) => {
      explodeTarget = amount;
    },
    setSelected: (id) => {
      selected = id;
      applyLooks();
    },
    setPowered: (next) => {
      powered = next;
    },
    pieceAt,
    boxOf,
    dispose: () => {
      renderer.setAnimationLoop(null);
      listening.abort();
      sizes.disconnect();
      themes.disconnect();
      controls.dispose();
      for (const { piece, materials } of parts) {
        for (const { geometry } of piece.meshes) {
          geometry.dispose();
        }
        for (const material of materials) {
          material.dispose();
        }
      }
      for (const geometry of ringGeometries) {
        geometry.dispose();
      }
      catcherGeometry.dispose();
      catcherMaterial.dispose();
      floorLine.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
};
