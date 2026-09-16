# ZEN Report Exporter

ZEN Study（必修授業）の確認テスト・レポートについて、問題文・自分の回答・解説を取得し、Markdown化・Notionアップロードするためのアプリです。

## 前提

- Node.js v20以上
- ZEN Studyのアカウント（N高グループの高校メールアドレス）
- Notion連携を使う場合のみ: Notionのコネクトとアップロード先ページ

## 初期設定

```bash
cd project
npm install
```

`postinstall` でPlaywrightのChromiumも自動取得します。取得に失敗した場合は以下を手動実行します。

```bash
npx playwright install chromium
```

### 1. 環境変数

`.env.example` を参考に `.env` を作成します。

```bash
GMAIL="高校メールアドレス"
GPASSWORD="パスワード"
NOTION_API_KEY="Notionコネクトのトークン"
NOTION_PARENT_PAGE_ID="アップロード先ページのID（URL末尾32桁）"
```

Notionを使わない場合は `GMAIL` / `GPASSWORD` のみで動作します。

### 2. ログイン（クッキー取得）

```bash
npm run login
```

成功すると `project/cookie.txt` が更新されます。有効期限は約2週間です。
2段階認証がある場合は以下でブラウザを表示して手動で進めます。

```bash
npm run login:headed
```

### 3. Notion連携（使う場合のみ）

1. `https://www.notion.so/my-integrations` でInternalコネクトを作成し、ContentのRead / Insertを許可する
2. 表示されるトークンを `NOTION_API_KEY` に設定する
3. アップロード先ページを開き、右上 `•••` →「コネクトを追加」から作成したコネクトを招待する
4. ページURL末尾の32桁を `NOTION_PARENT_PAGE_ID` に設定する

## 起動方法

```bash
npm run dev:all
```

| 用途 | URL |
|---|---|
| React画面 | http://localhost:5173 |
| API | http://localhost:8787 |

その他のコマンドは以下です。

| コマンド | 用途 |
|---|---|
| `npm run dev` | Reactのみ起動 |
| `npm run server` | APIのみ起動 |
| `npm run build` → `npm run start` | 本番ビルドと配信 |
| `npm run login` | 再ログイン |

## 使い方

1. **受講コースの選択**: プルダウンから対象コースを選びます
2. **チャプター範囲の選択**: From / Toで範囲適用、またはチェックボックスで個別選択します
3. **サブミット**: 「Markdownを出力」を押します。プレースホルダーや警告が表示される場合があります
4. **出力**: テキストエリアで確認し、コピーまたは `.md` ダウンロードします
5. **Notionにアップロード**: ページタイトルを確認し、ボタンを押します。完了後に「Notionで開く」リンクが表示されます

## 出力形式

```markdown
# カテゴリー名
## チャプター名
### 教材名
1. 問題文

<br>

> ***回答***
> ```text
> 回答テキスト
> ```

<br>

> ***解説***
> ```text
> 解説テキスト
> ```
---
### 次の教材名
...
### レポート
#### レポート名
...
```

- 選択式の回答は番号から記号に変換します（1=ア、2=イ、3=ウ、4=エ）
- 各教材・各レポートの末尾に `---` が入ります
- 未完了の教材は `(未回答/結果なし)` の定型出力になります

## API一覧

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/health` | セッション・Notion設定の状態確認 |
| GET | `/api/courses` | 受講コース一覧 |
| GET | `/api/courses/:id/chapters` | 章一覧 |
| GET | `/api/courses/:courseId/chapters/:chapterId/materials` | テスト・レポート教材一覧 |
| POST | `/api/export` | Markdown生成（`{ courseId, chapterIds[] }`） |
| POST | `/api/notion/upload` | Notionへ新規ページとしてアップロード（`{ title, markdown }`） |

## トラブルシューティング

| 現象 | 原因と対応 |
|---|---|
| コース一覧が空 | クッキー失効。`npm run login` で再取得する |
| 結果ページなしの警告が多い | 未完了の章。完了済みの章のみ選択する |
| Notion連携が未設定と出る | `.env` の2変数を確認し、サーバーを再起動する |
| `object_not_found` | ページへのコネクト招待漏れ。対象ページの `•••` から追加する |
| `unauthorized` | トークンの不一致。`NOTION_API_KEY` を確認する |
| Google認証で止まる | 2段階認証の可能性。`npm run login:headed` で手動進行する |
# ZEN-Report-Exporter
