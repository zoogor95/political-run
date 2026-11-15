-- A home region is where a person lives in real life, so each person has one (a country and a region of it), kept on the
-- account. Anything picked in the first version, which kept one per map, moves across (the latest pick) and that table goes.
UPDATE accounts
   SET home_country = (SELECT CASE h.map_pack_id WHEN 'uk' THEN 'GB' WHEN 'pk' THEN 'PK' WHEN 'us' THEN 'US' END FROM home_regions h WHERE h.account_id = accounts.id ORDER BY h.updated_at DESC LIMIT 1),
       home_region = (SELECT h.region_id FROM home_regions h WHERE h.account_id = accounts.id ORDER BY h.updated_at DESC LIMIT 1)
 WHERE id IN (SELECT account_id FROM home_regions);
DROP TABLE home_regions;
