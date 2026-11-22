-- Eagle Eye 360 · ATLIP — migration 0004: aggregated detection statistics (RLS applies: SECURITY INVOKER)
create or replace function public.detection_stats() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with d24 as (select * from public.detection_events where created_at > now() - interval '24 hours'),
       d7  as (select * from public.detection_events where created_at > now() - interval '7 days')
  select jsonb_build_object(
    'total_24h', (select count(*) from d24),
    'mean_conf_verified_24h', (select round(avg(confidence)::numeric, 3) from d24 where state <> 'UNKNOWN'),
    'by_state_24h', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) from (select state, count(*) n from d24 group by state) s),
    'by_hour_24h', (select coalesce(jsonb_object_agg(h, n), '{}'::jsonb) from (select extract(hour from created_at)::int h, count(*) n from d24 group by 1) s),
    'by_state_7d', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) from (select state, count(*) n from d7 group by state) s),
    'conf_bands_7d', (select jsonb_build_object(
        '0.90–1.00', count(*) filter (where confidence >= 0.9),
        '0.80–0.89', count(*) filter (where confidence >= 0.8 and confidence < 0.9),
        '0.70–0.79', count(*) filter (where confidence >= 0.7 and confidence < 0.8),
        '<0.70', count(*) filter (where confidence < 0.7)) from d7),
    'by_intersection_7d', (select coalesce(jsonb_object_agg(intersection_id, n), '{}'::jsonb) from (select intersection_id, count(*) n from d7 where intersection_id is not null group by 1) s),
    'review_flagged_7d', (select count(*) from d7 where state = 'UNKNOWN' or confidence < 0.70),
    'by_source_7d', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (select source, count(*) n from d7 group by source) s)
  )
$$;
revoke execute on function public.detection_stats() from public, anon;
grant execute on function public.detection_stats() to authenticated;
