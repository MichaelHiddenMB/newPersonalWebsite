import { useState } from 'react';
import FullScreenSite from './components/FullScreenSite';
import { loadLanyard } from './components/Lanyard/load';
import Scene, { type View } from './three/Scene';

function App() {
    const [view, setView] = useState<View>('overview');
    // The camera finished zooming into the CRT: show the real site on top and pause the 3D scene.
    const [siteOpen, setSiteOpen] = useState(false);

    const changeView = (next: View) => {
        if (next !== 'overview') void loadLanyard(); // get the full-screen site's lanyard ready early
        setView(next);
    };

    const leaveSite = () => {
        setSiteOpen(false);
        setView('desk');
    };

    return (
        <>
            <Scene view={view} onViewChange={changeView} paused={siteOpen} onScreenFilled={() => setSiteOpen(true)} />
            {siteOpen && <FullScreenSite onExit={leaveSite} />}
        </>
    );
}

export default App;
