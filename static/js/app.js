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
    voronoiPlacement: $('voronoiPlacement'),
    density: $('density'), densityVal: $('densityVal'),
    lloydIter: $('lloydIter'), lloydIterVal: $('lloydIterVal'),
    contourScale: $('contourScale'), contourScaleVal: $('contourScaleVal'),
    contourOctaves: $('contourOctaves'), contourOctavesVal: $('contourOctavesVal'),
    contourLevels: $('contourLevels'), contourLevelsVal: $('contourLevelsVal'),
    seed: $('seed'),
    regenBtn: $('regenBtn'),
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

  // === Voronoi ===========================================================
  //
  // Pipeline: seed → site placement → Bowyer-Watson Delaunay →
  //           dual graph (Voronoi edges = circumcenters of adjacent triangles) →
  //           optional Lloyd relaxation (recompute, replace sites with cell
  //           centroids, repeat) → Liang-Barsky clip to grid rect.
  //
  // Output is plain {x1,y1,x2,y2} segments so the existing line renderer
  // handles drawing without special cases.

  // Mulberry32 — small fast deterministic PRNG. Seeded so reloads + print
  // previews reproduce the same diagram.
  function mulberry32(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function uniformSites(w, h, n, rand) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: rand() * w, y: rand() * h });
    return pts;
  }

  // Bridson's Poisson-disk sampling: produces blue-noise distribution where
  // no two points are closer than `r`. Using a background grid keeps neighbor
  // checks O(1) per candidate. Target count `n` sets r from area density.
  function poissonSites(w, h, n, rand) {
    if (n < 1) return [];
    const r = Math.sqrt((w * h) / (n * 0.65));
    const k = 30; // candidates per active point
    const cell = r / Math.SQRT2;
    const gw = Math.max(1, Math.ceil(w / cell));
    const gh = Math.max(1, Math.ceil(h / cell));
    const grid = new Int32Array(gw * gh).fill(-1);
    const sites = [];
    const active = [];
    const gIdx = (x, y) => Math.floor(x / cell) + Math.floor(y / cell) * gw;
    function fits(x, y) {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const i = grid[nx + ny * gw];
          if (i === -1) continue;
          const ddx = sites[i].x - x, ddy = sites[i].y - y;
          if (ddx * ddx + ddy * ddy < r * r) return false;
        }
      }
      return true;
    }
    function add(x, y) {
      const idx = sites.length;
      sites.push({ x, y });
      active.push(idx);
      grid[gIdx(x, y)] = idx;
    }
    add(rand() * w, rand() * h);
    while (active.length > 0) {
      const ai = Math.floor(rand() * active.length);
      const a = sites[active[ai]];
      let placed = false;
      for (let i = 0; i < k; i++) {
        const ang = rand() * Math.PI * 2;
        const dist = r + rand() * r;
        const x = a.x + Math.cos(ang) * dist;
        const y = a.y + Math.sin(ang) * dist;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        if (fits(x, y)) { add(x, y); placed = true; break; }
      }
      if (!placed) {
        active[ai] = active[active.length - 1];
        active.pop();
      }
    }
    return sites;
  }

  function circumcircle(a, b, c) {
    const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return { cx: 0, cy: 0, r2: Infinity };
    const a2 = ax * ax + ay * ay;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    const dx = ax - ux, dy = ay - uy;
    return { cx: ux, cy: uy, r2: dx * dx + dy * dy };
  }

  // Bowyer-Watson incremental Delaunay. Returns triangles indexing into
  // `points` (the user sites only — super-triangle vertices are stripped).
  // Each triangle carries its circumcenter so we don't recompute it.
  function delaunay(sites, w, h) {
    const M = Math.max(w, h) * 20;
    const cx = w / 2, cy = h / 2;
    const sup0 = { x: cx - M, y: cy - M };
    const sup1 = { x: cx + M, y: cy - M };
    const sup2 = { x: cx,     y: cy + M };
    const points = sites.slice();
    const sa = points.length, sb = sa + 1, sc = sa + 2;
    points.push(sup0, sup1, sup2);

    let tris = [{ a: sa, b: sb, c: sc, ...circumcircle(sup0, sup1, sup2) }];

    for (let pi = 0; pi < sites.length; pi++) {
      const p = points[pi];
      const bad = [];
      const keep = [];
      for (const t of tris) {
        const dx = p.x - t.cx, dy = p.y - t.cy;
        if (dx * dx + dy * dy < t.r2) bad.push(t);
        else keep.push(t);
      }
      // Polygon hole boundary = edges that appear exactly once across bad tris.
      const edgeCount = new Map();
      const edgePts = new Map();
      const ek = (u, v) => u < v ? `${u},${v}` : `${v},${u}`;
      for (const t of bad) {
        const es = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
        for (const [u, v] of es) {
          const k = ek(u, v);
          edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
          edgePts.set(k, [u, v]);
        }
      }
      tris = keep;
      for (const [k, count] of edgeCount) {
        if (count !== 1) continue;
        const [u, v] = edgePts.get(k);
        tris.push({ a: u, b: v, c: pi, ...circumcircle(points[u], points[v], points[pi]) });
      }
    }

    return {
      tris: tris.filter(t => t.a < sites.length && t.b < sites.length && t.c < sites.length),
      sites,
    };
  }

  // Voronoi edges = segments between circumcenters of triangle pairs that
  // share a Delaunay edge. Boundary edges (only one triangle) are skipped —
  // they'd extend to infinity; we close the result by clipping to the rect.
  function voronoiSegments(d) {
    const map = new Map();
    const ek = (u, v) => u < v ? `${u},${v}` : `${v},${u}`;
    for (let i = 0; i < d.tris.length; i++) {
      const t = d.tris[i];
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const k = ek(u, v);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(i);
      }
    }
    const segs = [];
    for (const list of map.values()) {
      if (list.length !== 2) continue;
      const t1 = d.tris[list[0]], t2 = d.tris[list[1]];
      segs.push({ x1: t1.cx, y1: t1.cy, x2: t2.cx, y2: t2.cy });
    }
    return segs;
  }

  // Liang-Barsky line clip to axis-aligned rect.
  function clipSegment(s, xmin, ymin, xmax, ymax) {
    let t0 = 0, t1 = 1;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const tests = [
      [-dx, s.x1 - xmin],
      [ dx, xmax - s.x1],
      [-dy, s.y1 - ymin],
      [ dy, ymax - s.y1],
    ];
    for (const [p, q] of tests) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else       { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return {
      x1: s.x1 + t0 * dx, y1: s.y1 + t0 * dy,
      x2: s.x1 + t1 * dx, y2: s.y1 + t1 * dy,
    };
  }

  // Sutherland-Hodgman polygon clip — needed for Lloyd centroids so that
  // boundary cells (which would otherwise have infinite area) get a sane
  // centroid inside the rect.
  function clipPolygon(poly, xmin, ymin, xmax, ymax) {
    const edges = [
      { inside: (p) => p.x >= xmin, isect: (a, b) => isectX(a, b, xmin) },
      { inside: (p) => p.x <= xmax, isect: (a, b) => isectX(a, b, xmax) },
      { inside: (p) => p.y >= ymin, isect: (a, b) => isectY(a, b, ymin) },
      { inside: (p) => p.y <= ymax, isect: (a, b) => isectY(a, b, ymax) },
    ];
    let out = poly;
    for (const e of edges) {
      if (out.length === 0) break;
      const inp = out;
      out = [];
      for (let i = 0; i < inp.length; i++) {
        const cur = inp[i];
        const prev = inp[(i + inp.length - 1) % inp.length];
        const ci = e.inside(cur), pi = e.inside(prev);
        if (ci) {
          if (!pi) out.push(e.isect(prev, cur));
          out.push(cur);
        } else if (pi) {
          out.push(e.isect(prev, cur));
        }
      }
    }
    return out;
  }
  function isectX(a, b, x) {
    const t = (x - a.x) / (b.x - a.x);
    return { x, y: a.y + t * (b.y - a.y) };
  }
  function isectY(a, b, y) {
    const t = (y - a.y) / (b.y - a.y);
    return { x: a.x + t * (b.x - a.x), y };
  }

  // Centroid via the shoelace formula. Falls back to vertex average for
  // degenerate (zero-area) polygons.
  function polygonCentroid(poly) {
    let area2 = 0, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const cross = p.x * q.y - q.x * p.y;
      area2 += cross;
      cx += (p.x + q.x) * cross;
      cy += (p.y + q.y) * cross;
    }
    if (Math.abs(area2) < 1e-12) {
      let sx = 0, sy = 0;
      for (const p of poly) { sx += p.x; sy += p.y; }
      return { x: sx / poly.length, y: sy / poly.length };
    }
    return { x: cx / (3 * area2), y: cy / (3 * area2) };
  }

  // One Lloyd iteration: rebuild Delaunay, gather each site's surrounding
  // circumcenters (sorted by angle), clip the cell polygon to the rect, move
  // the site to the polygon's centroid.
  function lloydStep(sites, w, h) {
    const d = delaunay(sites, w, h);
    const adj = new Array(sites.length);
    for (let i = 0; i < sites.length; i++) adj[i] = [];
    for (const t of d.tris) {
      adj[t.a].push(t);
      adj[t.b].push(t);
      adj[t.c].push(t);
    }
    const out = new Array(sites.length);
    for (let i = 0; i < sites.length; i++) {
      const ts = adj[i];
      if (ts.length < 2) { out[i] = sites[i]; continue; }
      const sx = sites[i].x, sy = sites[i].y;
      const verts = ts.map(t => ({
        x: t.cx, y: t.cy, ang: Math.atan2(t.cy - sy, t.cx - sx),
      }));
      verts.sort((a, b) => a.ang - b.ang);
      const clipped = clipPolygon(verts, 0, 0, w, h);
      if (clipped.length < 3) { out[i] = sites[i]; continue; }
      const c = polygonCentroid(clipped);
      out[i] = {
        x: Math.max(0, Math.min(w, c.x)),
        y: Math.max(0, Math.min(h, c.y)),
      };
    }
    return out;
  }

  // === Contour lines =====================================================
  //
  // Pipeline: seed → Perlin noise (with seeded permutation table) → fBm
  // accumulates octaves for fractal detail → sample on a regular grid →
  // marching squares emits one polyline per contour level → segments.
  //
  // Output is the same {x1,y1,x2,y2} segment shape Voronoi/iso/dimetric
  // produce, so the existing line renderer handles drawing.

  // Build a Perlin noise function with a seeded gradient permutation.
  // Classic Ken Perlin 2002 implementation: the permutation table is just a
  // shuffle of [0..255], so seeding the shuffle = seeding the noise field.
  function makePerlin2D(rand) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle with seeded RNG.
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    // 8 cardinal+diagonal gradient directions. Ken's original used 12 in 3D;
    // 8 is the standard 2D simplification and produces near-identical results.
    const GX = [1, -1,  1, -1,  1, -1,  0,  0];
    const GY = [1,  1, -1, -1,  0,  0,  1, -1];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10); // 6t⁵-15t⁴+10t³
    const lerp = (a, b, t) => a + t * (b - a);

    return function noise(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const X = xi & 255, Y = yi & 255;
      const xf = x - xi, yf = y - yi;
      const u = fade(xf), v = fade(yf);
      const A = perm[X] + Y, B = perm[X + 1] + Y;
      const ga = perm[A]     & 7;
      const gb = perm[B]     & 7;
      const gc = perm[A + 1] & 7;
      const gd = perm[B + 1] & 7;
      const n00 = GX[ga] * xf       + GY[ga] * yf;
      const n10 = GX[gb] * (xf - 1) + GY[gb] * yf;
      const n01 = GX[gc] * xf       + GY[gc] * (yf - 1);
      const n11 = GX[gd] * (xf - 1) + GY[gd] * (yf - 1);
      return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
    };
  }

  // Fractal Brownian motion: sum noise at 2× frequency, ½ amplitude per
  // octave. Normalised by total amplitude so the output range is stable
  // regardless of octave count.
  function fbm(noise, x, y, octaves) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  // Marching squares — for each cell of a sampled scalar field, look up the
  // 4-bit corner-above-threshold pattern and emit interpolated segments.
  //
  // Corner bits: TL=1, TR=2, BR=4, BL=8. Cases mirror around 7/8 (e.g. case 1
  // and case 14 produce the same segment because they're inverses).
  // Cases 5 and 10 are saddles where two opposite corners are above threshold
  // — we sample the cell's centre value to decide which way the contour goes.
  function marchingSquares(field, cols, rows, cellW, cellH, threshold, out) {
    for (let j = 0; j < rows - 1; j++) {
      const row0 = j * cols;
      const row1 = (j + 1) * cols;
      for (let i = 0; i < cols - 1; i++) {
        const tl = field[row0 + i];
        const tr = field[row0 + i + 1];
        const br = field[row1 + i + 1];
        const bl = field[row1 + i];

        let code = 0;
        if (tl >= threshold) code |= 1;
        if (tr >= threshold) code |= 2;
        if (br >= threshold) code |= 4;
        if (bl >= threshold) code |= 8;
        if (code === 0 || code === 15) continue;

        const x0 = i * cellW,       y0 = j * cellH;
        const x1 = (i + 1) * cellW, y1 = (j + 1) * cellH;

        // Linear interpolation along each crossed cell edge.
        const tTop    = (threshold - tl) / (tr - tl);
        const tRight  = (threshold - tr) / (br - tr);
        const tBottom = (threshold - bl) / (br - bl);
        const tLeft   = (threshold - tl) / (bl - tl);
        const xTop    = x0 + tTop    * cellW;
        const yRight  = y0 + tRight  * cellH;
        const xBottom = x0 + tBottom * cellW;
        const yLeft   = y0 + tLeft   * cellH;

        switch (code) {
          case 1: case 14:
            out.push({ x1: x0, y1: yLeft, x2: xTop, y2: y0 }); break;
          case 2: case 13:
            out.push({ x1: xTop, y1: y0, x2: x1, y2: yRight }); break;
          case 3: case 12:
            out.push({ x1: x0, y1: yLeft, x2: x1, y2: yRight }); break;
          case 4: case 11:
            out.push({ x1: x1, y1: yRight, x2: xBottom, y2: y1 }); break;
          case 6: case 9:
            out.push({ x1: xTop, y1: y0, x2: xBottom, y2: y1 }); break;
          case 7: case 8:
            out.push({ x1: x0, y1: yLeft, x2: xBottom, y2: y1 }); break;
          case 5: { // saddle: TL+BR above
            const ctr = (tl + tr + br + bl) / 4;
            if (ctr >= threshold) {
              out.push({ x1: x0, y1: yLeft, x2: xBottom, y2: y1 });
              out.push({ x1: xTop, y1: y0, x2: x1, y2: yRight });
            } else {
              out.push({ x1: x0, y1: yLeft, x2: xTop, y2: y0 });
              out.push({ x1: x1, y1: yRight, x2: xBottom, y2: y1 });
            }
            break;
          }
          case 10: { // saddle: TR+BL above
            const ctr = (tl + tr + br + bl) / 4;
            if (ctr >= threshold) {
              out.push({ x1: xTop, y1: y0, x2: x1, y2: yRight });
              out.push({ x1: x0, y1: yLeft, x2: xBottom, y2: y1 });
            } else {
              out.push({ x1: x0, y1: yLeft, x2: xTop, y2: y0 });
              out.push({ x1: x1, y1: yRight, x2: xBottom, y2: y1 });
            }
            break;
          }
        }
      }
    }
  }

  function contourLines(w, h, opts) {
    // 1mm sample spacing — fine enough that contour curves look smooth at
    // print scale, coarse enough to keep the grid small (~A4 portrait =
    // 210×297 = ~62k samples). Bumping to 0.5mm quadruples cost.
    const sampleMM = 1.0;
    const cols = Math.max(2, Math.ceil(w / sampleMM) + 1);
    const rows = Math.max(2, Math.ceil(h / sampleMM) + 1);
    const cellW = w / (cols - 1);
    const cellH = h / (rows - 1);

    const rand = mulberry32(opts.seed);
    const noise = makePerlin2D(rand);

    // Frequency: opts.scale is the base wavelength in mm. So at scale=30mm,
    // a full noise period spans ~30mm of paper. Higher scale = bigger features.
    const freq = 1 / Math.max(1, opts.scale);
    const field = new Float32Array(cols * rows);
    let fmin = Infinity, fmax = -Infinity;
    for (let j = 0; j < rows; j++) {
      const y = j * cellH * freq;
      for (let i = 0; i < cols; i++) {
        const x = i * cellW * freq;
        const v = fbm(noise, x, y, opts.octaves);
        field[j * cols + i] = v;
        if (v < fmin) fmin = v;
        if (v > fmax) fmax = v;
      }
    }
    if (fmax - fmin < 1e-9) return [];

    // Distribute contour levels evenly between min and max, excluding the
    // extremes themselves (a contour at exactly the min/max would be empty
    // or one degenerate point).
    const out = [];
    for (let k = 1; k <= opts.levels; k++) {
      const t = k / (opts.levels + 1);
      const threshold = fmin + (fmax - fmin) * t;
      marchingSquares(field, cols, rows, cellW, cellH, threshold, out);
    }
    return out;
  }

  function voronoiLines(w, h, opts) {
    const rand = mulberry32(opts.seed);
    let sites = (opts.placement === 'poisson')
      ? poissonSites(w, h, opts.density, rand)
      : uniformSites(w, h, opts.density, rand);

    if (sites.length < 3) return [];

    // Lloyd applies only when the user explicitly asks for relaxation.
    // Poisson-disk is already well-distributed, so we don't relax it by default.
    const iters = (opts.placement === 'random-lloyd') ? opts.lloydIter : 0;
    for (let i = 0; i < iters; i++) sites = lloydStep(sites, w, h);

    const segs = voronoiSegments(delaunay(sites, w, h));
    const out = [];
    for (const s of segs) {
      const c = clipSegment(s, 0, 0, w, h);
      if (c && (c.x1 !== c.x2 || c.y1 !== c.y2)) out.push(c);
    }
    return out;
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
    const isVoronoi = gridType === 'voronoi';
    const isContours = gridType === 'contours';
    const angleDeg = GRID_ANGLES_DEG[gridType];
    const angleRad = (angleDeg || 0) * Math.PI / 180;

    // Drives `.voronoi-only` / `.not-voronoi` visibility via CSS.
    document.body.setAttribute('data-grid', gridType);

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
    els.densityVal.textContent = els.density.value;
    els.lloydIterVal.textContent = els.lloydIter.value;
    els.contourScaleVal.textContent = els.contourScale.value;
    els.contourOctavesVal.textContent = els.contourOctaves.value;
    els.contourLevelsVal.textContent = els.contourLevels.value;

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
    // drawn — clip them to the grid rectangle. Voronoi already self-clips
    // via Liang-Barsky inside voronoiLines, so it doesn't need clip-path.
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

    if (isVoronoi || isContours) {
      const segs = isVoronoi
        ? voronoiLines(gridW, gridH, {
            seed: parseInt(els.seed.value, 10) || 1,
            density: parseInt(els.density.value, 10) || 200,
            placement: els.voronoiPlacement.value,
            lloydIter: parseInt(els.lloydIter.value, 10) || 0,
          })
        : contourLines(gridW, gridH, {
            seed: parseInt(els.seed.value, 10) || 1,
            scale: parseFloat(els.contourScale.value) || 30,
            octaves: parseInt(els.contourOctaves.value, 10) || 4,
            levels: parseInt(els.contourLevels.value, 10) || 20,
          });
      for (const s of segs) {
        const ln = document.createElementNS(SVG_NS, 'line');
        ln.setAttribute('x1', s.x1.toFixed(3));
        ln.setAttribute('y1', s.y1.toFixed(3));
        ln.setAttribute('x2', s.x2.toFixed(3));
        ln.setAttribute('y2', s.y2.toFixed(3));
        g.appendChild(ln);
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
    ['gridType',         'value'],
    ['pageSize',         'value'],
    ['cellSize',         'value'],
    ['lineWidth',        'value'],
    ['opacity',          'value'],
    ['color',            'value'],
    ['showVertical',     'checked'],
    ['margin',           'value'],
    ['voronoiPlacement', 'value'],
    ['density',          'value'],
    ['lloydIter',        'value'],
    ['contourScale',     'value'],
    ['contourOctaves',   'value'],
    ['contourLevels',    'value'],
    ['seed',             'value'],
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
    els.voronoiPlacement, els.density, els.lloydIter,
    els.contourScale, els.contourOctaves, els.contourLevels,
    els.seed,
  ];
  function onChange() { render(); saveSettings(); }
  for (const el of inputs) {
    el.addEventListener('input', onChange);
    el.addEventListener('change', onChange);
  }
  els.printBtn.addEventListener('click', () => window.print());
  els.downloadBtn.addEventListener('click', downloadSVG);
  els.regenBtn.addEventListener('click', () => {
    // 31-bit positive int keeps it within <input type=number> default range.
    els.seed.value = Math.floor(Math.random() * 0x7FFFFFFF);
    onChange();
  });

  // Restore *before* the first render so we don't flash defaults.
  loadSettings();
  render();
})();
