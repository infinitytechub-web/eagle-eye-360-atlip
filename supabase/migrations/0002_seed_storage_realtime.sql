-- Eagle Eye 360 · ATLIP — migration 0002: reference data, seed history, storage, realtime

insert into public.intersections (id, name, city, lat, lon, map_x, map_y, current_state) values
 ('IX-01','Circle / Kwame Nkrumah Interchange','Accra',5.5698,-0.2147,180,150,'RED'),
 ('IX-02','Airport City','Accra',5.6052,-0.1768,300,90,'GREEN'),
 ('IX-03','Cantonments','Accra',5.5833,-0.1667,330,140,'GREEN'),
 ('IX-04','Osu Oxford Street','Accra',5.5560,-0.1800,290,190,'CAUTION'),
 ('IX-05','Madina','Accra',5.6833,-0.1667,340,40,'RED'),
 ('IX-06','Tema Motorway Roundabout','Tema',5.6333,-0.0167,430,170,'UNKNOWN'),
 ('IX-07','Kejetia','Kumasi',6.6930,-1.6230,70,50,'GREEN');

insert into public.cameras (id, name, intersection_id, gateway_ref, status, retention_days, events_count, obstruction_count) values
 ('CAM-01','Circle — Ring Road East','IX-01','gw-accra ••••-1101','Online',14,412,6),
 ('CAM-02','Circle — North approach','IX-01','gw-accra ••••-1102','Online',14,388,3),
 ('CAM-03','Airport City — Liberation Rd','IX-02','gw-accra ••••-2201','Online',30,296,2),
 ('CAM-04','Cantonments — Embassy junction','IX-03','gw-accra ••••-3301','Online',14,241,1),
 ('CAM-05','Osu — Oxford St mid','IX-04','gw-accra ••••-4401','Obstructed',7,198,21),
 ('CAM-06','Madina — Zongo junction','IX-05','gw-accra ••••-5501','Online',14,354,4),
 ('CAM-07','Tema — Motorway roundabout','IX-06','gw-tema ••••-6601','Offline',30,87,9),
 ('CAM-08','Kejetia — Central market','IX-07','gw-kumasi ••••-7701','Online',14,267,5);
select setval('public.camera_seq', 8);

-- 7 days of labelled SEED history (source = 'seed'), with Accra morning/evening peaks
insert into public.detection_events (intersection_id, camera_id, state, confidence, verified, source, created_at)
select ix, cam, st, conf, st <> 'UNKNOWN', 'seed', ts
from (
  select
    (array['IX-01','IX-02','IX-03','IX-04','IX-05','IX-06','IX-07'])[1 + floor(random()*7)::int] as ix,
    null::text as cam,
    case when random() < 0.06 then 'UNKNOWN' else (array['RED','CAUTION','GREEN'])[1 + floor(random()*3)::int] end as st,
    round((0.62 + random()*0.37)::numeric, 3) as conf,
    date_trunc('hour', now()) - (d || ' days')::interval + (h || ' hours')::interval + (floor(random()*3600) || ' seconds')::interval as ts
  from generate_series(0,6) d, generate_series(0,23) h,
       lateral generate_series(1, case when h between 6 and 9 or h between 16 and 19 then 16 else 7 end) n
) s
where ts <= now();

update public.detection_events e set camera_id = c.id
from (select distinct on (intersection_id) intersection_id, id from public.cameras order by intersection_id, id) c
where e.intersection_id = c.intersection_id and e.camera_id is null;

insert into public.alerts (kind, severity, body, created_at) values
 ('camera','r','Camera disconnected — CAM-07 Tema Motorway Roundabout', now() - interval '12 minutes'),
 ('obstructed','a','Obstructed camera — CAM-05 Osu Oxford St (foliage / glare reported)', now() - interval '38 minutes'),
 ('lowconf','a','Low-confidence cluster at Madina (rain) — 9 events below 0.70', now() - interval '1 hour'),
 ('signal','r','RED observed at Circle / Kwame Nkrumah Interchange — advisory only', now() - interval '2 hours'),
 ('signal','g','GREEN observed at Airport City', now() - interval '2 hours 5 minutes'),
 ('security','a','Failed login attempts from an unrecognized device — locked by policy', now() - interval '3 hours');

insert into public.evidence_records (ref, intersection_id, state, notes, created_at)
select 'EV-2026-0' || (141 - i), (array['IX-01','IX-02','IX-03','IX-04','IX-05','IX-06'])[i+1],
       (array['RED','CAUTION','GREEN'])[(i % 3)+1], 'Seed evidence metadata — no video stored', now() - (i || ' hours')::interval
from generate_series(0,5) i;

insert into public.ai_models (version, dataset_ref, evaluation, status) values
 ('atlip-yolo v2.3.0','GH-Signals-2026.2 (Roboflow/CVAT, verified)','Evaluation pending on held-out Ghana set','STAGED'),
 ('atlip-yolo v2.2.1','GH-Signals-2026.1','Internal validation complete (figures withheld until external eval)','PRODUCTION'),
 ('atlip-yolo v2.1.0','GH-Signals-2025.4','Superseded','ARCHIVED'),
 ('on-device heuristic 0.9','n/a — brightness/hue heuristic, not trained','Runnable in Mobile Camera Detection','DEMO ONLY');

insert into public.notifications (type, priority, title, body, created_at) values
 ('announcement','Medium','Welcome to Eagle Eye 360 — ATLIP','The platform is now connected to its secure backend. Notifications, chat, communications and support tickets are stored server-side with role-based access.', now() - interval '5 minutes'),
 ('system','Medium','Camera CAM-07 offline','Tema Motorway Roundabout feed lost. Field team notified via the CCTV Centre.', now() - interval '47 minutes');

insert into public.branding (id, data) values (1, jsonb_build_object(
  'sysName','Eagle Eye 360','org','Eagle-eye productions',
  'tagline','ATLIP — AI Traffic Light Detector & Intelligence Platform',
  'welcome','Enterprise AI · Computer Vision · Traffic Surveillance · Security Intelligence',
  'footer','Eagle Eye 360 · ATLIP — AI Traffic Light Detector & Intelligence Platform · © Eagle-eye productions',
  'accent','#D4AF37','accent2','#EAC65A','primary','#0A2342','themeDefault','dark','logo',null));

-- ============ STORAGE ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('branding','branding', true, 1048576, array['image/png','image/jpeg','image/webp','image/svg+xml']),
 ('attachments','attachments', false, 10485760, null)
on conflict (id) do nothing;

create policy "branding public read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'branding');
create policy "branding super admin write" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and public.has_role(array['super_admin']));
create policy "branding super admin update" on storage.objects for update to authenticated
  using (bucket_id = 'branding' and public.has_role(array['super_admin']));
create policy "attachments read active" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_active_user());
create policy "attachments upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_active_user()
              and (storage.foldername(name))[1] = auth.uid()::text);

-- ============ REALTIME ============
alter publication supabase_realtime add table
  public.notifications, public.chat_messages, public.comm_messages, public.comm_receipts,
  public.tickets, public.ticket_events, public.detection_events, public.alerts, public.cameras, public.branding;
