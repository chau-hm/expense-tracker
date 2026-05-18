# Expense Tracker

Agent-native expense tracker，主介面預設係聊天 / slash command，而唔係傳統 web app。MVP 以 TypeScript CLI 做核心，方便 OpenClaw、Telegram 或其他 agent runtime 呼叫。

## 現況

已實作：

- event 建立、結算、摘要、匯出
- shared expense 平均分帳
- item list/search/edit/delete/restore
- SQLite persistence
- 本地 receipt image storage skeleton
- OpenClaw wrapper：`expense-openclaw`
- workspace skill：`expense`

未實作：

- receipt OCR
- receipt OCR 結果轉成 expense draft
- Telegram native command menu 重啟後驗證
- standalone web UI

## 核心規則

- 每個 currency 獨立結算，不做 FX conversion。
- 預設 participant 是使用者自己：`self`。
- 金額使用 minor units，例如 HKD 12.34 寫成 `1234`。
- item delete 是 soft delete，預設不參與 settlement，但可以 restore。
- edit/delete/restore 前應先 list/search，除非已知 exact item id。
- LLM/agent 只負責理解使用者意圖；最終金額、結算、驗證必須經 domain/CLI。

## 開發

```bash
npm install
npm test
npm run build
```

本地連結 CLI：

```bash
npm link
```

連結後會有兩個 binary：

```bash
expense-tracker
expense-openclaw
```

## CLI 快速開始

建 event：

```bash
expense-tracker event create "Japan Trip" --people A,B --format json
```

未指定 `--currency` 時，event default currency 係 `HKD`。如要改：

```bash
expense-tracker event create "Japan Trip" --currency JPY --people A,B
```

加入 expense：

```bash
expense-tracker expense add \
  --event "Japan Trip" \
  --paid-by A \
  --currency HKD \
  --amount-minor 240000 \
  --shared-by A,B \
  --category hotel \
  --description "Tokyo hotel" \
  --format json
```

快速個人入帳可以省略 payer、share-by、currency、category；預設係 `self` / event currency / `general`：

```bash
expense-tracker expense add --event "Daily Expenses" --amount-minor 580
```

睇摘要：

```bash
expense-tracker event summary "Japan Trip"
```

睇結算：

```bash
expense-tracker event settle "Japan Trip"
```

匯出 JSON：

```bash
expense-tracker event export "Japan Trip"
```

## Item 管理

列出 active items：

```bash
expense-tracker item list --event "Japan Trip"
```

搜尋：

```bash
expense-tracker item search --event "Japan Trip" --text hotel
```

修改：

```bash
expense-tracker item edit exp_id --amount-minor 12300 --description "updated"
```

刪除 / 還原：

```bash
expense-tracker item delete exp_id
expense-tracker item restore exp_id
```

## OpenClaw / Telegram

OpenClaw wrapper 會接受 `/expense` 或 `expense` prefix，然後轉交 core CLI：

```bash
expense-openclaw /expense event create "Japan Trip" --people A,B
expense-openclaw /expense event summary "Japan Trip"
```

建議聊天用 production DB：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite /expense event summary "Japan Trip"
```

### 自然語言輸入

在 OpenClaw / Telegram 入面，可以用自然語言講 expense。Agent 會先理解內容，再轉成 deterministic CLI arguments 執行；CLI/domain 仍然負責最終驗證和入帳。

例子：

```text
/expense 交通費，$5.8
```

如果最近語境係 `Daily Expenses`，agent 可以轉成：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense expense add \
  --event "Daily Expenses" \
  --amount-minor 580 \
  --category transport \
  --description "交通費"
```

常見自然語言轉換：

- `HKD 186` / `$186` 轉成 `--amount-minor 18600`
- `交通費` 轉成 `--category transport`
- `食飯` / `午餐` / `晚餐` 轉成 `--category food`
- 無指定 `--paid-by` 時預設 `self`
- 無指定 `--shared-by` 時預設 `self`
- 無指定 currency 時使用 event default currency；event default 未指定時係 `HKD`

如果缺少會影響入帳正確性的資料，agent 應該先追問，不應該亂入帳。通常需要追問嘅情況：

- 未能確定 event，而且最近語境亦唔清楚
- 金額或幣種有歧義
- 付款人或分帳對象唔清楚，而且唔應該套用 `self`
- category 無法合理判斷，而又不適合用 `general`

Telegram native slash command menu 需要 gateway startup 時註冊。restart gateway 前先跑：

```bash
./scripts/openclaw-expense-preflight.sh
```

preflight 通過、而且 operator 在場先做：

```bash
openclaw gateway restart
```

更多 rollout 步驟見：

- `docs/openclaw-telegram-rollout.md`

## 專案文件

主要 spec slices：

- `docs/specs/domain-settlement.md`
- `docs/specs/item-management.md`
- `docs/specs/persistence-schema.md`
- `docs/specs/cli-core.md`
- `docs/specs/cli-items.md`
- `docs/specs/event-summary.md`
- `docs/specs/event-export.md`
- `docs/specs/receipt-storage.md`
- `docs/specs/openclaw-wrapper.md`

產品/架構文件放在 Obsidian vault：

- `/Users/openclaw/Desktop/VirtualBuddyShared/Vault/side projects/expense tracker`

## 工程流程

此 repo 強制 SDD + TDD：

1. 先寫或更新 spec slice。
2. 寫 failing tests。
3. 實作最小改動。
4. 跑測試和 build。
5. 行為有變就更新文件。

完成標準：

```bash
npm test
npm run build
```

## 注意

receipt OCR 未接好。收到 receipt image 時，目前只能先儲存 metadata / image skeleton，或者請使用者手動輸入 item details。
