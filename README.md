# diagramMaker

ブラウザだけで使える個人用の連関図エディターです。

公開版: https://psychologyKM.github.io/diagramMaker/

## 主な機能

- 要素の追加・編集・移動・削除
- 要素間のドラッグ、または接続ツールによる関係の作成
- 直線／曲線、順方向／逆方向／両方向／矢印なしの切り替え
- 実線／破線／点線／二重線の切り替え
- Undo / Redo、ズーム、全体表示
- ブラウザ内への自動保存
- PNG画像、編集可能なPowerPoint（.pptx）への書き出し

PowerPoint出力はKeynoteでも開けます。Keynoteで開いたあと、必要に応じて`.key`形式で保存してください。

## ローカル起動

```sh
npm install
npm run dev
```

GitHub Pages向けの静的ビルドは `npm run build:pages` で生成できます。
