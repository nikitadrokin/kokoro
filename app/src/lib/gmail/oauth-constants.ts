/**
 * Fixed OAuth loopback used by the Tauri Gmail sign-in flow.
 * Must stay in sync with `OAUTH_REDIRECT_URI` in `src-tauri/src/gmail.rs`.
 *
 * Google prefers `127.0.0.1` over `localhost` for native/desktop loopback.
 */
export const GMAIL_OAUTH_LOOPBACK_PORT = 17890;

/** Exact redirect URI that must appear under Authorized redirect URIs. */
export const GMAIL_OAUTH_REDIRECT_URI = `http://127.0.0.1:${GMAIL_OAUTH_LOOPBACK_PORT}/oauth/callback`;
