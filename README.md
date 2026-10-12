# Project Time · 项目时间

一个「项目时间追踪 + 日程管理」的本地 Web 应用，接入 DeepSeek 大模型做智能日程。

## 功能

- **首页**：今天日期 + 当日日程（按时间从上到下文字排开）+ DeepSeek 生成的「今日预览」，右上角 ＋ 添加。
- **日历**：当前月份网格，点日期进入当天视图（与首页同布局）。
- **时间轴**：本周 7 条横向时间轴（横轴 0:00–24:00，纵轴周一→周日），事件以时间条显示（长度=时长、颜色=事件颜色、显示名称），点时间条进当天视图。
- **添加日程**：事件名称 / 时长 / 颜色（自动生成可换）/ 描述（可跳过）。
- **AI 自动导入**：输入一段文字，AI 智能解析成日程并加入时间轴。
- **AI 对话**：对话式增删查日程，实时更新时间轴。
- **本地数据库**：`data.json`（本地 JSON），可随仓库上传 GitHub。

## 运行

需要 Node.js（≥18）。依赖为零，只用内置模块。

```bash
node server.js
# 浏览器打开 http://localhost:3000
```

> 不要直接双击 `index.html` 打开——AI 功能需要本地服务器代理（API key 只存服务端，不下发到浏览器）。

## 配置

1. 把 DeepSeek key 写入 `.env`（已存在，已加入 `.gitignore`，**切勿提交到 GitHub**）：
   ```
   DEEPSEEK_API_KEY=sk-...
   ```
2. 本地数据库是 `data.json`（首次打开自动生成种子数据）。

## 文件结构

```
index.html      前端结构
styles.css      样式（Ink & Shadow 设计系统）
app.js          前端逻辑（视图 / 数据 / AI）
server.js       本地服务器（静态 + DeepSeek 代理 + JSON 数据库）
.env            DeepSeek key（不入库）
data.json       本地数据库（默认不入库，可手动上传）
skill-candidates/  备选设计 skill 库
.claude/skills/    已激活：design-system、calendar-design
```

## 已知限制

- **DeepSeek 无视觉模型**：图片导入目前是占位，仅支持文字导入。
- 时间轴事件过短（<30 分钟）时名称可能显示不全，悬停可看完整信息（tooltip）。
