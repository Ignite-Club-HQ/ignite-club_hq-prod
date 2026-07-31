SELECT net.http_post(
  url := public.internal_functions_base_url() || '/functions/v1/process-message-notifications',
  headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.internal_service_role_key()),
  body := jsonb_build_object(
    'messageType','team',
    'messageId','00000000-0000-0000-0000-000000000000',
    'authorId','00000000-0000-0000-0000-000000000000',
    'messageText','[auth verification probe]')
);