-- task_submissions.assignment_id: drop NOT NULL constraint.
-- Submissions can exist without a direct assignment link — e.g. manager/owner
-- submissions and inherited copies written to child tasks during subpipeline spawn.
ALTER TABLE public.task_submissions ALTER COLUMN assignment_id DROP NOT NULL;
