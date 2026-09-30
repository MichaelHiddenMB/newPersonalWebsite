import { Canvas, createPortal, useFrame, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, useGLTF } from '@react-three/drei';
import { Suspense, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import ScreenDisplay from './ScreenDisplay';
import { PAGE_OFFSET } from './screen';

// Built by scripts/blender/severance_desk.py. The CRT display is the mesh named "Screen".
const DESK_MODEL = '/models/severance-desk.glb';

const BACKGROUND = '#dde4df';
const CARPET = '#5d8762';

/** overview: looking at the pod. desk: sitting in the chair. site: zoomed into the screen. */
export type View = 'overview' | 'desk' | 'site';

// Camera stops. The third one (the screen filling the window) is computed from the Screen mesh.
const STAGE: Record<View, number> = { overview: 0, desk: 1, site: 2 };
const OVERVIEW = { position: new THREE.Vector3(3.1, 2.4, 3.9), target: new THREE.Vector3(0.55, 0.62, 0.3) };
const SEATED = { position: new THREE.Vector3(0.83, 1.22, 1.35), target: new THREE.Vector3(0.83, 0.93, 0.5) };
const SIT_DURATION = 2.2; // seconds, overview <-> chair
const ZOOM_DURATION = 1.4; // seconds, chair <-> screen

type SceneProps = {
    view: View;
    onViewChange: (view: View) => void;
    /** Stop rendering (the full-screen site is covering the canvas). */
    paused: boolean;
    /** The camera has zoomed in until the screen fills the window. */
    onScreenFilled: () => void;
};

function Scene({ view, onViewChange, paused, onScreenFilled }: SceneProps) {
    const [screenPowered, setScreenPowered] = useState(false);
    const [booted, setBooted] = useState(false);
    if (!screenPowered && booted) setBooted(false);

    // Overview: any click sits you down. At the desk: clicking the computer zooms into the
    // screen (once it has booted); clicking anything else stands you back up.
    const handleClick = (hitComputer: boolean) => {
        if (view === 'overview') onViewChange('desk');
        else if (!hitComputer) onViewChange('overview');
        else if (booted) onViewChange('site');
    };

    // As soon as the screen finishes booting, zoom in to the page.
    const handleBooted = () => {
        setBooted(true);
        onViewChange('site');
    };

    return (
        <Canvas
            camera={{ position: OVERVIEW.position.toArray(), fov: 38 }}
            dpr={[1, 2]}
            frameloop={paused ? 'never' : 'always'}
            onPointerMissed={() => handleClick(false)}
            style={{ cursor: view === 'overview' ? 'pointer' : 'default' }}
        >
            <color attach="background" args={[BACKGROUND]} />
            <fog attach="fog" args={[BACKGROUND, 7, 16]} />

            <hemisphereLight args={['#f4f7f5', CARPET, 0.6]} />
            <directionalLight position={[1.5, 6, 3]} intensity={1.2} />

            <Suspense fallback={null}>
                <SeveranceDesk onClick={handleClick} screenOn={screenPowered} zooming={view === 'site'} onBooted={handleBooted} />
                <CameraRig view={view} onPoweredChange={setScreenPowered} onScreenFilled={onScreenFilled} />
            </Suspense>

            <Floor onClick={handleClick} />
            <ContactShadows position={[0, 0.002, 0]} scale={9} resolution={1024} blur={2.4} far={1.6} opacity={0.55} />
            <OfficeLighting />
        </Canvas>
    );
}

type CameraRigProps = {
    view: View;
    /** True while the camera is at the chair or closer (the screen should be on). */
    onPoweredChange: (powered: boolean) => void;
    onScreenFilled: () => void;
};

// Moves the camera along overview -> chair -> screen. `progress` runs 0..2 across those stops
// and eases toward the stop for the current view, so any view change reverses smoothly.
function CameraRig({ view, onPoweredChange, onScreenFilled }: CameraRigProps) {
    const screen = useDeskScreen();
    const progress = useRef(0);
    const powered = useRef(false);
    const filled = useRef(false);
    const lookAt = useMemo(() => new THREE.Vector3(), []);
    const screenShot = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3() }), []);

    useFrame(({ camera, size }, delta) => {
        const goal = STAGE[view];
        const p = progress.current;
        const zooming = goal > p ? p >= 1 : p > 1;
        // Clamp delta so resuming after a pause (or a background tab) doesn't jump.
        const step = Math.min(delta, 0.1) / (zooming ? ZOOM_DURATION : SIT_DURATION);
        progress.current = goal > p ? Math.min(goal, p + step) : Math.max(goal, p - step);
        const q = progress.current;

        if (q <= 1) {
            const t = easeInOutCubic(q);
            camera.position.lerpVectors(OVERVIEW.position, SEATED.position, t);
            lookAt.lerpVectors(OVERVIEW.target, SEATED.target, t);
        } else {
            if (screen) fillWithScreen(screen, camera as THREE.PerspectiveCamera, size.width / size.height, screenShot);
            const t = easeInOutCubic(q - 1);
            camera.position.lerpVectors(SEATED.position, screenShot.position, t);
            lookAt.lerpVectors(SEATED.target, screenShot.target, t);
        }
        camera.lookAt(lookAt);

        if ((q >= 1) !== powered.current) {
            powered.current = q >= 1;
            onPoweredChange(powered.current);
        }
        if ((q === 2) !== filled.current) {
            filled.current = q === 2;
            if (filled.current) onScreenFilled();
        }
    });

    return null;
}

