# ツール・MCPのメモ

## 繋ぎたいMCP

- **X (Twitter) の MCP**
- **Typefully の MCP** — Xのスレッド作成・下書き・予約投稿のサービス
- **Figma の MCP** — 公式の Dev Mode MCP server がある。コンポーネント構造
  (名前・バリアント・プロパティ)、変数とスタイル(色・余白・タイポグラフィの
  トークン)、レイヤーツリー、ノードのレンダリング画像を、スクショではなく
  機械可読な形でエージェントに渡す。Code Connect を設定してあれば、Figmaの
  コンポーネント→実際のコードのコンポーネントと import パスの対応まで読める。
  デスクトップ版サーバは有料プランの Dev/Full シートで利用可。将来は従量課金に
  なる予定で、ベータ期間中は無料
- **HyperFrames の MCP** — HeyGen の OSS。HTML/CSS/メディア/シーク可能な
  アニメーションを決定論的にMP4へレンダリングする。MCPは複数実装があり、
  HeyGen公式のホスト型コネクタ(HeyGenアカウント経由、CLI不要)のほか、CLIを
  MCPツールとして包んだもの、レンダリング基盤に繋ぐ有料のリモートMCPなど

用途としては、作ったもの(レンダリング画像やプロトタイプ)を動画にして、Xに
出すところまでセッション内で完結させる想定。Figmaは逆向きで、デザインを
入力としてコードやシーンに持ち込む側。

この組み合わせだと Figma(入力) → 実装 → HyperFrames(動画化) → Typefully/X
(公開) が一本の線になる。

### 現状 (2026-09-18 時点)

このリポジトリには MCP の設定が無い。`.mcp.json` は存在せず、`~/.claude.json`
の `mcpServers` も空。今セッションに来ていた MCP は全部クラウド側のハーネスが
挿しているもので、内訳は GitHub / Gmail / Google Calendar / Google Drive /
Claude Docs / Claude Code Remote。**XもTypefullyも繋がっていない。**

### 繋ぐときに決めること

- サーバの実体(パッケージ名・コマンド)と、提供されるツール —— 未調査
- 認証。XのAPIは有料プランによって投稿権限が変わるので、そこが実質の制約に
  なりやすい。Typefully は API キー方式
- 置き場所: リポジトリ共有なら `.mcp.json`、個人利用なら claude.ai 側の
  コネクタ設定かユーザ設定

XとTypefullyについてはサーバの実体と認証を確認していないので、繋ぐ前に実在と
権限を確かめること。FigmaとHyperFramesは公式のMCPがあることまでは確認済み
(2026-09-18)だが、このリポジトリでは未接続。

## 参考動画: MCP紹介まとめ (KEITO WEB&AI CH)

スクリーンショットから書き起こし。チャプター一覧の上部は見切れていて、
Gmail より前の項目は不明。URLとタイトルは未確認。

| 時刻 | 項目 |
|---|---|
| (見切れ) | Gmail MCP |
| 05:16 | Google カレンダー MCP |
| 06:27 | Google ドライブ MCP |
| 07:40 | Notion MCP |
| 09:39 | Obsidian・ファイルシステム MCP |
| 11:22 | Zoom MCP |
| 12:50 | X MCP |
| 14:45 | Typefully MCP |
| 16:27 | Figma MCP |
| 18:20 | Hyperframe MCP |
| 20:08 | fal MCP |
| 22:58 | Higgsfield MCP (スクショでは「Fiksfield」に見えたが、Higgsfield AI の画像・動画生成MCPと思われる。fal の直後という並びとも整合) |
| 24:17 | Cloudflare MCP |
| 26:56 | Vercel MCP |
| 27:43 | Playwright MCP |
| 28:56 | freee・マネーフォワード MCP |
| 31:12 | Zapier・Make MCP |
| 34:14 | **Blender MCP** |
| 35:32 | MCP運用の注意点・まとめ |

上で「繋ぎたい」と書いた X / Typefully / Figma / Hyperframe は、いずれもこの
動画で扱われている。

### Blender MCP (34:14) について

今回の縁側シーン制作で一番効いた制約が、これで解ける可能性がある。

今回は `blender --background --python` で毎回プロセスを起動して捨てていたので、
(1) シーンを毎回ゼロから組み直す (2) ビューポートが無いので確認は必ず
レンダリング、という2点が固定費だった。動いているBlenderに接続する型のMCPなら
セッションが永続するので、両方とも消える。

ただし前提として、GUI付きのBlenderが動いている必要がある。このクラウド
コンテナはヘッドレスなので、仮想ディスプレイ(xvfb)で動かせるかは未検証。
ローカルのBlenderに繋ぐ使い方なら素直に効くはず。

なお、MCPが無くても今回のループは40倍速くできた(Workbench 6.6秒 対 Cycles
4分)。速いループが欲しいときに、まずMCPを探すのは順番が違う。


## 調査: ClaudeでどのMCPが使えるか (2026-09-18 調べ)

「ClaudeとCodexで使えるものが違うらしい」という話の確認。

