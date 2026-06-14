---
title: hermes-配置备用模型
created: 2026-05-12
updated: 2026-05-12
tags: []
summary: ""
---
```yaml
fallback_model:
  provider: dashscope
  model: qwen3.5-plus
```

- 写入全局 `~/.hermes/config.yaml` 的 `fallback_model` 字段
- 作用: MiniMax-M2.7（主模型） 不可用时自动切换到 Qwen3.5-plus

## aliyun Coding plan
API KEY：`sk-sp-8fac7181d0cf4cdc9643d9ba0d17b447`  
BASE_URL：`https://coding.dashscope.aliyuncs.com/v1`