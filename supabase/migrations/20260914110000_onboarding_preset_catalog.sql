-- Onboarding presets are semantic, immutable catalog entries. They describe
-- the setup recommendation; they never contain tenant or materialized IDs.

DO $catalog$
DECLARE
  v_rows jsonb;
  v_row jsonb;
  v_key text;
  v_payload jsonb;
  v_existing public.platform_catalog_entries%rowtype;
BEGIN
  v_rows := jsonb_build_array(
    jsonb_build_object(
      'key', 'onboarding_preset.manifest',
      'payload', $manifest${
        "schema_version": 1,
        "manifest_version": 1,
        "questions": [
          {"key":"size_band","type":"single","label":"How many people will use this workspace?","description":"Choose the closest fit. You can change your setup later.","required":true,"options":[
            {"value":"solo","label":"Just me","description":"1–3 people"},
            {"value":"small","label":"Small team","description":"4–10 people"},
            {"value":"growing","label":"Growing team","description":"11–50 people"},
            {"value":"scaling","label":"Larger team","description":"51+ people"}
          ]},
          {"key":"operating_models","type":"multi","label":"What are you organizing first?","description":"Choose one or more types of work.","required":true,"options":[
            {"value":"client_delivery","label":"Client work","description":"Projects delivered for clients or customers"},
            {"value":"internal_operations","label":"Internal operations","description":"Work your own team runs day to day"},
            {"value":"product_development","label":"Product or development","description":"Ideas, releases, and technical work"},
            {"value":"portfolio_intake","label":"Many projects or requests","description":"A steady stream of work coming in"},
            {"value":"governed_regulatory","label":"Regulated or approval-heavy work","description":"Work with formal review or audit needs"}
          ]},
          {"key":"gates","type":"single","label":"Does work need approval before it is complete?","description":"This controls whether review is emphasized in your recommendations.","required":true,"visible_when":{"answer":"operating_models","values":["client_delivery","governed_regulatory"]},"options":[
            {"value":"none","label":"No approval","description":"Keep work moving with minimal ceremony"},
            {"value":"light","label":"A quick review","description":"Add a simple check before delivery"},
            {"value":"formal","label":"Formal approval","description":"Keep an explicit approval step"}
          ]},
          {"key":"time_tracking","type":"single","label":"How should time tracking work?","description":"Time tracking stays off unless you choose it here.","required":true,"visible_when":{"answer":"operating_models","values":["client_delivery","product_development","governed_regulatory"]},"options":[
            {"value":"off","label":"Keep it off","description":"Use tasks without a timer"},
            {"value":"optional","label":"Optional for the team","description":"Track time only when useful"},
            {"value":"required","label":"Required for work","description":"Use time for billing or planning"}
          ]},
          {"key":"files","type":"single","label":"Who should usually see uploaded files?","description":"We start with the narrowest useful sharing boundary.","required":true,"visible_when":{"answer":"operating_models","values":["client_delivery","portfolio_intake","governed_regulatory"]},"options":[
            {"value":"light","label":"People on the task","description":"Keep files close to the work"},
            {"value":"centralized","label":"Everyone in the workspace","description":"Make shared files easy to find"},
            {"value":"governed","label":"A controlled group","description":"Use a deliberate sharing boundary"}
          ]},
          {"key":"repeating_work","type":"single","label":"How often does the same kind of work repeat?","description":"This helps us recommend a starter template at the right time.","required":true,"options":[
            {"value":"rare","label":"Rarely","description":"Most work is different"},
            {"value":"sometimes","label":"Sometimes","description":"Some work follows a pattern"},
            {"value":"frequent","label":"Frequently","description":"Templates will save us time"}
          ]}
        ]
      }$manifest$::jsonb
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.size.solo',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'size_band', 'selection_key', 'solo', 'label', 'Just me',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Start with Main Workflow'),
          'gates', jsonb_build_array('Keep approval steps optional until they are needed'),
          'time', jsonb_build_array('Keep timers off by default'),
          'files', jsonb_build_array('Keep files close to the task'),
          'repeating_work', jsonb_build_array('Use a starter template when a pattern emerges'),
          'tutorial_topics', jsonb_build_array('Create your first task', 'Move work through the workflow', 'Invite a teammate')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator keeps full workspace ownership', 'The creator can manage settings, roles, and members'),
          'member', jsonb_build_array('Members can view assigned tasks, comment, and submit work'),
          'tutorial_topics', jsonb_build_array('Create your first task', 'Move work through the workflow')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('timers_enabled', false, 'advanced_gates_enabled', false, 'default_file_scope', 'task')),
        'deferred', jsonb_build_array('Additional roles and permissions', 'Timers and advanced automation', 'Shared FileHub channels')
      )
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.size.small',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'size_band', 'selection_key', 'small', 'label', 'Small team',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Start with Main Workflow', 'Use one shared workflow until the team needs more'),
          'gates', jsonb_build_array('Use a light review when work leaves the team'),
          'time', jsonb_build_array('Make time tracking optional'),
          'files', jsonb_build_array('Keep files task-scoped first'),
          'repeating_work', jsonb_build_array('Create a shared starter when work repeats'),
          'tutorial_topics', jsonb_build_array('Invite teammates', 'Assign work', 'Find shared files')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator keeps full workspace ownership', 'The creator can invite members and manage roles'),
          'member', jsonb_build_array('Members can view assigned tasks, comment, and submit work'),
          'tutorial_topics', jsonb_build_array('Invite teammates', 'Assign work')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('timers_enabled', false, 'advanced_gates_enabled', false, 'default_file_scope', 'task')),
        'deferred', jsonb_build_array('Multiple teams and custom role matrices', 'Timers and advanced automation', 'Shared FileHub channels')
      )
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.size.growing',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'size_band', 'selection_key', 'growing', 'label', 'Growing team',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Start with Main Workflow', 'Separate workflows only by a clear ownership need'),
          'gates', jsonb_build_array('Document who reviews work before adding more gates'),
          'time', jsonb_build_array('Use optional time tracking while practices settle'),
          'files', jsonb_build_array('Introduce shared folders with deliberate access'),
          'repeating_work', jsonb_build_array('Turn repeated delivery into a reusable template'),
          'tutorial_topics', jsonb_build_array('Set up team ownership', 'Review work safely', 'Reuse a project template')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator keeps full workspace ownership', 'Admins can manage members, roles, workflows, and company settings'),
          'member', jsonb_build_array('Members can view assigned tasks, comment, and submit work'),
          'tutorial_topics', jsonb_build_array('Set up team ownership', 'Review work safely')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('timers_enabled', false, 'advanced_gates_enabled', false, 'default_file_scope', 'task')),
        'deferred', jsonb_build_array('Department-specific permissions', 'Automated timers and escalation', 'Company-wide FileHub structure')
      )
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.size.scaling',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'size_band', 'selection_key', 'scaling', 'label', 'Larger team',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Start with Main Workflow', 'Plan ownership before creating many workflows'),
          'gates', jsonb_build_array('Make review ownership explicit'),
          'time', jsonb_build_array('Pilot time tracking with one group first'),
          'files', jsonb_build_array('Use controlled sharing boundaries'),
          'repeating_work', jsonb_build_array('Standardize high-volume work with templates'),
          'tutorial_topics', jsonb_build_array('Set up ownership boundaries', 'Invite members safely', 'Standardize repeatable work')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator keeps full workspace ownership', 'Admins can manage members, roles, workflows, and company settings'),
          'member', jsonb_build_array('Members can view assigned tasks, comment, and submit work'),
          'tutorial_topics', jsonb_build_array('Set up ownership boundaries', 'Invite members safely')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('timers_enabled', false, 'advanced_gates_enabled', false, 'default_file_scope', 'task')),
        'deferred', jsonb_build_array('Department role design', 'Timers, escalation, and automation', 'Enterprise FileHub governance')
      )
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.overlay.client_delivery',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'operating_model_overlay', 'selection_key', 'client_delivery', 'label', 'Client work',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Track work from intake to delivery'),
          'gates', jsonb_build_array('Use a quick review before client delivery'),
          'time', jsonb_build_array('Optional billable time tracking'),
          'files', jsonb_build_array('Keep client files in a deliberate project or task boundary'),
          'repeating_work', jsonb_build_array('Save successful delivery patterns as starters'),
          'tutorial_topics', jsonb_build_array('Create a client project', 'Share files safely', 'Review before delivery')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator can manage clients, projects, members, and settings'),
          'member', jsonb_build_array('Members can work on assigned client tasks and comment without seeing unrelated company-wide data'),
          'tutorial_topics', jsonb_build_array('Create a client project', 'Share files safely')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('client_file_sharing', 'task', 'timers_enabled', false)),
        'deferred', jsonb_build_array('External client access', 'Billing and billable-rate policy', 'Automated client approval notifications')
      )
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.overlay.internal_operations',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'operating_model_overlay', 'selection_key', 'internal_operations', 'label', 'Internal operations',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Keep one simple internal workflow'),
          'gates', jsonb_build_array('Skip approval unless the work truly needs it'),
          'time', jsonb_build_array('Keep timers off until the team has a clear reason'),
          'files', jsonb_build_array('Use task-scoped files first'),
          'repeating_work', jsonb_build_array('Use templates for recurring internal requests'),
          'tutorial_topics', jsonb_build_array('Create an internal request', 'Assign an owner', 'Reuse a template')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator can manage members, roles, workflows, and company settings'),
          'member', jsonb_build_array('Members can see assigned internal work, comment, and submit work'),
          'tutorial_topics', jsonb_build_array('Create an internal request', 'Assign an owner')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('timers_enabled', false, 'advanced_gates_enabled', false)),
        'deferred', jsonb_build_array('Department structures', 'Advanced automation', 'Company-wide FileHub channels')
      )
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.overlay.product_development',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'operating_model_overlay', 'selection_key', 'product_development', 'label', 'Product or development',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Use stages for ideas, active work, review, and release'),
          'gates', jsonb_build_array('Review work before release when useful'),
          'time', jsonb_build_array('Use optional planning time'),
          'files', jsonb_build_array('Attach specs and release files to the work'),
          'repeating_work', jsonb_build_array('Create release and maintenance starters'),
          'tutorial_topics', jsonb_build_array('Plan a release', 'Move work through review', 'Attach a file')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator can manage product work, members, roles, workflows, and settings'),
          'member', jsonb_build_array('Members can view assigned development work, comment, and submit work'),
          'tutorial_topics', jsonb_build_array('Plan a release', 'Move work through review')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('timers_enabled', false, 'advanced_gates_enabled', false)),
        'deferred', jsonb_build_array('Release automation', 'Engineering-specific permissions', 'Connected repository policy')
      )
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.overlay.portfolio_intake',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'operating_model_overlay', 'selection_key', 'portfolio_intake', 'label', 'Many projects or requests',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Start with a clear request intake path'),
          'gates', jsonb_build_array('Add prioritization before formal review'),
          'time', jsonb_build_array('Keep time tracking optional during intake'),
          'files', jsonb_build_array('Centralize reference files only when needed'),
          'repeating_work', jsonb_build_array('Use templates for high-volume requests'),
          'tutorial_topics', jsonb_build_array('Capture a request', 'Prioritize work', 'Turn a request into a project')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator can manage intake, projects, members, roles, workflows, and settings'),
          'member', jsonb_build_array('Members can view assigned requests, comment, and submit work'),
          'tutorial_topics', jsonb_build_array('Capture a request', 'Prioritize work')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('timers_enabled', false, 'advanced_gates_enabled', false, 'default_file_scope', 'task')), 
        'deferred', jsonb_build_array('Portfolio-level reporting', 'Automated intake routing', 'Company-wide FileHub taxonomy')
      )
    ),
    jsonb_build_object(
      'key', 'onboarding_preset.overlay.governed_regulatory',
      'payload', jsonb_build_object(
        'schema_version', 1, 'preset_type', 'operating_model_overlay', 'selection_key', 'governed_regulatory', 'label', 'Regulated or approval-heavy work',
        'recommendations', jsonb_build_object(
          'workflow', jsonb_build_array('Make review ownership explicit'),
          'gates', jsonb_build_array('Use formal approval only where policy requires it'),
          'time', jsonb_build_array('Choose time tracking after policy review'),
          'files', jsonb_build_array('Use controlled FileHub sharing'),
          'repeating_work', jsonb_build_array('Version approved templates deliberately'),
          'tutorial_topics', jsonb_build_array('Set an approver', 'Share files with a controlled group', 'Review activity history')
        ),
        'guarantees', jsonb_build_object(
          'admin', jsonb_build_array('The creator keeps full ownership and can manage roles, members, workflows, and settings'),
          'member', jsonb_build_array('Members only receive the task and file access granted by company permissions'),
          'tutorial_topics', jsonb_build_array('Set an approver', 'Review activity history')
        ),
        'safe_defaults', jsonb_build_object('catalog_keys', jsonb_build_array('task_workflow.standard'), 'feature_settings', jsonb_build_object('timers_enabled', false, 'advanced_gates_enabled', false, 'default_file_scope', 'controlled')), 
        'deferred', jsonb_build_array('Legal retention policy', 'Regulatory audit policy', 'Billing and data residency decisions')
      )
    )
  );

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) AS item(value)
  LOOP
    v_key := v_row->>'key';
    v_payload := v_row->'payload';
    SELECT * INTO v_existing
      FROM public.platform_catalog_entries
     WHERE catalog_key = v_key AND version = 1;

    IF v_existing.catalog_key IS NULL THEN
      INSERT INTO public.platform_catalog_entries (
        catalog_key, version, kind, owner_scope, classification,
        permission_boundary, customization_policy, update_policy,
        cloneable, editable, replaceable, existing_companies_affected,
        payload, content_hash, baseline_hash, publication_state,
        lifecycle_state, published_at
      ) VALUES (
        v_key, 1, 'onboarding_preset', 'onboarding', 'one_time_onboarding_choice',
        'authenticated-company-member', 'immutable-company-snapshot', 'append-only-explicit-upgrade',
        false, false, false, false, v_payload, '', '', 'published', 'published', now()
      );
    ELSIF v_existing.payload <> v_payload THEN
      RAISE EXCEPTION 'onboarding preset v1 replay differs for %; refusing overwrite', v_key;
    END IF;

    INSERT INTO public.platform_catalog_heads (catalog_key, recommended_version, published_version)
    VALUES (v_key, 1, 1)
    ON CONFLICT (catalog_key) DO NOTHING;
  END LOOP;
END;
$catalog$;

COMMENT ON COLUMN public.platform_catalog_entries.payload IS
  'Semantic catalog payload. Onboarding preset entries contain answer metadata and recommendations, never tenant identifiers.';