最初「サーバ単位で使えないものは無い、機能単位の問題だ」と書いたが、**それは
19個のうち5個しか確認せずに一般化した誤り**だった。実際には動かない事例が
いくつも報告されている。下の「動かない事例」を参照。

### Claude Code 側のMCP機能の穴 (ここが実質の制約)

- **Sampling 非対応**。サーバ側が「推論はクライアントのLLMにやらせる」設計
  (コストと制御をクライアントに委ねる型)だと動かない。これが一番はっきりした
  非対応項目
- **必須引数を持つ Prompts** が機能しない。サーバがPromptsに必須パラメータを
  定義していても Claude Code がユーザに入力を求めないため、呼び出しが
  タイムアウトして失敗する
- **Elicitation は Claude Code CLI では使えるが、Claude Desktop では使えない**
- Resources / Prompts 自体は一応使える(Promptsはスラッシュコマンド、Resources
  は @ メンションとして出る)が、実装に listResources / readResource /
  listPrompts / getPrompt / createMessage / elicit / listRoots が見当たらない
  という報告がある
- 動的更新が弱い。サーバが後から追加したスラッシュコマンドは再起動しないと
  出てこないし、動的に増えたResourcesは @ の補完に出ない

注意: 上記のうち後半はGitHubのissue報告ベースなので、既に直っている可能性が
ある。実際に繋ぐときは現物で確かめること。

### Claude と Codex の違い (設定が互換でない)

- **設定ファイルが別物**。Claude Code / Claude Desktop は `.mcp.json` /
  `claude_desktop_config.json`、Codex は `~/.codex/config.toml`。片方の設定を
  そのまま持っていけない
- **OAuthの流れが違う**。Claude Code は初回利用時にインラインでOAuthが走る。
  Codex は登録と認証が分かれていて `codex mcp add` の後に
  `codex mcp login <name>` でブラウザが開く
- Codex CLI は**静的な clientId での OAuth に非対応**。事前登録済みのOAuth
  クライアントを使う組織だとここで詰まる
- 両方とも Dynamic Client Registration に直行するので、DCR非対応のサーバだと
  どちらでも問題が出る
- Codex には `/mcp verbose` という診断がある。Claude Code には無い

### 個別に確認できたこと

- **X**: 2026-06-30に公式のホスト型MCPが出ている (`https://api.x.com/mcp`、
  xdevplatform/xmcp)。**Claudeは明示的に対応クライアントに入っている**。
  X APIの200以上のエンドポイント(全文検索、トレンド、投稿操作、ブックマーク、
  長文Articlesの下書きと公開)。接続は無料だが**呼び出しは従量課金**で、
  投稿作成 $0.015 (URLを含むと $0.20)、投稿読み取り $0.005
- **Typefully**: 公式MCPあり (`https://mcp.typefully.com/mcp`)。**OAuthなので
  APIキー不要**。X / LinkedIn / Threads / Bluesky / Mastodon の下書き作成・
  編集・予約・スレッド対応
- **Figma**: Claude Code と Claude Desktop は対応クライアント。ただし
  **Figmaの MCP Catalog に載っているクライアントしか接続できない**という
  ゲートがあり、新規クライアントはwaitlist。有料プランの Dev/Full シートが
  必要。Claude Code については、Figmaは生のMCP設定よりも**プラグインの方を
  推奨**している(Agent Skills が同梱されるため)
- **HyperFrames**: HeyGen公式のホスト型コネクタが「対応AIチャット製品」向けに
  あるほか、CLIを包んだコミュニティ実装、レンダリング基盤に繋ぐ有料リモート
  MCPがある
- **Higgsfield**: Claude / Cursor / その他MCPクライアントで動くとされている
- **Blender**: ahujasid/blender-mcp。もともとClaude Desktop前提で作られている。
  要件は Blender 3.0以上 / Python 3.10以上 / uv、そして**GUIで動いているBlender
  にアドオンを入れる**こと。クライアントは1つだけ動かす(CursorとClaude Desktop
  を同時に繋がない)

### この環境(クラウドのヘッドレスコンテナ)での可否

Blender MCP は**ここでは使えない**。クライアント側の問題ではなく、GUIで動いて
いるBlenderにアドオンを入れて接続する仕組みなので、ディスプレイの無いコンテナ
には繋ぐ相手がいない。ローカルのMacなどで動かすなら素直に使えるはず。


## 動かない事例 (サーバ単位で実際に詰まるもの)

前節で「機能単位の問題」と書いたのは調べ足りなかった。以下は実際に報告が
あるもの。

### 1. ローカルMCPサーバ × Claude Desktop のコネクタ = 原理的に不可

**Claude Desktop のコネクタは Anthropic のクラウド側から接続しに行く**ので、
`127.0.0.1` のアドレスはそもそも到達できない。ローカルで立つタイプのMCPは
Desktopのコネクタとしては動かない。

これに該当するのが **Figma のローカルサーバ**(デスクトップアプリが起動時に
ポート3845で勝手に立てるもの)。Figma側も**リモートの
`https://mcp.figma.com/mcp` を使うことを推奨**している。

### 2. Figma ローカルサーバ × Claude Code = 接続失敗の報告多数

