import { IS_DEV_ENV, SUPABASE_PROJECT_REF } from "@/lib/env";

/**
 * Small fixed "DEV" badge shown only when the app is pointed at the dev
 * Supabase project. Rendered above every route so you can never confuse
 * a dev build for a prod build.
 *
 * Renders nothing in prod builds — zero visual or runtime cost.
 */
export const DevRibbon = () => {
  if (!IS_DEV_ENV) return null;

  return (
    <div
      role="status"
      aria-label="Development environment"
      title={`Supabase: ${SUPABASE_PROJECT_REF}`}
      style={{
        position: "fixed",
        top: "env(safe-area-inset-top, 0px)",
        right: 0,
        zIndex: 2147483647,
        background: "#f59e0b",
        color: "#111",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        padding: "2px 8px",
        borderBottomLeftRadius: 6,
        pointerEvents: "none",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      }}
    >
      DEV
    </div>
  );
};

export default DevRibbon;
