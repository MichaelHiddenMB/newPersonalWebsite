import { lazy, Suspense, useEffect, useRef } from 'react';
import { loadLanyard } from './Lanyard/load';
import SitePage from './SitePage';

// Physics + card model are downloaded separately (see App: it starts this when you sit down).
const Lanyard = lazy(loadLanyard);

// Above the 3D canvas, which drei's screen occlusion lifts to a very high z-index.
const ABOVE_CANVAS = 16777272;

/**
 * The website at normal size, shown once the camera has zoomed into the CRT.
 * The monitor shows this same page at the same size, so the handoff is seamless; the keycard lanyard
 * keeps hanging over it. Esc or "Leave desk" zooms back out.
 */
function FullScreenSite({ onExit }: { onExit: () => void }) {
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onExit();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onExit]);

    return (
        <div
            ref={rootRef}
            className="fixed inset-0 overflow-y-auto bg-mdr-bg font-mono text-mdr-ink animate-site-fade-in"
            style={{ zIndex: ABOVE_CANVAS }}
        >
            <SitePage onExit={onExit} />
            <Suspense fallback={null}>
                <Lanyard eventSource={rootRef} />
            </Suspense>
        </div>
    );
}

export default FullScreenSite;
