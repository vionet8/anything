// 結果を1枚の画像にする処理と、大会をファイルに出し入れする処理。
// どちらもサーバーは使わず、端末の中だけで完結する。
(function (window) {
  const W = 1080;
  const PAD = 56;
  const PHOTO_H = 700;
  const ROW_H = 124;
  const FONT = '-apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // 1行に収める。あふれる分は「…」で切る
  function fitText(g, text, maxWidth) {
    const value = String(text || '');
    if (g.measureText(value).width <= maxWidth) return value;
    let cut = value;
    while (cut.length > 1 && g.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
    return `${cut}…`;
  }

  function drawCover(g, bitmap, x, y, size) {
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    g.save();
    roundRect(g, x, y, size, size, 14);
    g.clip();
    g.drawImage(bitmap, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
    g.restore();
  }

  async function bitmapOf(entry) {
    try {
      return entry && entry.photo ? await createImageBitmap(entry.photo) : null;
    } catch (err) {
      return null;
    }
  }

  // 優勝写真と順位表を縦に並べた1枚の画像を作る
  async function buildResultImage({ title, createdAt, rows }) {
    const champion = rows[0];
    const others = rows.slice(1);
    const champNote = String(champion.entry.note || '').trim();

    // 写真の形に合わせて枠を決める（横長でも縦長でも、白い余白が出ないように）
    const champBitmap = await bitmapOf(champion.entry);
    const maxW = W - PAD * 2 - 40;
    const maxH = PHOTO_H - 40;
    let drawW = maxW;
    let drawH = maxH;
    if (champBitmap) {
      const scale = Math.min(maxW / champBitmap.width, maxH / champBitmap.height);
      drawW = champBitmap.width * scale;
      drawH = champBitmap.height * scale;
    }
    const cardW = drawW + 40;
    const cardH = drawH + 40;
    const cardX = (W - cardW) / 2;
    const champTextH = 124 + (champNote ? 48 : 0) + 46;
    const height = 200 + cardH + champTextH + (others.length ? others.length * ROW_H : 0) + 80;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = height;
    const g = canvas.getContext('2d');

    g.fillStyle = '#f6f4f0';
    g.fillRect(0, 0, W, height);

    g.fillStyle = '#23201d';
    g.font = `bold 54px ${FONT}`;
    g.fillText(fitText(g, title || '写真トーナメント', W - PAD * 2), PAD, 108);

    g.fillStyle = '#8a8178';
    g.font = `30px ${FONT}`;
    const date = new Date(createdAt || Date.now()).toLocaleDateString('ja-JP');
    g.fillText(`${date}・${rows.length}枚から`, PAD, 158);

    g.fillStyle = '#ffffff';
    roundRect(g, cardX, 200, cardW, cardH, 26);
    g.fill();
    if (champBitmap) g.drawImage(champBitmap, cardX + 20, 220, drawW, drawH);

    let y = 200 + cardH + 62;
    g.fillStyle = '#d8a326';
    g.font = `bold 32px ${FONT}`;
    g.fillText('優勝', PAD, y);

    y += 62;
    g.fillStyle = '#23201d';
    g.font = `bold 52px ${FONT}`;
    g.fillText(fitText(g, champion.entry.name, W - PAD * 2), PAD, y);

    if (champNote) {
      y += 48;
      g.fillStyle = '#8a8178';
      g.font = `32px ${FONT}`;
      g.fillText(fitText(g, champNote, W - PAD * 2), PAD, y);
    }

    y += 46;
    for (const row of others) {
      const bitmap = await bitmapOf(row.entry);
      g.fillStyle = '#e5dfd6';
      roundRect(g, PAD, y, 88, 88, 14);
      g.fill();
      if (bitmap) drawCover(g, bitmap, PAD, y, 88);

      g.fillStyle = '#8a8178';
      g.font = `26px ${FONT}`;
      g.fillText(row.label, PAD + 112, y + 36);

      g.fillStyle = '#23201d';
      g.font = `bold 34px ${FONT}`;
      g.fillText(fitText(g, row.entry.name, W - PAD * 2 - 300), PAD + 240, y + 36);

      const note = String(row.entry.note || '').trim();
      if (note) {
        g.fillStyle = '#8a8178';
        g.font = `26px ${FONT}`;
        g.fillText(fitText(g, note, W - PAD * 2 - 300), PAD + 240, y + 74);
      }
      y += ROW_H;
    }

    g.fillStyle = '#8a8178';
    g.font = `26px ${FONT}`;
    g.fillText('写真トーナメント', PAD, height - 36);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new File([blob], `${fileName(createdAt)}-result.png`, { type: 'image/png' });
  }

  // 日本語のファイル名を落としてしまうブラウザがあり、拡張子ごと消えると開けなくなる。
  // 大会名は画像とファイルの中身に入っているので、名前は英数字と日付で固定する。
  function fileName(createdAt) {
    const date = new Date(createdAt || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    return `photo-tournament-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // 共有シートが使えるならそちらへ。無ければ保存に回す。
  async function shareOrDownload(file, meta) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: meta.title, text: meta.text });
        return 'shared';
      } catch (err) {
        if (err && err.name === 'AbortError') return 'cancelled';
      }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'downloaded';
  }

  // ---- 大会そのものの持ち出し ----------------------------------------

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function exportFile(record) {
    const entries = await Promise.all(
      record.entries.map(async (entry) => ({
        id: entry.id,
        name: entry.name,
        note: entry.note || '',
        url: entry.url || '',
        photo: await blobToDataUrl(entry.photo),
      }))
    );
    const data = {
      format: 'photo-tournament',
      version: 1,
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      showInfo: Boolean(record.showInfo),
      picks: record.picks,
      entries,
    };
    return new File([JSON.stringify(data)], `${fileName(record.createdAt)}.ptour.json`, {
      type: 'application/json',
    });
  }

  // 読み込んだファイルは他の端末から来るので、形をひとつずつ確かめる
  async function parseImport(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      throw new Error('大会のファイルとして読み取れませんでした。');
    }
    if (!data || data.format !== 'photo-tournament' || !Array.isArray(data.entries) || data.entries.length < 2) {
      throw new Error('この大会のファイルではないようです。');
    }

    const entries = [];
    for (const entry of data.entries) {
      if (!entry || typeof entry.photo !== 'string' || !/^data:image\//.test(entry.photo)) {
        throw new Error('写真が入っていないため読み込めませんでした。');
      }
      const photo = await (await fetch(entry.photo)).blob();
      entries.push({
        id: String(entry.id || Math.random().toString(36).slice(2)),
        name: String(entry.name || '写真'),
        note: String(entry.note || ''),
        url: String(entry.url || ''),
        photo,
      });
    }

    const ids = new Set(entries.map((e) => e.id));
    const picks = (Array.isArray(data.picks) ? data.picks : [])
      .filter((p) => p && typeof p.matchId === 'string' && ids.has(p.winnerId))
      .map((p) => ({ matchId: p.matchId, winnerId: p.winnerId }));

    return {
      id: String(data.id || Math.random().toString(36).slice(2)),
      title: String(data.title || '読み込んだ大会'),
      createdAt: Number(data.createdAt) || Date.now(),
      updatedAt: Date.now(),
      showInfo: Boolean(data.showInfo),
      entries,
      picks,
    };
  }

  window.Share = { buildResultImage, shareOrDownload, exportFile, parseImport, fileName };
})(window);
