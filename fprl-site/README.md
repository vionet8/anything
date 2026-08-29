# FPRL理論編サイト

このサイトは `theory.md` を読み込んで表示するだけの、素朴な静的サイトです。
ビルド作業は不要。`theory.md` を編集して保存するだけで、サイトの内容が変わります。

## 構成

```
index.html   ページの骨格・トップの図解（編集頻度は低い）
style.css    見た目（編集頻度は低い）
script.js    theory.mdを読み込んで表示するスクリプト（触らなくてOK）
theory.md    ★本文はここだけ編集すればいい
```

## 編集方法（人間・AIどちらでも）

1. `theory.md` を開く（普通のMarkdownファイルです）
2. 内容を書き換える・追記する
3. 保存する
4. GitHubに反映（下記）すれば、サイトに自動で反映されます

見出し（`##`, `###`）は自動で目次（左のサイドバー）に反映されます。
`※新規主張` という文字列は、自動で黄色いスタンプ表示になります。

## GitHub Pagesへの公開手順

初回のみ：

```bash
# 1. このフォルダでgitリポジトリを初期化
git init
git add .
git commit -m "FPRL理論編サイト 初版"

# 2. GitHub上に空のリポジトリを作成してから、リモートを設定
git remote add origin https://github.com/<あなたのユーザー名>/<リポジトリ名>.git
git branch -M main
git push -u origin main
```

3. GitHubのリポジトリ画面で **Settings → Pages** を開く
4. 「Source」を `Deploy from a branch` にし、ブランチを `main` / フォルダを `/ (root)` に設定して保存
5. 数分待つと `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開される

以降の更新：

```bash
git add theory.md
git commit -m "理論編を更新"
git push
```

これだけでサイトが更新されます（GitHub Pagesは`main`ブランチの内容を自動で反映します）。

## AI（チャッピー等）に編集してもらう場合

`theory.md` はただのテキストファイルなので、AIに「このファイルのここを直して」と頼めば、
差分だけ修正して返してもらえます。返ってきた内容でこのファイルを上書き→git push すれば反映されます。
index.html / script.js / style.css は基本的に触る必要はありません。
