# Expense Tracker

Agent-native expense tracker，主介面預設係 OpenClaw / Telegram 自然語言；TypeScript CLI 係 deterministic core，負責落 DB、驗證、結算同輸出。LLM/agent 只負責理解使用者意圖，不直接計數或改 balance。

## 核心規則

- 每個 currency 獨立結算，不做 FX conversion。
- 預設 participant 是使用者自己：`self`。
- 金額使用 minor units，例如 HKD 12.34 寫成 `1234`。
- item delete 是 soft delete，預設不參與 settlement，但可以 restore。
- edit/delete/restore 前應先 list/search，除非已知 exact item id。
- 最終金額、target resolution、settlement 都由 domain/CLI 驗證。

## OpenClaw / Telegram 用法

OpenClaw wrapper 接受 `/expense` 或 `expense` prefix。日常建議用 production DB：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite /expense summary "Japan Trip"
```

### 完整 Lifecycle

#### 1. Create Event

```text
/expense event create "Japan Trip" --currency JPY --people Alice,Bob
```

未指定 `--currency` 時，event default currency 係 `HKD`。未指定 people 時會先加入 `self`，之後新增 expense 時會自動把 payer / shared participant / owner / beneficiary 加入 event membership。

#### 2. Add Expense By Natural Language

```text
/expense 交通費，$5.8
/expense 食飯 HKD 186
/expense taxi $60
```

自然語言新增支出會先產生 draft；event 來自目前對話 context 或 `chat parse --event`。確認後先用 deterministic command 寫入 DB。常見轉換：

- `HKD 186` / `$186` -> `--amount-minor 18600`
- `交通費` -> `--category transport`
- `食飯` / `午餐` / `晚餐` -> `--category food`
- 無指定 payer 時預設 `self`，或者由 wrapper context 傳入
- 無指定 shared participants 時預設 `self`，或者由 wrapper context 傳入
- 無指定 currency 時使用 event default currency

對應 deterministic flow：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat parse --event "Japan Trip" '交通費，$5.8'

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense expense add \
  --event "Japan Trip" \
  --amount-minor 580 \
  --category transport \
  --description "交通費"
```

#### 3. Add Personal / Fronted Personal Expense

個人支出只計入 totals/category totals，不會產生 settlement：

```text
/expense Japan Trip personal lunch HKD 186
```

幫人先付嘅個人支出會產生直接還款：

```text
/expense Japan Trip Alice paid HKD 30 for Bob souvenir fronted personal
```

CLI 對照：

```bash
expense-tracker expense add \
  --event "Japan Trip" \
  --type personal \
  --amount-minor 18600 \
  --category food

expense-tracker expense add \
  --event "Japan Trip" \
  --type fronted-personal \
  --paid-by Alice \
  --beneficiary Bob \
  --amount-minor 3000 \
  --category souvenir
```

多人成本、payer、shared participants、personal/fronted-personal 呢類會影響結算責任嘅資料，日常可以由 agent 轉成 deterministic command；資料唔清楚時應先追問。

#### 4. Review Event And Items

```text
/expense event list
/expense event detail "Japan Trip"
/expense summary "Japan Trip"
/expense list "Japan Trip"
/expense search "Japan Trip" hotel
```

`summary` 會顯示 event status、participants、active item count、currency totals、category totals、settlement。`list/search` 是 read-only，不會改 DB。

#### 5. Correct / Edit / Delete / Restore

修正 draft：

```text
/expense 改做 $6
```

管理已儲存 item：

```text
/expense edit exp_japan_trip_transport_xxx 改做 $6
/expense edit taxi 改做 $6
/expense delete taxi
/expense restore exp_japan_trip_transport_xxx
```

安全規則：

- exact `exp_...` item id 可以直接 target。
- text target 會先 search candidates。
- edit/delete 只 search active items。
- restore 只 search deleted items。
- target missing 或 ambiguous 時，只回 clarification/candidates，不會 mutate DB。
- edit 無 supported correction patch 時，不會 mutate DB。

#### 6. Receipt OCR / Draft / Confirm

收到 receipt image 後，agent 可以用 workspace helper 由 OpenClaw media ref 直接 ingest：

```bash
/Users/openclaw/.openclaw/workspace/skills/expense/scripts/ingest-receipt-image.sh \
  --event "Japan Trip" \
  media://inbound/<file>.jpg
```

helper 會 resolve `media://inbound/<file>.jpg`、呼叫 `expense-openclaw receipt ingest`、儲存 receipt image metadata / raw OCR / parser draft，然後輸出 `receipt draft`。

手動 CLI 等價流程：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt ingest /path/to/receipt.jpg --event "Japan Trip"

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt draft rcp_id

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt confirm rcp_id --items "ramen=90.00;tea=12.00" --paid-by Alice --shared-by Alice,Bob

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt confirm rcp_id --use-total --description "dinner receipt" --paid-by Alice --shared-by Alice,Bob
```

Receipt safety:

- `receipt ingest` 必須指定 event，因為 OCR language preferences 由 event 決定。
- `receipt confirm` 對新 receipt 會使用 stored `eventId`，不需要再傳 `--event`。
- 如果手動傳入不同 event，CLI 會拒絕，避免 receipt 入錯 event。
- raw OCR metadata 不會因 confirm/edit item 而被覆寫；已入帳 item 可用一般 `item edit/delete/restore` 管理。

#### 7. Settlement And Export

```text
/expense settle "Japan Trip"
/expense settlement "Japan Trip"
/expense export "Japan Trip"
```

Settlement 會按 currency group transfers；無數要夾會顯示 `No settlement needed`。

## CLI Reference

安裝 dependencies 同 build：

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

### Event

```bash
expense-tracker event create "Japan Trip" --currency JPY --people Alice,Bob --format json
expense-tracker event list
expense-tracker event detail "Japan Trip"
expense-tracker event summary "Japan Trip"
expense-tracker event settle "Japan Trip"
expense-tracker event export "Japan Trip"
```

### Expense

```bash
expense-tracker expense add \
  --event "Japan Trip" \
  --type shared \
  --paid-by Alice \
  --currency HKD \
  --amount-minor 240000 \
  --shared-by Alice,Bob \
  --category hotel \
  --description "Tokyo hotel" \
  --format json
```

快速個人入帳可以省略 payer、shared participants、currency、category；預設係 `self` / event currency / `general`：

```bash
expense-tracker expense add --event "Daily Expenses" --amount-minor 580
```

### Items

```bash
expense-tracker item list --event "Japan Trip"
expense-tracker item search --event "Japan Trip" --text hotel
expense-tracker item edit exp_id --amount-minor 12300 --description "updated"
expense-tracker item delete exp_id
expense-tracker item restore exp_id
```

### Chat Intent Commands

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat parse --event "Daily Expenses" '交通費，$5.8'

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat correct '改做 $6' --draft-json "$draft"

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat items 'list taxi' --event "Daily Expenses"

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat event 'summary Japan Trip'

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat event 'settle Japan Trip'
```

## Operator Notes

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

更多 rollout 步驟見 `docs/openclaw-telegram-rollout.md`。

## 專案文件

主要 spec slices：

- `docs/specs/domain-settlement.md`
- `docs/specs/item-management.md`
- `docs/specs/persistence-schema.md`
- `docs/specs/cli-core.md`
- `docs/specs/cli-items.md`
- `docs/specs/event-summary.md`
- `docs/specs/event-export.md`
- `docs/specs/event-review.md`
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
