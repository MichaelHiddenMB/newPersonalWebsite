// Shared between the camera's zoom (Scene.tsx) and the page on the CRT (ScreenDisplay.tsx).

/** The model's Screen mesh (the glass), in meters. */
export const GLASS_WIDTH = 0.27;
export const GLASS_HEIGHT = 0.205;

/** How far in front of the Screen mesh the HTML page sits, in meters. */
export const PAGE_OFFSET = 0.0005;

/**
 * The page is laid out at the real window size and fit inside the glass ("contain"). The camera's
 * zoomed-in shot shows exactly that area, so each page pixel lands on one screen pixel and the
 * full-screen site can take over without a jump.
 */
export function metersPerPagePixel(windowWidth: number, windowHeight: number) {
    return Math.min(GLASS_WIDTH / windowWidth, GLASS_HEIGHT / windowHeight);
}
