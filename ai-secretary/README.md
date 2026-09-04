# AI Secretary — 自分専用のAI秘書/AI右腕

Claude(claude.aiのWeb・モバイル・デスクトップ、Claude Codeを含むすべて)を、
ユーザー個人の好み・価値観・仕事のスタイルを継続的に蓄積して理解する「AI秘書」に
変える仕組み。記憶は自前サーバーではなく **Google Driveの"AI Secretary"フォルダ**
に置かれたMarkdownノートとして保存されるため、Google Driveコネクタさえ有効なら
どのClaudeからでも同じ記憶を読み書きできる。Obsidianユーザーなら、同じフォルダを
vaultとして開けばObsidianアプリからも直接閲覧・編集できる。

## なぜこの構成か

最初はローカルのベクトルDB(MCPサーバー)案で作ったが、「claude.aiのWeb/モバイル
アプリも含め、あらゆるClaude利用で記憶を共有したい」という要望に対して、自前で
常時稼働のリモートMCPサーバー+OAuth認証+ホスティングを新たに用意するのは
過剰だと判断し、**既にAnthropicが提供しているGoogle Driveコネクタに乗る**方式に
作り替えた。サーバー運用・認証・課金が一切不要になる。

## 構成

```
ai-secretary/
├── research/market-research.md   # パーソナルAIアシスタント市場調査(2026年時点)
├── skills/ai-secretary/SKILL.md  # 「AI秘書」としてのふるまい方(Drive読み書き手順)を定義
└── install.sh                    # Claude Code用: スキルをユーザースコープにコピー
```

記憶そのものはこのリポジトリの外、あなたのGoogle Drive上に存在する:

```
AI Secretary/                  (Google Driveのマイドライブ直下)
├── README.md
├── memories/
│   ├── work_style/ hobbies/ food/ communication_style/ goals/
│   ├── relationships/ tools_and_tech/ schedule_patterns/
│   └── values/ dislikes/ general/
└── profile/
```

- 1事実=1ファイル(immutable)。Google Driveの書き込みツールはファイルの中身を
  後から編集できない(タイトル/移動のみ)ため、事実が変わったら新しいファイルを
  作る設計にしている。
- 取得(recall)は `search_files` のキーワード検索 + 検索結果に含まれる
  `contentSnippet`(ノートが短いため大抵は全文が返る)で完結させ、
  `read_file_content` は使わない設計にしている(理由は下記「わかったこと」参照)。

このセッションで実際に `vionet828@gmail.com` のGoogle Driveに上記フォルダ構造を
作成済み: https://drive.google.com/drive/folders/12JihAZsraHzANWUn0yG_YwNLpdD5DIp6

## セットアップ

1. **Google Driveコネクタ**: claude.ai > Settings > Connectors > Google Drive
   を有効化(既に有効な場合は不要)。
2. **Claude Code用スキル**:
   ```bash
   ./install.sh
   ```
   `~/.claude/skills/ai-secretary` にスキルをコピーするだけ。サーバー登録は不要。
3. **(任意) Obsidianとの連携**: Google Drive for desktopをインストールし、
   ローカルにミラーされた `AI Secretary` フォルダをObsidian vaultのルートとして
   開く。これでObsidianアプリからも同じメモを直接編集できる。

## 使い方

セットアップ後は、どのClaude(claude.aiでもClaude Codeでも)でも:

- 「覚えておいて: 私は朝型で午前中に集中したい」→ `memories/work_style/` に
  1ファイル作成される
- おすすめ・計画・優先順位付けなど好みが関わる質問 → 事前に関連メモを検索して
  踏まえた上で回答する
- 「私について何を知ってる?」→ 各カテゴリを検索して要約する

## 実装時にわかったこと(Google Driveツールの制約)

- `create_file` はデフォルトでプレーンテキストをGoogleドキュメントに変換する。
  `.md`ファイルのまま残すには `contentMimeType: 'text/markdown'` と
  `disableConversionToGoogleType: true` を必ず指定する必要がある(実際にREADME.md
  を作成して `mimeType: "text/markdown"` のまま保存されることを確認済み)。
- `update_file` はタイトルとフォルダ移動のみ対応で、**ファイル内容の更新はできない**。
  → 「1事実=1ファイルのimmutable設計」はこの制約から導いた。
- `read_file_content` がサポートするMIMEタイプにMarkdown/プレーンテキストは
  **含まれておらず**、`.md`ファイルに対しては空文字が返ることを実機で確認した。
  → 内容取得は `read_file_content` ではなく、`search_files` が返す
  `contentSnippet`(ノートが短ければ全文相当が返る)で代替する設計にした。
  `fullText contains 'キーワード'` で検索して動作することも確認済み。

## 今後の拡張余地

- `research/market-research.md` にある通り、業界的にはベクトル検索から
  「ベクトル+ナレッジグラフ」のハイブリッドへの移行が進んでいる。Drive検索は
  意味検索ではなくキーワード検索なので、将来的に精度を上げたくなった場合は、
  ローカル(Claude Code側)でのみ軽量な埋め込み検索を補助的に使う、といった
  拡張の余地を残している。
- `profile/` フォルダは現状空。メモが増えてきたら、カテゴリごとの要約を
  Claudeに作らせて置く運用にすると、recall時の検索回数を減らせる。
