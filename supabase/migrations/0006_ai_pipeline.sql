-- Eagle Eye 360 · ATLIP — migration 0006: real AI pipeline
-- 1) On-device model detections may be recorded (source = 'model').
drop policy if exists det_insert on public.detection_events;
create policy det_insert on public.detection_events for insert to authenticated
  with check (user_id = auth.uid() and source in ('demo-scene','mobile-heuristic','model')
              and app.has_role(array['super_admin','system_admin','supervisor','analyst','operator','support_officer']));

-- 2) Replace the demo's placeholder registry entries (models that never existed) with the real, evaluated models.
delete from public.ai_models where version in ('atlip-yolo v2.3.0','atlip-yolo v2.2.1','atlip-yolo v2.1.0');
update public.ai_models set version = 'colour heuristic 0.9 (fallback)', evaluation = 'Fallback only — not a trained model; selectable in Mobile Camera Detection' where version = 'on-device heuristic 0.9';
insert into public.ai_models (version, dataset_ref, evaluation, status) values
 ('atlip-pipeline 1.0 (YOLO11n + atlip-state-v2)',
  'Detector: COCO 2017 (Ultralytics YOLO11n, AGPL-3.0). State: Udacity/MIT traffic-light crops + synthetic UNKNOWN',
  'DriveU test frames (eval only): recall 50.8% of lights ≥25 px at conf 0.25. State: 97.1% in-domain accuracy; 98.7% precision of colour claims on 2,494 unseen German crops at conf 0.7 (56% coverage, rest UNKNOWN). Not yet validated on Ghanaian signals.',
  'PRODUCTION'),
 ('atlip-pipeline 1.0-hq (YOLO11s + atlip-state-v2)',
  'Detector: COCO 2017 (Ultralytics YOLO11s, AGPL-3.0). State: as above',
  'DriveU test frames (eval only): recall 62.9% of lights ≥25 px at conf 0.25; ~3x slower than YOLO11n. Optional high-accuracy mode for desktops.',
  'STAGED'),
 ('atlip-state-v1',
  'Udacity/MIT traffic-light crops + synthetic UNKNOWN',
  'Superseded by v2: 96.6% in-domain; 98.9% colour-claim precision but only 45% coverage on unseen German crops at conf 0.8.',
  'ARCHIVED')
on conflict (version) do nothing;
