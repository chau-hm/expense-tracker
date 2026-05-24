# Expense Tracker

Agent-native expense tracker，主介面預設係聊天 / slash command，而唔係傳統 web app。MVP 以 TypeScript CLI 做核心，方便 OpenClaw、Telegram 或其他 agent runtime 呼叫。

## 現況

已實作：

- event 建立、結算、摘要、匯出
- shared expense 平均分帳
- item list/search/edit/delete/restore
- chat intake Phase 2：自然語言 draft、correction、item list/search、item edit/delete/restore、event summary/settlement
- SQLite persistence
- 本地 receipt image storage skeleton
- receipt OCR ingest、draft review、confirm 入帳
- Telegram/OpenClaw receipt image helper：`media://inbound/...` -> ingest -> draft
- OpenClaw wrapper：`expense-openclaw`
- workspace skill：`expense`

未實作：

- fully interactive receipt review UI
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
  --type shared \
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

個人支出只計入 totals/category totals，不會產生 settlement：

```bash
expense-tracker expense add \
  --event "Daily Expenses" \
  --type personal \
  --amount-minor 18600 \
  --category food
```

幫人先付嘅個人支出會產生直接還款：

```bash
expense-tracker expense add \
  --event "Japan Trip" \
  --type fronted-personal \
  --paid-by A \
  --beneficiary B \
  --amount-minor 3000 \
  --category souvenir
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

### 自然語言用法

在 OpenClaw / Telegram 入面，可以用自然語言查數、改 draft、管理 items、睇 summary/settlement。wrapper 會先判斷 intent，再 route 去 deterministic CLI/domain；LLM/agent 只負責理解語句，最後金額、target resolution、settlement 都由 CLI/domain 驗證。

#### 1. 新增 expense draft

例子：

```text
/expense 交通費，$5.8
```

自然語言新增支出會先產生 draft，不會即刻寫入 DB：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat parse --event "Daily Expenses" '交通費，$5.8'
```

draft 確認後，先執行生成出嚟嘅 deterministic `expense add`：

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

#### 2. 修正 draft 或已儲存 item

修正 draft：

```bash
draft=$(expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat parse --event "Daily Expenses" '交通費，$5.8' --format json)

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat correct '改做 $6' --draft-json "$draft"
```

修正已儲存 item 時，一定要 resolve 到單一 target 先會改 DB：

```text
/expense edit exp_daily_expenses_transport_xxx 改做 $6
/expense edit taxi 改做 $6
```

如果 `taxi` match 到多個 item，CLI 只會列 candidates，不會改 DB。

#### 3. List/search items

```text
/expense list
/expense list taxi
/expense search food
/expense 搵 taxi
```

等價 CLI：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat items 'list taxi' --event "Daily Expenses"
```

`list/search` 是 read-only，不會改 DB。文字內有 `taxi`、`transport`、`food`、`午餐` 等常見字眼時，會做簡單 category inference。

#### 4. Edit/delete/restore items

```text
/expense edit taxi 改做 $6
/expense edit exp_daily_expenses_transport_xxx category:transport
/expense delete taxi
/expense delete exp_daily_expenses_transport_xxx
/expense restore exp_daily_expenses_transport_xxx
```

安全規則：

- exact `exp_...` item id 可以直接 target。
- text target 會先 search candidates。
- edit/delete 只 search active items。
- restore 只 search deleted items。
- target missing 或 ambiguous 時，只回 clarification/candidates，不會 mutate DB。
- edit 無 supported correction patch 時，不會 mutate DB。

#### 5. Event summary / settlement

```text
/expense summary Trip
/expense settle Trip
/expense settlement "Japan Trip"
```

等價 CLI：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat event 'summary Trip'

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat event 'settle Trip'
```

summary 會顯示 event status、participants、active item count、currency totals、category totals、settlement。settlement 會按 currency group transfers；無數要夾會顯示 `No settlement needed`。

#### 6. Receipt OCR / draft / confirm

收到 receipt image 後，agent 可以用 workspace helper 由 OpenClaw media ref 直接 ingest：

```bash
/Users/openclaw/.openclaw/workspace/skills/expense/scripts/ingest-receipt-image.sh \
  --event "Japan Trip" \
  media://inbound/<file>.jpg
```

helper 會：

- resolve `media://inbound/<file>.jpg` 到 `/Users/openclaw/.openclaw/media/inbound/<file>.jpg`
- 呼叫 `expense-openclaw receipt ingest`
- 儲存 receipt image metadata / raw OCR / parser draft
- 即刻輸出 `receipt draft`

手動 CLI 等價流程：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt ingest /path/to/receipt.jpg --event "Japan Trip"

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt draft rcp_id

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt confirm rcp_id --items "ramen=90.00;tea=12.00" --paid-by A --shared-by A,B,C

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt confirm rcp_id --use-total --description "dinner receipt" --paid-by A --shared-by A,B,C
```

安全規則：

- `receipt ingest` 必須指定 event，因為 OCR language preferences 由 event 決定。
- `receipt confirm` 對新 receipt 會使用 stored `eventId`，不需要再傳 `--event`。
- 如果手動傳入不同 event，CLI 會拒絕，避免 receipt 入錯 event。
- raw OCR metadata 不會因 confirm/edit item 而被覆寫；已入帳 item 可用一般 `item edit/delete/restore` 管理。

如果缺少會影響入帳正確性的資料，agent 應該先追問，不應該亂入帳。通常需要追問嘅情況：

- 未能確定 event，而且最近語境亦唔清楚
- 金額或幣種有歧義
- 付款人或分帳對象唔清楚，而且唔應該套用 `self`
- category 無法合理判斷，而又不適合用 `general`
- edit/delete/restore target 有多個 candidates
- receipt draft 有低信心 warning、item 名/金額明顯錯、或者需要決定用 item breakdown 定 total 入帳

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
- `docs/specs/event-ocr-language-preferences.md`
- `docs/specs/openclaw-wrapper.md`
- `docs/specs/chat-intake.md`

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

receipt OCR 使用本機 Apple Vision adapter。收到 Telegram/OpenClaw receipt image 時，可先把 `media://inbound/<file>.jpg` 交給 workspace skill helper ingest，再用 `receipt draft` / `receipt confirm` 做確認入帳。
