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

### 自然語言完整 Lifecycle

以下例子係日常推薦用法：使用者用 Telegram / OpenClaw 直接講低支出，agent 只負責理解意圖；真正入帳、修改、刪除、summary、settlement 都交返 deterministic CLI/domain 做驗證。

#### 1. Create Event

先開一個多人、多幣種 event：

```text
/expense event create "澳門週末" --currency HKD --currencies HKD,MOP --people self,Alice,Bob
或者
/expense 開新event "澳門週末"，預設用港幣，可以用港幣/葡幣，參加者，自己/Alice/Bob
```

`--currency` 是預設入帳 currency；`--currencies` 是 event 支援 currency list，用於 settlement 分組同 receipt OCR language context。未指定 `--currency` 時，event default currency 係 `HKD`。未指定 people 時會先加入 `self`，之後新增 expense 時會自動把 payer / shared participant / owner / beneficiary 加入 event membership。

#### 2. Add Shared Expenses

```text
/expense 澳門週末 船飛 HKD 525 self paid，self Alice Bob share
或者
/expense 澳門週末，船飛 525，all share

/expense 澳門週末 酒店 MOP 1680 Alice paid，三個人夾

/expense 澳門週末 晚飯 HKD 936 Bob paid all share

/expense 澳門週末 的士 HKD 120 self paid Alice Bob share
```

以上每句都會先經自然語言解析成 draft，再由 deterministic command 寫入 DB。常見轉換：

- `HKD 186` / `$186` -> `--amount-minor 18600`
- `交通費` -> `--category transport`
- `食飯` / `午餐` / `晚餐` -> `--category food`
- `三個人夾` / `all share` -> event participants 一齊分
- `self paid` / `Alice paid` -> `--paid-by`
- 無指定 payer 時預設 `self`，或者由 wrapper context 傳入
- 無指定 shared participants 時，如果 event 多於一人，預設 event participants 全部一齊分；單人 event 先預設 `self`
- 無指定 currency 時使用 event default currency

對應 deterministic flow：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense chat parse --event "澳門週末" '船飛 HKD 540 self paid，self Alice Bob share'

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense expense add \
  --event "澳門週末" \
  --paid-by self \
  --currency HKD \
  --amount-minor 54000 \
  --shared-by self,Alice,Mary \
  --category transport \
  --description "船飛"
```

#### 3. Add Personal / Fronted Personal Expense

個人支出只計入 totals/category totals，不會產生 settlement：

```text
/expense 澳門週末 self personal coffee HKD 42
```

幫人先付嘅個人支出會產生直接還款：

```text
/expense 澳門週末 Alice paid MOP 88 for Bob 手信 fronted personal
```

CLI 對照：

```bash
expense-tracker expense add \
  --event "澳門週末" \
  --type personal \
  --owner self \
  --currency HKD \
  --amount-minor 4200 \
  --category food \
  --description "coffee"

expense-tracker expense add \
  --event "澳門週末" \
  --type fronted-personal \
  --paid-by Alice \
  --beneficiary Bob \
  --currency MOP \
  --amount-minor 8800 \
  --category souvenir \
  --description "手信"
```

多人成本、payer、shared participants、personal/fronted-personal 呢類會影響結算責任嘅資料，日常可以由 agent 轉成 deterministic command；資料唔清楚時應先追問。

#### 4. Review Event And Items

```text
/expense event list
/expense event detail "澳門週末"
/expense list 澳門週末
/expense search 澳門週末 酒店
```

`event list/detail` 用嚟確認 event metadata；`list/search` 用嚟搵 stable item id 或檢查候選 target。呢啲 read-only command 不會改 DB。

#### 5. Correct / Edit / Delete / Restore

修正最近 draft：

```text
/expense 改做 $6
```

管理已儲存 item：

```text
/expense edit exp_macau_weekend_taxi_xxx 改做 HKD 132
/expense edit 的士 改做 HKD 132
/expense delete coffee
/expense restore exp_macau_weekend_coffee_xxx
```

安全規則：

- exact `exp_...` item id 可以直接 target。
- text target 會先 search candidates。
- edit/delete 只 search active items。
- restore 只 search deleted items。
- target missing 或 ambiguous 時，只回 clarification/candidates，不會 mutate DB。
- edit 無 supported correction patch 時，不會 mutate DB。

#### 6. Summary / Settlement / Export

```text
/expense summary 澳門週末

/expense settle 澳門週末

/expense export 澳門週末
```

`summary` 會顯示 event status、participants、active item count、currency totals、category totals、settlement。`settle` 只輸出結算建議，不會 mutate DB。`export` 用於 backup 或 agent handoff。

`summary` 亦會按 currency 輸出每位 participant 嘅 total，方便人工核對 settlement：

```text
Participant totals HKD:
- self: paid 68700 / share 52900 / net 15800
- Alice: paid 0 / share 54700 / net -54700
- Bob: paid 93600 / share 54700 / net 38900

Participant totals MOP:
- self: paid 0 / share 56000 / net -56000
- Alice: paid 176800 / share 56000 / net 120800
- Bob: paid 0 / share 64800 / net -64800
```

呢組例子應驗證到：

- `coffee` 被 delete 後不參與 settlement，但仍可 restore。
- HKD / MOP 分開結算，不做 FX conversion。
- `Ken paid MOP 88 for Mary 手信 fronted personal` 會保留 direct repayment：Bob -> Alice MOP 88。
- shared expense 會按各自 currency group 計算 balances。

#### 7. Receipt OCR / Draft / Confirm

收到 receipt image 後，agent 可以用 workspace helper 由 OpenClaw media ref 直接 ingest：

```bash
/Users/openclaw/.openclaw/workspace/skills/expense/scripts/ingest-receipt-image.sh \
  --event "澳門週末" \
  media://inbound/<file>.jpg
```

helper 會 resolve `media://inbound/<file>.jpg`、呼叫 `expense-openclaw receipt ingest`、儲存 receipt image metadata / raw OCR / parser draft，然後輸出 `receipt draft`。

手動 CLI 等價流程：

```bash
expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt ingest /path/to/receipt.jpg --event "澳門週末"

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt draft rcp_id

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt confirm rcp_id --items "minchi=90.00;tea=12.00" --paid-by 阿文 --shared-by 阿文,Ken,Mary

expense-openclaw --db /Users/openclaw/.expense-tracker/expense-tracker.sqlite \
  /expense receipt confirm rcp_id --use-total --description "dinner receipt" --paid-by 阿文 --shared-by 阿文,Ken,Mary
```

Receipt safety:

- `receipt ingest` 必須指定 event，因為 OCR language preferences 由 event 決定。
- `receipt confirm` 對新 receipt 會使用 stored `eventId`，不需要再傳 `--event`。
- 如果手動傳入不同 event，CLI 會拒絕，避免 receipt 入錯 event。
- raw OCR metadata 不會因 confirm/edit item 而被覆寫；已入帳 item 可用一般 `item edit/delete/restore` 管理。

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
