alter table public.amanda_app_release add constraint app_release_payload_encrypted check (coalesce(payload->>'$amanda','') = 'aes-256-gcm:v1');
alter table public.amanda_update_drafts add constraint update_draft_payload_encrypted check (coalesce(payload->>'$amanda','') = 'aes-256-gcm:v1');
