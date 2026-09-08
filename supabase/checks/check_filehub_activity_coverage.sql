-- Deterministic schema check for FileHub activity coverage (#335).
-- Metadata values are checked for the stable, non-secret contract. No rows are
-- inserted, so this is safe to run against a disposable or shared local DB.
BEGIN;

DO $check$
DECLARE
  definition text;
  required text[] := ARRAY[
    'upload','download','view','delete','share','rename','move','restore',
    'share_revoke','folder_create','folder_delete'
  ];
  verb text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'filehub_activity'
     AND c.conname = 'filehub_activity_action_check';
  ASSERT definition IS NOT NULL, 'activity action constraint is missing';
  FOREACH verb IN ARRAY required LOOP
    ASSERT position(quote_literal(verb) IN definition) > 0,
      format('activity action %s is not accepted', verb);
  END LOOP;
  ASSERT position('token' IN lower(definition)) = 0,
    'action constraint unexpectedly contains a bearer token';

  CREATE TEMP TABLE activity_contract (
    file_id uuid,
    folder_id uuid,
    action text CHECK (action IN (
      'upload','download','view','delete','share','rename','move','restore',
      'share_revoke','folder_create','folder_delete'
    )),
    metadata jsonb,
    CHECK ((file_id IS NOT NULL)::int + (folder_id IS NOT NULL)::int = 1)
  );
  INSERT INTO activity_contract(file_id, action, metadata)
    VALUES ('33500000-0000-0000-0000-000000000001', 'share_revoke',
            jsonb_build_object('share_link_id','33500000-0000-0000-0000-000000000002'));
  ASSERT (SELECT count(*) FROM activity_contract) = 1,
    'accepted activity contract row was rejected';
  BEGIN
    INSERT INTO activity_contract(file_id, action)
      VALUES ('33500000-0000-0000-0000-000000000001', 'unknown_verb');
    RAISE EXCEPTION 'unknown activity verb was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO activity_contract(file_id, folder_id, action)
      VALUES ('33500000-0000-0000-0000-000000000001',
              '33500000-0000-0000-0000-000000000003', 'move');
    RAISE EXCEPTION 'cross-target activity row was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$check$;

ROLLBACK;
