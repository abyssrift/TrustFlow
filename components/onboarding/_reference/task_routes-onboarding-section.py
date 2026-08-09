    @router.get("/onboarding")
    async def get_tasks_onboarding(request: Request):
        user = _owner(request)
        prefs = _load_for_user(user) or {}
        return {
            "opened": bool(prefs.get("tasks_opened")),
            "enabled": bool(prefs.get("tasks_enabled")),
        }

    @router.post("/onboarding")
    async def update_tasks_onboarding(request: Request, body: dict):
        user = _owner(request)
        prefs = _load_for_user(user) or {}
        prefs["tasks_opened"] = True
        enable = bool(body.get("enabled"))
        if enable:
            prefs["tasks_enabled"] = True
        _save_for_user(user, prefs)
        if user:
            await task_scheduler.ensure_defaults(user)

        resumed = 0
        if enable:
            db = SessionLocal()
            try:
                tasks = db.query(ScheduledTask).filter(
                    ScheduledTask.owner == user,
                    ScheduledTask.task_type == "action",
                    ScheduledTask.action.in_(list(HOUSEKEEPING_DEFAULTS.keys())),
                ).all()
                for task in tasks:
                    defs = HOUSEKEEPING_DEFAULTS.get(task.action or "")
                    if defs and defs.get("ship_paused"):
                        continue
                    if task.status == "active":
                        continue
                    task.status = "active"