-- Eagle Eye 360 · ATLIP — (re)import traffic-light locations from OpenStreetMap for voice alerts.
-- Run manually in the Supabase SQL editor (or via the MCP execute_sql tool). Not an automatic migration:
-- it calls the public Overpass API through pg_net, so it depends on that service being reachable.
-- Data © OpenStreetMap contributors, ODbL 1.0 — attribution is shown on the Voice Traffic Alerts page.
--
-- Step 1 — queue one request per area (small bounding boxes; country-wide queries time out on Overpass).
--          bbox order is south,west,north,east.
create extension if not exists pg_net;
select net.http_get(
  url := 'https://overpass-api.de/api/interpreter',
  params := jsonb_build_object('data', '[out:json][timeout:60];node["highway"="traffic_signals"](' || bbox || ');out;'),
  timeout_milliseconds := 90000) as request_id, area
from (values
  ('5.48,-0.36,5.75,-0.05', 'Greater Accra'),
  ('6.62,-1.70,6.76,-1.53', 'Kumasi')
) as a(bbox, area);

-- Step 2 — after ~1 minute, load the responses (replace the ids with the request_ids returned above).
-- Re-running is safe: osm_id is unique, so existing points are updated in place.
insert into public.traffic_signals (osm_id, lat, lon, name, source)
select (e->>'id')::bigint, (e->>'lat')::double precision, (e->>'lon')::double precision,
       nullif(coalesce(e->'tags'->>'name', e->'tags'->>'junction:name', ''), ''), 'osm'
from net._http_response r, jsonb_array_elements((r.content::jsonb)->'elements') e
where r.id in (/* request ids */ 0) and r.status_code = 200
on conflict (osm_id) do update set lat = excluded.lat, lon = excluded.lon, name = coalesce(excluded.name, public.traffic_signals.name);

-- Step 3 — check.
select source, count(*) from public.traffic_signals group by source order by source;
