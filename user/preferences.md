# Founder Preferences (v1.1)

> 운영 환경 / 도구 / 시간대 / 알림 등 일상 운영 선호. Chief 가 schedule 등록, 알림 시점, 도구 추천 시 참조.

## 시간대 & 일과

```yaml
timezone: ""              # 예: "Asia/Seoul"
work_hours:
  start: "09:00"
  end: "19:00"
deep_work_block:          # 방해 안 받고 싶은 시간대
  start: "10:00"
  end: "12:00"
notification_quiet_hours: # alert 안 보내는 시간
  start: "22:00"
  end: "08:00"
```

## 스케줄 선호

```yaml
morning_brief_time: "08:30"   # 사용자 timezone 기준
evening_brief_time: "18:00"
weekly_retro_day: "friday"
weekly_retro_time: "16:00"
```

## 도구 선호

```yaml
# Chief 가 추천하거나 자동 통합 시도할 때 참조
ide: "vscode"             # vscode / cursor / vim / etc.
git_host: "github"        # github / gitlab / gitea
ci: "github-actions"
deployment: "vercel"      # vercel / railway / fly / aws / etc.
db: "postgres"
analytics: "amplitude"    # amplitude / mixpanel / posthog / custom

# 새 도구 도입 시 Chief 의 default 추천 강도
new_tool_threshold: cautious | balanced | open
```

## 알림 채널

```yaml
primary_messenger: discord      # discord / slack
secondary_messenger: null

# 어떤 이벤트에 알림 받을지
alerts:
  workflow_complete: true
  goal_milestone: true
  budget_warning: true
  leading_indicator_red: true
  routine_log_summary: false
```

## 작성 가이드

- 첫 init 시 비워두면 default 사용
- 변경되면 schedule 자동 재계산 (cron 갱신)
- timezone 은 `solosquad init` 에서 입력한 값과 충돌 시 본 파일 우선
