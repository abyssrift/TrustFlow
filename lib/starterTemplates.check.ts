// Self-check for starter templates — run: npx tsx lib/starterTemplates.check.ts
// No framework (ponytail): plain asserts. Guards the contract that
// rpc_instantiate_template and the tasks_weight_1_10 CHECK constraint
// actually enforce server-side, so a bad starter fails loud in dev instead
// of erroring (or silently truncating) at instantiate time in prod.
import assert from 'node:assert';
import { STARTER_TEMPLATES } from './starterTemplates';

const VALID_PRIORITIES = new Set(['urgent', 'high', 'medium', 'low']);
const seenIds = new Set<string>();

assert.ok(STARTER_TEMPLATES.length >= 8, `expected at least 8 starter templates, got ${STARTER_TEMPLATES.length}`);

const sectors = new Set(STARTER_TEMPLATES.map(t => t.sector));
assert.ok(sectors.size >= 8 && sectors.size <= 12, `expected 8-12 sectors, got ${sectors.size}: ${[...sectors].join(', ')}`);

for (const t of STARTER_TEMPLATES) {
  const where = `template "${t.id}"`;

  assert.ok(t.id && !seenIds.has(t.id), `${where}: id must be non-empty and unique`);
  seenIds.add(t.id);
  assert.ok(t.name.trim().length > 0, `${where}: name must be non-empty`);
  assert.ok(t.sector.trim().length > 0, `${where}: sector must be non-empty`);
  assert.ok(t.description.trim().length > 0, `${where}: description must be non-empty`);
  assert.match(t.color, /^#[0-9a-fA-F]{6}$/, `${where}: color must be a hex string`);

  assert.ok(
    t.tasks.length >= 8 && t.tasks.length <= 25,
    `${where}: expected 8-25 tasks, got ${t.tasks.length}`
  );

  let lastOffset = -Infinity;
  t.tasks.forEach((task, i) => {
    const twhere = `${where} task[${i}] "${task.title}"`;

    assert.ok(task.title.trim().length > 0, `${twhere}: title must be non-empty`);
    assert.ok(task.description.trim().length > 0, `${twhere}: description must be non-empty`);
    assert.ok(task.category.trim().length > 0, `${twhere}: category must be non-empty`);
    // No template language (plan §4) — titles must be literal, not interpolated.
    assert.ok(!/\{\{.*\}\}/.test(task.title), `${twhere}: title must not contain template interpolation`);
    // No pipeline_id / assignee_team_id — a starter can't know a company's boards or teams.
    assert.ok(!('pipeline_id' in task), `${twhere}: must not set pipeline_id`);
    assert.ok(!('assignee_team_id' in task), `${twhere}: must not set assignee_team_id`);

    assert.ok(VALID_PRIORITIES.has(task.priority), `${twhere}: invalid priority "${task.priority}"`);

    // Mirrors migrations/20260727_clamp_task_weight.sql: tasks_weight_1_10 CHECK (weight BETWEEN 1 AND 10).
    assert.ok(Number.isInteger(task.weight) && task.weight >= 1 && task.weight <= 10, `${twhere}: weight must be an integer 1-10, got ${task.weight}`);

    assert.ok(task.estimated_hours > 0, `${twhere}: estimated_hours must be positive, got ${task.estimated_hours}`);

    if (task.due_offset_days !== undefined) {
      assert.ok(Number.isInteger(task.due_offset_days) && task.due_offset_days >= 0, `${twhere}: due_offset_days must be a non-negative integer, got ${task.due_offset_days}`);
      // Not strictly monotonic (same-day tasks are legitimate), but the work
      // must not run visibly backwards — catches a copy-paste ordering bug.
      assert.ok(task.due_offset_days >= lastOffset - 0.001, `${twhere}: due_offset_days ${task.due_offset_days} runs before the previous task's ${lastOffset} — tasks must stay roughly chronological`);
      lastOffset = task.due_offset_days;
    }
  });
}

console.log(`starterTemplates: all checks passed (${STARTER_TEMPLATES.length} templates, ${sectors.size} sectors, ${STARTER_TEMPLATES.reduce((n, t) => n + t.tasks.length, 0)} tasks)`);
