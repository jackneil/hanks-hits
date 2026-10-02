-- READ ONLY. Counts the app_progress rows that still hold a value in a
-- field where a player types words (issue #26i). It prints one line for each
-- app that has such rows, then the line "total|<n>" (always printed, also
-- when n is 0). It prints counts only, never a value.
--
--   psql "$DATABASE_PUBLIC_URL" -X -q -At -v ON_ERROR_STOP=1 -f packages/db/scripts/typed-words-count.sql
--
-- Who uses it:
-- - The purge of the accounts change (design/ACCOUNTS_COPPA.md, section 6.1,
--   steps 6, 10 and 12). That purge does not change app_progress. The total
--   must be 0 before the old database backups are replaced (step 12).
-- - The server clear of the local word store change (design/LOCAL_WORDS.html,
--   section 4). The total is 0 after that clear.
--
-- The fields are the fields of design/LOCAL_WORDS.html, section 3. Keep the
-- two lists the same. A field counts when it holds a value that is not blank:
-- a non-empty string, a list with a word in it, or a location that is not
-- null. A value can be the game's own default word (a pet called by its
-- species name, "Feeder 1"), so before the clear the total is an upper limit.
-- After the clear each field is blank or gone, so the total is 0.
--
-- Fail closed: a value of an unexpected shape (a list field that is not a
-- list, a list item that is not an object) counts. The clear does not know
-- that shape, so a person must look at the row. The query never stops on it.
SET default_transaction_read_only = on;

WITH progress AS (
  SELECT
    app_id,
    data,
    data -> 'party' AS party,
    data -> 'savedLocations' AS saved_locations,
    data -> 'wishlistItems' AS wishlist_items,
    data -> 'savedArtworks' AS saved_artworks,
    data -> 'savedBeats' AS saved_beats,
    data #> '{adventure,feeders}' AS feeders
  FROM app_progress
  WHERE app_id IN ('oregon-trail', 'weather', 'toy-finder', 'drawing-app', 'drum-machine', 'virtual-pet', 'four-wheeler-3d')
),
lists AS (
  -- Each list as a JSON array ('[]' when it is missing or not a list), and
  -- "odd" when the field is there but is not a list.
  SELECT
    *,
    CASE WHEN jsonb_typeof(party) = 'array' THEN party ELSE '[]'::jsonb END AS party_list,
    coalesce(jsonb_typeof(party), 'null') NOT IN ('array', 'null') AS party_odd,
    CASE WHEN jsonb_typeof(saved_locations) = 'array' THEN saved_locations ELSE '[]'::jsonb END AS saved_locations_list,
    coalesce(jsonb_typeof(saved_locations), 'null') NOT IN ('array', 'null') AS saved_locations_odd,
    CASE WHEN jsonb_typeof(wishlist_items) = 'array' THEN wishlist_items ELSE '[]'::jsonb END AS wishlist_items_list,
    coalesce(jsonb_typeof(wishlist_items), 'null') NOT IN ('array', 'null') AS wishlist_items_odd,
    CASE WHEN jsonb_typeof(saved_artworks) = 'array' THEN saved_artworks ELSE '[]'::jsonb END AS saved_artworks_list,
    coalesce(jsonb_typeof(saved_artworks), 'null') NOT IN ('array', 'null') AS saved_artworks_odd,
    CASE WHEN jsonb_typeof(saved_beats) = 'array' THEN saved_beats ELSE '[]'::jsonb END AS saved_beats_list,
    coalesce(jsonb_typeof(saved_beats), 'null') NOT IN ('array', 'null') AS saved_beats_odd,
    CASE WHEN jsonb_typeof(feeders) = 'array' THEN feeders ELSE '[]'::jsonb END AS feeders_list,
    coalesce(jsonb_typeof(feeders), 'null') NOT IN ('array', 'null') AS feeders_odd
  FROM progress
),
typed AS (
  SELECT app_id FROM lists
  WHERE CASE app_id
    -- Oregon Trail: the leader name and the family names.
    WHEN 'oregon-trail' THEN
      coalesce(data ->> 'leaderName', '') <> ''
      OR party_odd
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(party_list) AS m
                 WHERE jsonb_typeof(m) NOT IN ('object', 'null') OR coalesce(m ->> 'name', '') <> '')
    -- Weather: the saved towns and the last town.
    WHEN 'weather' THEN
      jsonb_array_length(saved_locations_list) > 0
      OR saved_locations_odd
      OR coalesce(jsonb_typeof(data -> 'lastLocation'), 'null') <> 'null'
    -- Toy Finder: the wishlist notes.
    WHEN 'toy-finder' THEN
      wishlist_items_odd
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(wishlist_items_list) AS m
                 WHERE jsonb_typeof(m) NOT IN ('object', 'null') OR coalesce(m ->> 'notes', '') <> '')
    -- Drawing: the saved pictures and their names.
    WHEN 'drawing-app' THEN
      jsonb_array_length(saved_artworks_list) > 0
      OR saved_artworks_odd
    -- Drum Machine: the beat names.
    WHEN 'drum-machine' THEN
      saved_beats_odd
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(saved_beats_list) AS m
                 WHERE jsonb_typeof(m) NOT IN ('object', 'null') OR coalesce(m ->> 'name', '') <> '')
    -- Virtual Pet: the pet name, in two places.
    WHEN 'virtual-pet' THEN
      coalesce(data #>> '{pet,name}', '') <> ''
      OR coalesce(data #>> '{settings,petName}', '') <> ''
    -- 4-Wheeler 3D: the outfit words and the feeder labels.
    WHEN 'four-wheeler-3d' THEN
      coalesce(data #>> '{adventure,outfit,text}', '') <> ''
      OR feeders_odd
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(feeders_list) AS m
                 WHERE jsonb_typeof(m) NOT IN ('object', 'null') OR coalesce(m ->> 'label', '') <> '')
    ELSE false
  END
)
SELECT coalesce(app_id, 'total') AS app, count(*) AS rows_with_typed_words
FROM typed
GROUP BY ROLLUP (app_id)
ORDER BY app_id NULLS LAST;