// Camera placement straight in front of the page on the screen, close enough that the glass covers the
// window. Matches the page's "contain" fit (see screen.ts), so the page ends up at exactly 1:1.
function fillWithScreen(
    screen: THREE.Mesh,
    camera: THREE.PerspectiveCamera,
    aspect: number,
    out: { position: THREE.Vector3; target: THREE.Vector3 },
) {
    const geometry = screen.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitHeight = size.y / 2 / tanHalfFov;
    const fitWidth = size.x / 2 / (tanHalfFov * aspect);
    const distance = Math.min(fitHeight, fitWidth);

    const normal = new THREE.Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
    screen.getWorldPosition(out.target).addScaledVector(normal, PAGE_OFFSET);
    out.position.copy(out.target).addScaledVector(normal, distance);
}

function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function useDeskScreen() {
    const { scene } = useGLTF(DESK_MODEL);
    return useMemo(() => scene.getObjectByName('Screen') as THREE.Mesh | undefined, [scene]);
}

type SceneClickHandler = (hitComputer: boolean) => void;

type SeveranceDeskProps = { onClick: SceneClickHandler; screenOn: boolean; zooming: boolean; onBooted: () => void };

function SeveranceDesk({ onClick, screenOn, zooming, onBooted }: SeveranceDeskProps) {
    const { scene } = useGLTF(DESK_MODEL);
    const screen = useDeskScreen();

    const handleClick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation(); // only the nearest hit counts
        onClick(isInsideComputer(e.object));
    };

    return (
        <>
            <primitive object={scene} onClick={handleClick} />
            {/* Mount the page onto the CRT glass so it follows the model's Screen mesh. */}
            {screen && createPortal(<ScreenDisplay powered={screenOn} zooming={zooming} onBooted={onBooted} />, screen)}
        </>
    );
}

// The CRT, keyboard and keycard all live under the "Computer" node in the model.
function isInsideComputer(object: THREE.Object3D) {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) {
        if (o.name === 'Computer') return true;
    }
    return false;
}

useGLTF.preload(DESK_MODEL);

function Floor({ onClick }: { onClick: SceneClickHandler }) {
    return (
        <mesh
            rotation-x={-Math.PI / 2}
            onClick={(e) => {
                e.stopPropagation();
                onClick(false);
            }}
        >
            <circleGeometry args={[30, 64]} />
            <meshStandardMaterial color={CARPET} roughness={1} />
        </mesh>
    );
}

// Soft reflections/fill from a grid of ceiling light panels, like the MDR office ceiling.
function OfficeLighting() {
    return (
        <Environment resolution={256}>
            <color attach="background" args={['#9aa39d']} />
            {[-4, 0, 4].map((x) =>
                [-4, 0, 4].map((z) => (
                    <Lightformer key={`${x},${z}`} form="rect" intensity={2.2} position={[x, 5, z]} rotation-x={Math.PI / 2} scale={[2.4, 2.4, 1]} />
                )),
            )}
        </Environment>
    );
}

export default Scene;
