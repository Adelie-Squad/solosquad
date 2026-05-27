# Bot Health Check (v1.1 schedule)

> 매일 1회 실행. 4 main bot + 20 specialist + N skill 의 health 상태 점검.

## 점검 항목

1. **각 bot 의 daily budget 잔여** — `agent-profile.yaml` 의 max_daily_usd 대비
2. **메신저 연결** — Discord/Slack adapter ready 상태
3. **session-store** — Chief session 의 last_active timestamp (24h 초과 시 alert)
4. **migration drift** — `workspace.yaml.version` 이 최신 1.1.0 인지
5. **bundle integrity** — `agents/`, `skills/`, `teams/` 디렉토리 + 핵심 SKILL.md 존재
6. **skill HARD GATE 실패율** — 지난 24h trend (10% 이상 증가 시 yellow)

## 출력

```
status: green | yellow | red
checks:
  - name: "agent_budget"
    status: green | yellow | red
    details: "founder: $0.42 / $5.00 used (8%)"
  - ...
alerts: [...]
```

red 상태 1건 이상 → Chief 가 `#owner-command` 에 즉시 알림.

## Reference

- v1.1 PRD §12.2
