/**
 * The app's own files an HTML design is styled by: the copies the design keeps
 * under `assets/host/`, which the daemon serves under `HOST_FILES_PREFIX`. A
 * design never fetches them from the running app, so everyone who opens it
 * sees the same page.
 */

/** Where the daemon serves a design's stored host files, by their path in the app. */
export const HOST_FILES_PREFIX = "/api/host-files";
/** Marks a host stylesheet `<link>` with the path it was configured as. */
export const HOST_STYLESHEET_ATTRIBUTE = "data-velloo-host-stylesheet";
