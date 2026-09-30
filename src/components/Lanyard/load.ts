/** Loads the lanyard (physics engine + card model). Called early, when you sit at the desk, so it's
 *  ready the moment the full-screen site opens. */
export const loadLanyard = () => import('./Lanyard');
