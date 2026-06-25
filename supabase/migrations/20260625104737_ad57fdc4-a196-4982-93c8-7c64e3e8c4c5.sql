INSERT INTO public.app_settings (key, value, description)
VALUES ('ai_summary_provider', '"gemini"'::jsonb, 'AI Catch Me Up provider: "gemini" (Google) or "icp" (Qwen 3 32B on Internet Computer)')
ON CONFLICT (key) DO NOTHING;