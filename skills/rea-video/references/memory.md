<!-- SoloSquad vendored copy: edited, see ../UPSTREAM.md -->
# 记住用户的纠正和偏好

- 用户指出某个镜头判错（"这是定格动画不是 AI"、"这段是我自己拍的素材"）：运行
  `rea-video correct out/ref --shots 3,5 --label stop_motion --note "<用户原话>"`（`--label` 填用户说的那一类，类别名见 `taxonomy.md`：定格动画是 `stop_motion`，静态图 + 推拉是 `still_motion`；也可用 `--start/--end` 指定时间段，`--shots all` 表示整条；真实素材用 `--real yes|no`）。
  这会立刻改结论和报告，并记入 `$REA_VIDEO_HOME/corrections.jsonl`（SoloSquad 把它设在工作区里）；以后拆同一个文件会自动套用，同类镜头会在复核任务里提示。
- 用户说出长期偏好：能对应参数的用 `rea-video prefs engine kling2.1`、`prefs vlm on`、`prefs env_file <路径>`、`prefs reviewer <名字>`。不要用 `prefs --note` 记自由文本（下次会原样回放给 agent）——长期偏好记在 SoloSquad 的 agent-profile / 知识里。
- 只记用户明确说的，不要把你自己的猜测写成纠正。纠正不会自动改分类权重；积累到几条以后，用 `rea-video memory --export-labels eval/user_labels.yaml` 导出成评测样本，再按开发约定评测、改规则（仓库 `docs/dev/evaluation.md`）。