anthropics/claude-code の issue #5125、Figmaフォーラムに複数スレッド。
Figmaデスクトップアプリが立てるポート3845のローカルサーバが**Claude Codeの
設定に勝手に登録され、リモートサーバと競合して `use_figma` が読み込まれなく
なる**。しかもそれがユーザから見て分からない挙動になっている。
他に403認証エラー、「Session activity: Not sent」でセッションが張られない、
`No result received from client-side tool execution` などの報告。

### 3. Cowork / Code の共有プールセッションでの失敗

- Desktop Commander MCP が `Version negotiation failed` で落ちる
  (anthropics/claude-code issue #94466)
- Cowork desktop で **MCP elicitation が print-mode の分岐で落とされ、ツール
  呼び出しが180秒ハングする** (anthropics/claude-ai-mcp issue #1046)

Coworkはコード実行が隔離VMで走る設計なので、その前提で作られていないMCP
サーバは相性問題を起こす。

### 4. Sampling を使うサーバ

Claude Code が Sampling 非対応なので、これに依存する設計のサーバは動かない。

### 5. Blender MCP × このコンテナ

GUIで動いているBlenderにアドオン経由で繋ぐ仕組みなので、ディスプレイの無い
環境では繋ぐ相手がいない。

### まとめ方

「Claudeで使えるか」は**サーバ単体では決まらない**。効いてくるのは
**(a) サーバがローカルに立つかリモートか**、**(b) クライアントがローカルで
動いているか(Claude Code CLI)クラウドから接続しに行くか(Desktopコネクタ)**、
**(c) 隔離VMかどうか(Cowork)** の組み合わせ。

ローカルサーバはローカルで動くクライアントとしか繋がらない、が基本則。


## 動画の18個: Claudeで接続できるか (2026-09-18 調べ)

| # | MCP | Claude | 形態 / 備考 |
|---|---|---|---|
| 1 | Gmail | ○ | このセッションで実際に接続されている |
| 2 | Googleカレンダー | ○ | 同上 |
| 3 | Googleドライブ | ○ | 同上 |
| 4 | Notion | ○ (未個別確認) | 定番だが公式の明示を拾えず |
| 5 | Obsidian・ファイルシステム | △ | ローカルstdio型。Desktopコネクタ不可、Claude Code CLIなら可 |
| 6 | Zoom | ○ | 公式リモート `mcp.zoom.us/mcp/zoom/streamable`。Desktop / Code(CLI) / Cowork に追加可 |
| 7 | X | ○ | 公式 `api.x.com/mcp`。Claude明記。**従量課金**(投稿$0.015、URL付き$0.20、読取$0.005) |
| 8 | Typefully | ○ | 公式 `mcp.typefully.com/mcp`。OAuth、APIキー不要 |
| 9 | Figma | △ | **リモート `mcp.figma.com/mcp` を使うこと**。ローカル(3845)は不具合多数。有料Dev/Fullシート必須、カタログ掲載クライアントのみ |
| 10 | Hyperframe | ○ | HeyGen公式ホスト型コネクタ + コミュニティ実装 |
| 11 | fal | ○ | 公式 `mcp.fal.ai/mcp`。`claude mcp add --transport http fal-ai ... --header "Authorization: Bearer <KEY>"` |
| 12 | Higgsfield | ○ | Claude / Cursor / 任意のMCPクライアント |
| 13 | Cloudflare | ○ | 公式のマネージドリモートMCP群、OAuthでClaudeから接続 |
| 14 | Vercel | ○ | 公式 `claude mcp add --transport http vercel https://mcp.vercel.com` |
| 15 | Playwright | ○ (未個別確認) | Microsoft製、ローカルstdio型 |
| 16 | freee | ○ | OSS公式。**Claude Codeはプラグイン導入でAgent Skills同梱** |
| 17 | マネーフォワード | ○ | 公式リモートMCP(2026-03-26 β、全プラン)。環境構築不要 |
| 18 | Zapier | ○ | 公式 `claude mcp add --transport http "Zapier-MCP" https://mcp.zapier.com/api/v1/connect` |
| 18b | Make | ? | 検索で拾えず。要確認 |
| 19 | Blender | △ | Claude Desktop向けに作られている。ただし**GUIで動くBlenderが必要**。ヘッドレス環境では不可 |

**結論: サーバ単位で「Claudeでは無理」というものは無い。** ただし△の4つ
(Obsidian/ファイルシステム、Figma、Blender、およびローカル型全般)は
「どのClaudeか」で可否が変わる。ローカルに立つサーバは、ローカルで動く
クライアント(Claude Code CLI)としか繋がらない。Claude Desktopのコネクタは
クラウドから接続しに行くので `127.0.0.1` に届かない。

なお18個全部を同時に繋ぐ話は別問題。ツール定義がコンテキストを食うので
(4サーバで67,000トークンの報告あり)、実用上は5〜6個で3〜5割が埋まる。
ツール定義がコンテキストの10%を超えるとClaude Codeが自動でTool Searchモードに
切り替わり、全定義の先読みをやめる(51K→8.5K、46.9%削減の報告)。
