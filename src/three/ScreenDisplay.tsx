import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useEffectEvent, useState } from 'react';
import * as THREE from 'three';
import SitePage from '../components/SitePage';
import { GLASS_HEIGHT, GLASS_WIDTH, metersPerPagePixel, PAGE_OFFSET } from './screen';
import './crt.css';

const BOOT_LINES = [
    'LUMON INDUSTRIES',
    'MACRO DATA REFINEMENT TERMINAL',
    '',
    'MEMORY CHECK ............ 640K OK',
    'SEVERANCE CHIP .......... VERIFIED',
    'LOADING WORKSTATION ...',
];
const POWER_ON_MS = 500;
const LINE_MS = 280;
const BOOT_DONE_MS = POWER_ON_MS + BOOT_LINES.length * LINE_MS + 800;
const SHUTDOWN_MS = 400;

type Props = {
    powered: boolean;
    /** The camera is zooming in to the page: fade the CRT effects so it ends up identical to the real site. */
    zooming: boolean;
    onBooted: () => void;
};

/**
 * The page shown on the CRT. It powers on and boots when `powered` turns true
 * (the camera has sat down), and collapses to a line and switches off when it turns false.
 */
function ScreenDisplay({ powered, zooming, onBooted }: Props) {
    const [prevPowered, setPrevPowered] = useState(powered);
    const [bootId, setBootId] = useState(0);
    const [shuttingDown, setShuttingDown] = useState(false);
    const { width, height } = useThree((state) => state.size);

    // Adjust state while rendering when the prop flips (React's recommended alternative to an effect).
    if (powered !== prevPowered) {
        setPrevPowered(powered);
        setShuttingDown(!powered);
        if (powered) setBootId((id) => id + 1);
    }

    useEffect(() => {
        if (!shuttingDown) return;
        const timer = setTimeout(() => setShuttingDown(false), SHUTDOWN_MS);
        return () => clearTimeout(timer);
    }, [shuttingDown]);

    if (!powered && !shuttingDown) return null;

    // drei's transform mode maps 1 CSS px to distanceFactor / 400 world units.
    const scale = metersPerPagePixel(width, height);
    const glass = { width: GLASS_WIDTH / scale, height: GLASS_HEIGHT / scale };
    const page = { width, height, left: (glass.width - width) / 2, top: (glass.height - height) / 2 };

    return (
        <Html
            transform
            occlude="blending"
            distanceFactor={400 * scale}
            position={[0, 0, PAGE_OFFSET]}
            material={<ScreenHoleMaterial />}
        >
            <div className="crt-glass" style={glass}>
                <Terminal key={bootId} shuttingDown={shuttingDown} zooming={zooming} onBooted={onBooted} page={page} />
            </div>
        </Html>
    );
}

// "blending" occlusion puts the HTML behind the canvas; this punches a see-through hole in the
// canvas where the screen is. Anything nearer the camera (like the keycard) still draws on top.
function ScreenHoleMaterial() {
    return <meshBasicMaterial color="black" opacity={0} blending={THREE.NoBlending} toneMapped={false} fog={false} />;
}

type TerminalProps = {
    shuttingDown: boolean;
    zooming: boolean;
    onBooted: () => void;
    page: { width: number; height: number; left: number; top: number };
};

function Terminal({ shuttingDown, zooming, onBooted, page }: TerminalProps) {
    const [linesShown, setLinesShown] = useState(0);
    const [booted, setBooted] = useState(false);
    const finishBoot = useEffectEvent(() => {
        setBooted(true);
        onBooted();
    });

    useEffect(() => {
        const timers = BOOT_LINES.map((_, i) => setTimeout(() => setLinesShown(i + 1), POWER_ON_MS + i * LINE_MS));
        timers.push(setTimeout(finishBoot, BOOT_DONE_MS));
        return () => timers.forEach(clearTimeout);
    }, []);

    const state = shuttingDown ? 'crt-shutdown' : zooming ? 'crt-zooming' : booted ? 'crt-idle' : 'crt-power-on';

    return (
        <div className={`crt ${state}`}>
            {/* Same classes as the full-screen site's root, so fonts and colors match exactly. */}
            <div className="crt-page bg-mdr-bg font-mono text-mdr-ink" style={page}>
                {booted ? (
                    <SitePage />
                ) : (
                    <div className="crt-boot">
                        {BOOT_LINES.slice(0, linesShown).map((line, i) => (
                            <p key={i}>{line || ' '}</p>
                        ))}
                        {linesShown === BOOT_LINES.length && <div className="crt-progress" />}
                        <span className="crt-cursor" />
                    </div>
                )}
            </div>
            <div className="crt-overlay" />
        </div>
    );
}

export default ScreenDisplay;
