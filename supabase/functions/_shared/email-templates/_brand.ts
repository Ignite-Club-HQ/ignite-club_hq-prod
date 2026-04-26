// Shared Ignite Club HQ brand styling for auth emails.
// Brand tokens mirror src/index.css design tokens (light mode).

export const LOGO_URL = 'https://igniteclubhq.app/ignite-email-logo.png'

const FONT_STACK =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// hsl(160 84% 32%) ≈ #0d9669 — Ignite emerald primary
const PRIMARY = '#0d9669'
const FG = '#1a2420'
const MUTED = '#525c58'
const SUBTLE = '#8a9590'
const BORDER = '#e2e8e5'
const SURFACE = '#f6f8f7'

export const styles = {
  main: {
    backgroundColor: '#ffffff',
    fontFamily: FONT_STACK,
    margin: '0',
    padding: '0',
  },
  container: {
    maxWidth: '560px',
    margin: '0 auto',
    padding: '32px 24px 40px',
  },
  logoWrap: {
    textAlign: 'center' as const,
    margin: '0 0 28px',
  },
  logo: {
    height: '40px',
    width: 'auto',
    display: 'inline-block',
  },
  card: {
    backgroundColor: '#ffffff',
    border: `1px solid ${BORDER}`,
    borderRadius: '12px',
    padding: '32px 28px',
  },
  h1: {
    fontSize: '22px',
    fontWeight: '700' as const,
    color: FG,
    margin: '0 0 16px',
    lineHeight: '1.3',
  },
  text: {
    fontSize: '15px',
    color: MUTED,
    lineHeight: '1.6',
    margin: '0 0 20px',
  },
  link: {
    color: PRIMARY,
    textDecoration: 'underline',
  },
  button: {
    backgroundColor: PRIMARY,
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: '600' as const,
    borderRadius: '12px',
    padding: '13px 24px',
    textDecoration: 'none',
    display: 'inline-block',
  },
  buttonWrap: {
    textAlign: 'center' as const,
    margin: '8px 0 24px',
  },
  codeBox: {
    backgroundColor: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: '12px',
    padding: '20px 16px',
    textAlign: 'center' as const,
    margin: '0 0 24px',
  },
  code: {
    fontFamily: "'SF Mono', Menlo, Monaco, Consolas, monospace",
    fontSize: '32px',
    fontWeight: '700' as const,
    color: FG,
    letterSpacing: '8px',
    margin: '0',
  },
  hr: {
    border: 'none',
    borderTop: `1px solid ${BORDER}`,
    margin: '24px 0',
  },
  footer: {
    fontSize: '12px',
    color: SUBTLE,
    lineHeight: '1.5',
    margin: '0',
    textAlign: 'center' as const,
  },
}
