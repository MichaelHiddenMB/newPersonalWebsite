import Home from '../pages/Home';

/**
 * The website's page chrome + content. Rendered twice with identical layout: shrunk onto the CRT
 * (inert, no `onExit`) and full-screen once the camera has zoomed in, so the handoff is seamless.
 */
function SitePage({ onExit }: { onExit?: () => void }) {
    return (
        <>
            <header className="sticky top-0 flex items-center justify-between border-b-2 border-mdr-ink/60 bg-mdr-bg px-8 py-5 text-sm tracking-[0.3em]">
                <span>LUMON</span>
                {onExit ? (
                    <button type="button" onClick={onExit} className="cursor-pointer tracking-[0.3em] hover:text-white">
                        LEAVE DESK
                    </button>
                ) : (
                    <span>LEAVE DESK</span>
                )}
            </header>
            <main className="mx-auto max-w-4xl px-8 py-12 [&_h1]:mb-4 [&_h1]:text-5xl [&_h1]:font-semibold">
                <Home />
            </main>
        </>
    );
}

export default SitePage;
