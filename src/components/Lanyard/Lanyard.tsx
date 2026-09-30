/*
 * The MDR keycard hanging over the full-screen site, as if it's still slung over the monitor.
 * React Bits' <Lanyard /> (https://reactbits.dev/components/lanyard, MIT + Commons Clause) with:
 * our Lumon card faces and strap, a transparent overlay that lets the page underneath stay
 * clickable/scrollable, the anchor at the top-right edge, and a hanging (not falling) start.
 */
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, extend, useFrame, useThree, type ThreeElement, type ThreeEvent } from '@react-three/fiber';
import { useGLTF, useTexture, Environment, Lightformer } from '@react-three/drei';
import {
    BallCollider,
    CuboidCollider,
    Physics,
    RigidBody,
    useRopeJoint,
    useSphericalJoint,
    type RapierRigidBody,
    type RigidBodyProps,
} from '@react-three/rapier';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';
import * as THREE from 'three';

import cardGLB from './card.glb?url';
import cardFront from './card-front.png';
import cardBack from './card-back.png';
import strap from './strap.png';

extend({ MeshLineGeometry, MeshLineMaterial });

declare module '@react-three/fiber' {
    interface ThreeElements {
        meshLineGeometry: ThreeElement<typeof MeshLineGeometry>;
        meshLineMaterial: ThreeElement<typeof MeshLineMaterial>;
    }
}

// The card model's front face is UV-mapped to the LEFT half of its texture atlas and the back face
// to the RIGHT half; our card images are composited into those halves.
const FRONT_UV_RECT = { x: 0, y: 0, w: 0.5, h: 0.755 };
const BACK_UV_RECT = { x: 0.5, y: 0, w: 0.5, h: 0.757 };

// Where the strap enters from the top edge, as a fraction of the half-width from center
// (just left of the header's "Leave desk").
const ANCHOR_X = 0.7;

type LanyardProps = {
    /** Element that receives pointer events (the page), so the canvas can let clicks through. */
    eventSource: RefObject<HTMLElement | null>;
    gravity?: [number, number, number];
    lanyardWidth?: number;
};

useGLTF.preload(cardGLB);
useTexture.preload([cardFront, cardBack, strap]);

