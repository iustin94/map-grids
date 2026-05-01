(() => {
  const PAGE_SIZES = {
    'letter-portrait':  { w: 215.9, h: 279.4 },
    'letter-landscape': { w: 279.4, h: 215.9 },
    'a4-portrait':      { w: 210.0, h: 297.0 },
    'a4-landscape':     { w: 297.0, h: 210.0 },
  };

  const GRID_ANGLES_DEG = {
    isometric: 30,
    dimetric: Math.atan(0.5) * 180 / Math.PI, // ~26.565°
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    gridType: $('gridType'),
    pageSize: $('pageSize'),
    cellSize: $('cellSize'), cellSizeVal: $('cellSizeVal'),
    lineWidth: $('lineWidth'), lineWidthVal: $('lineWidthVal'),
    opacity: $('opacity'), opacityVal: $('opacityVal'),
    color: $('color'),
    showVertical: $('showVertical'),
    margin: $('margin'), marginVal: $('marginVal'),
    paper: $('paper'),
    svg: $('grid'),
    printBtn: $('printBtn'),
    downloadBtn: $('downloadBtn'),
  };

  // Build line segments for a single family of parallel lines covering rect [0,w]×[0,h].
  // angleRad: line direction angle from horizontal, in radians.
  // spacing: perpendicular distance between adjacent lines, in mm.
  // Returns array of {x1,y1,x2,y2}.
  function parallelLines(w, h, angleRad, spacing) {
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    // Perpendicular axis is (-sinA, cosA). Project corners onto it.
    const corners = [[0,0],[w,0],[0,h],[w,h]];
    const projs = corners.map(([x,y]) => -sinA*x + cosA*y);
    const pMin = Math.min(...projs);
    const pMax = Math.max(...projs);

    const nMin = Math.ceil(pMin / spacing);
    const nMax = Math.floor(pMax / spacing);

    const segments = [];
    const EPS = 1e-9;

    for (let n = nMin; n <= nMax; n++) {
      const p = n * spacing;
      // Parametric form: point(t) = (-p*sinA + t*cosA, p*cosA + t*sinA)
      // Intersect with x=0, x=w, y=0, y=h.
      const ts = [];
      if (Math.abs(cosA) > EPS) {
        ts.push({ t: (0 - (-p*sinA)) / cosA, edge: 'x0' });
        ts.push({ t: (w - (-p*sinA)) / cosA, edge: 'xw' });
      }
      if (Math.abs(sinA) > EPS) {
        ts.push({ t: (0 - p*cosA) / sinA, edge: 'y0' });
        ts.push({ t: (h - p*cosA) / sinA, edge: 'yh' });
      }
      // Compute (x,y) at each t, keep those inside rectangle (with epsilon).
      const inside = [];
      for (const {t} of ts) {
        const x = -p*sinA + t*cosA;
        const y =  p*cosA + t*sinA;
        if (x >= -EPS && x <= w+EPS && y >= -EPS && y <= h+EPS) {
          inside.push({ t, x, y });
        }
      }
      if (inside.length < 2) continue;
      inside.sort((a,b) => a.t - b.t);
      const a = inside[0];
      const b = inside[inside.length - 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) continue;
      segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return segments;
  }

  function verticalLines(w, h, spacing) {
    const segments = [];
    const nMax = Math.floor(w / spacing);
    for (let n = 0; n <= nMax; n++) {
      const x = n * spacing;
      segments.push({ x1: x, y1: 0, x2: x, y2: h });
    }
    return segments;
  }

  // Build SVG path d-strings tiling rect [0,w]×[0,h] with regular hexagons of
  // side length `s`. We draw only 3 of the 6 edges per hex so shared edges
  // aren't stroked twice (which would visibly darken them at low opacity).
  // Generation extends one ghost hex past each edge so the missing 3 edges
  // of boundary hexes are still drawn — clipPath crops the overflow.
  //
  // Pointy-top hex (vertex up): width=s√3, height=2s, row spacing=1.5s,
  // alternating rows offset by w/2. We draw the right half: top → top-right →
  // bottom-right → bottom (3 edges).
  //
  // Flat-top hex (edge up): width=2s, height=s√3, column spacing=1.5s,
  // alternating columns offset by h/2. We draw the bottom half: right →
  // bottom-right → bottom-left → left (3 edges).
  function hexPaths(w, h, s, orientation) {
    const paths = [];
    if (orientation === 'pointy') {
      const hexW = s * Math.sqrt(3);
      const vStep = 1.5 * s;
      const dx = hexW / 2;
      const dy = s / 2;
      const rowMin = Math.floor(-s / vStep) - 1;
      const rowMax = Math.ceil((h + s) / vStep) + 1;
      const colMin = Math.floor(-hexW / hexW) - 1;
      const colMax = Math.ceil((w + hexW) / hexW) + 1;
      for (let r = rowMin; r <= rowMax; r++) {
        const xOffset = (((r % 2) + 2) % 2 === 1) ? dx : 0;
        const cy = r * vStep;
        for (let c = colMin; c <= colMax; c++) {
          const cx = c * hexW + xOffset;
          paths.push(
            `M${(cx).toFixed(3)},${(cy - s).toFixed(3)} ` +
            `L${(cx + dx).toFixed(3)},${(cy - dy).toFixed(3)} ` +
            `L${(cx + dx).toFixed(3)},${(cy + dy).toFixed(3)} ` +
            `L${(cx).toFixed(3)},${(cy + s).toFixed(3)}`
          );
        }
      }
    } else { // flat
      const hexH = s * Math.sqrt(3);
      const hStep = 1.5 * s;
      const dx = s / 2;
      const dy = hexH / 2;
      const colMin = Math.floor(-s / hStep) - 1;
      const colMax = Math.ceil((w + s) / hStep) + 1;
      const rowMin = Math.floor(-hexH / hexH) - 1;
      const rowMax = Math.ceil((h + hexH) / hexH) + 1;
      for (let c = colMin; c <= colMax; c++) {
        const yOffset = (((c % 2) + 2) % 2 === 1) ? dy : 0;
        const cx = c * hStep;
        for (let r = rowMin; r <= rowMax; r++) {
          const cy = r * hexH + yOffset;
          paths.push(
            `M${(cx + s).toFixed(3)},${(cy).toFixed(3)} ` +
            `L${(cx + dx).toFixed(3)},${(cy + dy).toFixed(3)} ` +
            `L${(cx - dx).toFixed(3)},${(cy + dy).toFixed(3)} ` +
            `L${(cx - s).toFixed(3)},${(cy).toFixed(3)}`
          );
        }
      }
    }
    return paths;
  }

  function render() {
    const pageKey = els.pageSize.value;
    const { w: pageW, h: pageH } = PAGE_SIZES[pageKey];
    const margin = parseFloat(els.margin.value);
    const cell = parseFloat(els.cellSize.value);
    const lineW = parseFloat(els.lineWidth.value);
    const opacity = parseFloat(els.opacity.value);
    const color = els.color.value;
    const gridType = els.gridType.value;
    const isHex = gridType === 'hex-pointy' || gridType === 'hex-flat';
    const angleDeg = GRID_ANGLES_DEG[gridType];
    const angleRad = (angleDeg || 0) * Math.PI / 180;

    // Vertical lines only make sense for isometric — dimetric forms rhombi
    // and hex grids define their own structure.
    const verticalsAllowed = gridType === 'isometric';
    els.showVertical.disabled = !verticalsAllowed;
    els.showVertical.parentElement.style.opacity = verticalsAllowed ? '1' : '0.45';
    const showVertical = verticalsAllowed && els.showVertical.checked;

    // Update value labels.
    els.cellSizeVal.textContent = cell.toFixed(cell % 1 === 0 ? 0 : 1);
    els.lineWidthVal.textContent = lineW.toFixed(2);
    els.opacityVal.textContent = opacity.toFixed(2);
    els.marginVal.textContent = margin.toFixed(0);

    // Set paper to physical size on screen.
    els.paper.style.width  = pageW + 'mm';
    els.paper.style.height = pageH + 'mm';

    // Inject a concrete @page size so the browser does not shrink-to-fit or
    // add its own paper margins on print. Without this, `.paper` can overflow
    // the printable area and trigger a horizontal scrollbar that gets printed.
    let pageStyle = document.getElementById('print-page-style');
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'print-page-style';
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent =
      `@page { size: ${pageW}mm ${pageH}mm; margin: 0; }`;

    // SVG sized to page in mm, viewBox in mm so coords are 1:1 with mm.
    const svg = els.svg;
    svg.setAttribute('width',  pageW + 'mm');
    svg.setAttribute('height', pageH + 'mm');
    svg.setAttribute('viewBox', `0 0 ${pageW} ${pageH}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const gridW = Math.max(0, pageW - 2 * margin);
    const gridH = Math.max(0, pageH - 2 * margin);
    if (gridW === 0 || gridH === 0) return;

    // Hex grids extend ghost hexes past the grid bounds so boundary edges get
    // drawn — clip them to the grid rectangle.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    if (isHex) {
      const defs = document.createElementNS(SVG_NS, 'defs');
      const clip = document.createElementNS(SVG_NS, 'clipPath');
      clip.setAttribute('id', 'grid-clip');
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', 0);
      rect.setAttribute('y', 0);
      rect.setAttribute('width',  gridW);
      rect.setAttribute('height', gridH);
      clip.appendChild(rect);
      defs.appendChild(clip);
      svg.appendChild(defs);
    }

    // Translate the grid group by the margin so all lines stay inside.
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${margin} ${margin})`);
    g.setAttribute('fill', 'none');
    g.setAttribute('stroke', color);
    g.setAttribute('stroke-width', lineW);
    g.setAttribute('stroke-opacity', opacity);
    g.setAttribute('stroke-linecap', 'square');
    g.setAttribute('stroke-linejoin', 'miter');
    if (isHex) g.setAttribute('clip-path', 'url(#grid-clip)');
    svg.appendChild(g);

    if (isHex) {
      const orientation = gridType === 'hex-pointy' ? 'pointy' : 'flat';
      const paths = hexPaths(gridW, gridH, cell, orientation);
      for (const d of paths) {
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        g.appendChild(p);
      }
      return;
    }

    const families = [
      parallelLines(gridW, gridH,  angleRad, cell),
      parallelLines(gridW, gridH, -angleRad, cell),
    ];
    if (showVertical) {
      families.push(verticalLines(gridW, gridH, cell));
    }

    for (const fam of families) {
      for (const s of fam) {
        const ln = document.createElementNS(SVG_NS, 'line');
        ln.setAttribute('x1', s.x1.toFixed(3));
        ln.setAttribute('y1', s.y1.toFixed(3));
        ln.setAttribute('x2', s.x2.toFixed(3));
        ln.setAttribute('y2', s.y2.toFixed(3));
        g.appendChild(ln);
      }
    }
  }

  function downloadSVG() {
    const xml = new XMLSerializer().serializeToString(els.svg);
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n', xml],
      { type: 'image/svg+xml' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${els.gridType.value}-grid.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- Persistence ---------------------------------------------------------
  // Stored as JSON under a versioned key so we can change the schema later
  // without breaking on stale data.
  const STORAGE_KEY = 'mapgrids:v1';

  // Each entry: [element, kind] where kind tells us value vs. checked.
  const persistedFields = [
    ['gridType',     'value'],
    ['pageSize',     'value'],
    ['cellSize',     'value'],
    ['lineWidth',    'value'],
    ['opacity',      'value'],
    ['color',        'value'],
    ['showVertical', 'checked'],
    ['margin',       'value'],
  ];

  function loadSettings() {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); }
    catch (_) { return; } // Storage might be disabled (private mode, etc.).
    if (!raw) return;

    let data;
    try { data = JSON.parse(raw); }
    catch (_) { return; }
    if (!data || typeof data !== 'object') return;

    for (const [id, kind] of persistedFields) {
      if (!(id in data)) continue;
      const el = els[id];
      if (!el) continue;
      if (kind === 'checked') el.checked = !!data[id];
      else el.value = data[id];
    }
  }

  function saveSettings() {
    const data = {};
    for (const [id, kind] of persistedFields) {
      const el = els[id];
      if (!el) continue;
      data[id] = (kind === 'checked') ? el.checked : el.value;
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (_) { /* quota exceeded or storage disabled — ignore */ }
  }

  // Wire events.
  const inputs = [
    els.gridType, els.pageSize, els.cellSize, els.lineWidth,
    els.opacity, els.color, els.showVertical, els.margin,
  ];
  function onChange() { render(); saveSettings(); }
  for (const el of inputs) {
    el.addEventListener('input', onChange);
    el.addEventListener('change', onChange);
  }
  els.printBtn.addEventListener('click', () => window.print());
  els.downloadBtn.addEventListener('click', downloadSVG);

  // Restore *before* the first render so we don't flash defaults.
  loadSettings();
  render();
})();
