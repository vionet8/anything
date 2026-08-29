(async function () {
  const contentEl = document.getElementById('content');
  const tocListEl = document.getElementById('tocList');

  function slugify(text, used) {
    let base = text
      .trim()
      .replace(/[※]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    if (!base) base = 'section';
    let slug = base;
    let i = 2;
    while (used.has(slug)) {
      slug = `${base}-${i++}`;
    }
    used.add(slug);
    return slug;
  }

  let mdText;
  try {
    const res = await fetch('theory.md', { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    mdText = await res.text();
  } catch (err) {
    contentEl.innerHTML =
      '<p style="color:#F2A93B;font-family:var(--mono)">theory.md を読み込めませんでした。' +
      'index.html と同じ階層に theory.md があるか確認してください。</p>';
    console.error(err);
    return;
  }

  const usedSlugs = new Set();
  const headings = [];

  const renderer = new marked.Renderer();
  renderer.heading = function (text, level, raw, slugger) {
    // text may include inline HTML from other renderers; strip tags for id/toc label
    const plain = String(text).replace(/<[^>]*>/g, '');
    const id = slugify(plain, usedSlugs);
    if (level === 2 || level === 3) {
      headings.push({ id, text: plain, level });
    }
    return `<h${level} id="${id}">${text}</h${level}>\n`;
  };

  marked.setOptions({ renderer, mangle: false, headerIds: false });

  let html = marked.parse(mdText);

  // Turn "※新規主張" / "※新規主張)" markers into a small stamp badge
  html = html.replace(/※新規主張/g, '<span class="stamp">NEW</span>');

  contentEl.innerHTML = html;

  // Build TOC
  if (headings.length === 0) {
    tocListEl.innerHTML = '<p style="color:var(--muted)">見出しがありません</p>';
  } else {
    tocListEl.innerHTML = headings
      .map(
        (h) =>
          `<a href="#${h.id}" class="${h.level === 3 ? 'lvl-3' : 'lvl-2'}">${h.text}</a>`
      )
      .join('');
  }

  // Scrollspy: highlight active TOC entry
  const tocLinks = Array.from(tocListEl.querySelectorAll('a'));
  const sectionEls = headings
    .map((h) => document.getElementById(h.id))
    .filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = tocListEl.querySelector(`a[href="#${entry.target.id}"]`);
        if (!link) return;
        if (entry.isIntersecting) {
          tocLinks.forEach((l) => l.classList.remove('active'));
          link.classList.add('active');
        }
      });
    },
    { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
  );
  sectionEls.forEach((el) => observer.observe(el));
})();