export default function Lanyard({ eventSource, gravity = [0, -40, 0], lanyardWidth = 1 }: LanyardProps) {
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <div className="pointer-events-none fixed inset-0 z-10">
            <Canvas
                camera={{ position: [0, 0, 30], fov: 20 }}
                dpr={[1, isMobile ? 1.5 : 2]}
                gl={{ alpha: true }}
                eventSource={eventSource as RefObject<HTMLElement>}
                eventPrefix="client"
                onCreated={({ gl }) => gl.setClearColor(new THREE.Color(0x000000), 0)}
            >
                <ambientLight intensity={Math.PI} />
                {/* Loading (physics engine, card model) must suspend in here, not in the page: a page-level
                    Suspense hides the canvas, and react-three-fiber's teardown then kills its WebGL context. */}
                <Suspense fallback={null}>
                    <Physics gravity={gravity} timeStep={isMobile ? 1 / 30 : 1 / 60}>
                        <HangingBand isMobile={isMobile} lanyardWidth={lanyardWidth} />
                    </Physics>
                    <Environment blur={0.75}>
                        <Lightformer intensity={2} color="white" position={[0, -1, 5]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
                        <Lightformer intensity={3} color="white" position={[-1, -1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
                        <Lightformer intensity={3} color="white" position={[1, 1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
                        <Lightformer intensity={10} color="white" position={[-10, 0, 14]} rotation={[0, Math.PI / 2, Math.PI / 3]} scale={[100, 10, 1]} />
                    </Environment>
                </Suspense>
            </Canvas>
        </div>
    );
}

// Re-hangs the band from the top-right edge whenever the viewport size changes.
function HangingBand(props: BandProps) {
    const { viewport } = useThree();
    const anchor: [number, number, number] = [(viewport.width / 2) * ANCHOR_X, viewport.height / 2 + 0.4, 0];
    return <Band key={`${viewport.width.toFixed(1)}x${viewport.height.toFixed(1)}`} anchor={anchor} {...props} />;
}

type BandProps = {
    maxSpeed?: number;
    minSpeed?: number;
    isMobile?: boolean;
    lanyardWidth?: number;
};

type LanyardRigidBody = RapierRigidBody & { lerped?: THREE.Vector3 };

const segmentProps: RigidBodyProps = {
    type: 'dynamic',
    canSleep: true,
    colliders: false,
    angularDamping: 4,
    linearDamping: 4,
};

function Band({
    anchor,
    maxSpeed = 50,
    minSpeed = 0,
    isMobile = false,
    lanyardWidth = 1,
}: BandProps & { anchor: [number, number, number] }) {
    const band = useRef<THREE.Mesh<MeshLineGeometry, MeshLineMaterial>>(null!);
    const fixed = useRef<RapierRigidBody>(null!);
    const j1 = useRef<LanyardRigidBody>(null!);
    const j2 = useRef<LanyardRigidBody>(null!);
    const j3 = useRef<RapierRigidBody>(null!);
    const card = useRef<RapierRigidBody>(null!);

    const scratch = useMemo(
        () => ({ vec: new THREE.Vector3(), ang: new THREE.Vector3(), rot: new THREE.Vector3(), dir: new THREE.Vector3() }),
        [],
    );

    const getLerped = (body: LanyardRigidBody) => (body.lerped ??= new THREE.Vector3().copy(body.translation()));

    const { nodes, materials } = useGLTF(cardGLB) as unknown as {
        nodes: Record<'card' | 'clip' | 'clamp', THREE.Mesh>;
        materials: Record<'base' | 'metal', THREE.MeshStandardMaterial>;
    };
    const texture = useTexture(strap, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
    });
    const frontTex = useTexture(cardFront);
    const backTex = useTexture(cardBack);

    // Composite our front/back images into the card's texture atlas (front = left half, back = right half).
    const cardMap = useMemo(() => {
        const baseMap = materials.base.map as THREE.Texture;
        const baseImg = baseMap.image as HTMLImageElement;
        const W = baseImg.width;
        const H = baseImg.height;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return baseMap;
        ctx.drawImage(baseImg, 0, 0, W, H);

        const drawFitted = (img: CanvasImageSource & { width: number; height: number }, rect: typeof FRONT_UV_RECT) => {
            const rx = rect.x * W;
            const ry = rect.y * H;
            const rw = rect.w * W;
            const rh = rect.h * H;
            const scale = Math.max(rw / img.width, rh / img.height);
            const dw = img.width * scale;
            const dh = img.height * scale;
            ctx.save();
            ctx.beginPath();
            ctx.rect(rx, ry, rw, rh);
            ctx.clip();
            ctx.drawImage(img, rx + (rw - dw) / 2, ry + (rh - dh) / 2, dw, dh);
            ctx.restore();
        };
        drawFitted(frontTex.image as HTMLImageElement, FRONT_UV_RECT);
        drawFitted(backTex.image as HTMLImageElement, BACK_UV_RECT);

        const composite = new THREE.CanvasTexture(canvas);
        composite.colorSpace = THREE.SRGBColorSpace;
        composite.flipY = baseMap.flipY;
        composite.anisotropy = 16;
        return composite;
    }, [frontTex, backTex, materials.base.map]);

    const [curve] = useState(() => {
        const c = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
        c.curveType = 'chordal';
        return c;
    });
    const [dragged, drag] = useState<false | THREE.Vector3>(false);
    const [hovered, hover] = useState(false);

    useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
    useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
    useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);
    useSphericalJoint(j3, card, [
        [0, 0, 0],
        [0, 1.45, 0],
    ]);

    useEffect(() => {
        if (hovered) {
            document.body.style.cursor = dragged ? 'grabbing' : 'grab';
            return () => {
                document.body.style.cursor = 'auto';
            };
        }
    }, [hovered, dragged]);

    useFrame((state, delta) => {
        const { vec, ang, rot, dir } = scratch;
        if (dragged) {
            vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
            dir.copy(vec).sub(state.camera.position).normalize();
            vec.add(dir.multiplyScalar(state.camera.position.length()));
            [card, j1, j2, j3, fixed].forEach((ref) => ref.current?.wakeUp());
            card.current?.setNextKinematicTranslation({ x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z });
        }
        if (fixed.current && j1.current && j2.current && j3.current && card.current) {
            [j1, j2].forEach((ref) => {
                const lerped = getLerped(ref.current);
                const clampedDistance = Math.max(0.1, Math.min(1, lerped.distanceTo(ref.current.translation())));
                // Capped at 1: on slow frames the original factor overshoots and the strap blows up to NaN.
                lerped.lerp(ref.current.translation(), Math.min(1, delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed))));
            });
            curve.points[0].copy(j3.current.translation());
            curve.points[1].copy(getLerped(j2.current));
            curve.points[2].copy(getLerped(j1.current));
            curve.points[3].copy(fixed.current.translation());
            band.current.geometry.setPoints(curve.getPoints(isMobile ? 16 : 32));
            ang.copy(card.current.angvel());
            rot.copy(card.current.rotation());
            card.current.setAngvel({ x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z }, true);
        }
    });

    // React Bits' fixed "resolution" (not the real canvas size): meshline's width math depends on it,
    // and these values give its strap proportions.
    const lineParams = useMemo(() => ({ resolution: new THREE.Vector2(1000, isMobile ? 2000 : 1000) }), [isMobile]);

    // Start stretched out to the right, like React Bits, so the card swings in from the right edge,
    // where the 3D keycard slid out of view during the zoom.
    // Bodies get absolute positions: rapier writes world transforms back, so a positioned parent
    // group would offset them twice.
    const at = (dx: number, dy: number): [number, number, number] => [anchor[0] + dx, anchor[1] + dy, anchor[2]];

    return (
        <>
            <RigidBody position={at(0, 0)} ref={fixed} {...segmentProps} type="fixed" />
            <RigidBody position={at(0.5, 0)} ref={j1} {...segmentProps} type="dynamic">
                <BallCollider args={[0.1]} />
            </RigidBody>
            <RigidBody position={at(1, 0)} ref={j2} {...segmentProps} type="dynamic">
                <BallCollider args={[0.1]} />
            </RigidBody>
            <RigidBody position={at(1.5, 0)} ref={j3} {...segmentProps} type="dynamic">
                <BallCollider args={[0.1]} />
            </RigidBody>
            <RigidBody position={at(2, 0)} ref={card} {...segmentProps} type={dragged ? 'kinematicPosition' : 'dynamic'}>
                    <CuboidCollider args={[0.8, 1.125, 0.01]} />
                    <group
                        scale={2.25}
                        position={[0, -1.2, -0.05]}
                        onPointerOver={() => hover(true)}
                        onPointerOut={() => hover(false)}
                        onPointerUp={(e: ThreeEvent<PointerEvent>) => {
                            (e.target as Element).releasePointerCapture(e.pointerId);
                            drag(false);
                        }}
                        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                            if (!card.current) return;
                            e.nativeEvent.preventDefault(); // don't start a text selection on the page underneath
                            (e.target as Element).setPointerCapture(e.pointerId);
                            drag(new THREE.Vector3().copy(e.point).sub(scratch.vec.copy(card.current.translation())));
                        }}
                    >
                        <mesh geometry={nodes.card.geometry}>
                            <meshPhysicalMaterial
                                map={cardMap}
                                map-anisotropy={16}
                                clearcoat={isMobile ? 0 : 1}
                                clearcoatRoughness={0.15}
                                roughness={0.9}
                                metalness={0.8}
                            />
                        </mesh>
                        <mesh geometry={nodes.clip.geometry} material={materials.metal} material-roughness={0.3} />
                        <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
                    </group>
            </RigidBody>
            {/* Its bounds aren't updated as the points move, so never frustum-cull it. */}
            <mesh ref={band} frustumCulled={false}>
                <meshLineGeometry />
                <meshLineMaterial
                    args={[lineParams]}
                    color="white"
                    depthTest={false}
                    useMap={1}
                    map={texture}
                    repeat={new THREE.Vector2(-4, 1)}
                    lineWidth={lanyardWidth}
                />
            </mesh>
        </>
    );
}
