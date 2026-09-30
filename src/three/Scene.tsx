import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, useGLTF } from '@react-three/drei';
import { Suspense, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

// Built by scripts/blender/severance_desk.py. The CRT display is the mesh named "Screen".
const DESK_MODEL = '/models/severance-desk.glb';

const BACKGROUND = '#dde4df';
const CARPET = '#5d8762';

// Camera shots. The CRT screen's center is at roughly (0.83, 1.03, 0.5).
const OVERVIEW = { position: new THREE.Vector3(3.1, 2.4, 3.9), target: new THREE.Vector3(0.55, 0.62, 0.3) };
const SEATED = { position: new THREE.Vector3(0.83, 1.22, 1.35), target: new THREE.Vector3(0.83, 0.93, 0.5) };
const SIT_DURATION = 2.2; // seconds

function Scene() {
    const [seated, setSeated] = useState(false);

    // Any click sits you down. Once seated, clicking the computer keeps you there
    // (it's where screen interaction goes); clicking anything else stands you back up.
    const handleClick = (hitComputer: boolean) => setSeated(!seated || hitComputer);

    return (
        <Canvas
            camera={{ position: OVERVIEW.position.toArray(), fov: 38 }}
            dpr={[1, 2]}
            onPointerMissed={() => handleClick(false)}
            style={{ cursor: seated ? 'default' : 'pointer' }}
        >
            <CameraRig seated={seated} />
            <color attach="background" args={[BACKGROUND]} />
            <fog attach="fog" args={[BACKGROUND, 7, 16]} />

            <hemisphereLight args={['#f4f7f5', CARPET, 0.6]} />
            <directionalLight position={[1.5, 6, 3]} intensity={1.2} />

            <Suspense fallback={null}>
                <SeveranceDesk onClick={handleClick} />
            </Suspense>

            <Floor onClick={handleClick} />
            <ContactShadows position={[0, 0.002, 0]} scale={9} resolution={1024} blur={2.4} far={1.6} opacity={0.55} />
            <OfficeLighting />
        </Canvas>
    );
}

// The camera is fixed on the overview shot; once seated it eases into the chair's point of view.
function CameraRig({ seated }: { seated: boolean }) {
    const progress = useRef(0);
    const lookAt = useMemo(() => new THREE.Vector3(), []);

    useFrame(({ camera }, delta) => {
        const step = delta / SIT_DURATION;
        progress.current = THREE.MathUtils.clamp(progress.current + (seated ? step : -step), 0, 1);
        const t = easeInOutCubic(progress.current);

        camera.position.lerpVectors(OVERVIEW.position, SEATED.position, t);
        lookAt.lerpVectors(OVERVIEW.target, SEATED.target, t);
        camera.lookAt(lookAt);
    });

    return null;
}

function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

type SceneClickHandler = (hitComputer: boolean) => void;

function SeveranceDesk({ onClick }: { onClick: SceneClickHandler }) {
    const { scene } = useGLTF(DESK_MODEL);

    const handleClick = (e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation(); // only the nearest hit counts
        onClick(isInsideComputer(e.object));
    };

    return <primitive object={scene} onClick={handleClick} />;
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
