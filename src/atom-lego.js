/**
 * Atom LEGO Kocka – Moduláris tartalom-egység rendszer
 *
 * Elvek:
 *   • Mini kapacitás (4 KB/brick): minden brick önálló, minimális
 *   • Anyba kantálás (dock): child → parent befogadás, kapacitás aggregáció
 *   • Szétbontás (split): egy brick → n kisebb gyermek brick
 *   • QR zsugorítás (compress): tartalom → QR URL hivatkozás, helytakarékos
 *   • Internet feloldás (resolve): QR/URL → valós tartalom visszatöltése
 *
 * QR + internet = végtelen tömörített tartalom fogadása:
 *   brick.qrRef  → URL → internet → teljes tartalom → újabb brickek
 *   Egyetlen V1 21×21 QR (~40 char URL) = korlátlan internet-tartalom kapuja
 *
 * Hierarchia:
 *   Szint 0: gyökér brick (mag)
 *   Szint 1: anyba kantált gyermekek
 *   Szint 2+: szétbontott atomok (zsugorik)
 *
 * @module atom-lego
 */

'use strict';

const https = require('https');
const http  = require('http');

// ── Konstansok ───────────────────────────────────────────────────────────────

const MINI_CAPACITY = 4096;      // 4 KB – egy atom brick max mérete (byte)
const QR_V1_MAX     = 41;        // QR V1 Level L – max alphanumerikus karakter
const MAX_RESOLVE_SIZE = 32768;  // 32 KB – internet feloldás max méret
const FETCH_TIMEOUT_MS = 5000;   // internet timeout

// ── Nano ID (külső könyvtár nélkül) ─────────────────────────────────────────

const NANO_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function nanoId(len = 8) {
  return Array.from({ length: len }, () =>
    NANO_CHARS[Math.floor(Math.random() * NANO_CHARS.length)]
  ).join('');
}

// ── LZ-szerű tömörítés (külső könyvtár nélkül, szótár alapú) ────────────────

function compressPayload(str) {
  // Run-length encoding + ismétlődő szótöredékek cseréje
  // Egyszerű, de hatékony kis méretű JSON payloadra
  let compressed = str;
  // Ismétlődő 4+ karakter substrings tömörítése
  const dict = {};
  let code = 0;
  compressed = compressed.replace(/(.{4,})\1+/g, (match, sub) => {
    if (!dict[sub]) dict[sub] = `§${code++}`;
    return dict[sub];
  });
  return { data: compressed, dict, ratio: str.length / Math.max(1, compressed.length) };
}

function decompressPayload(comp) {
  if (!comp || !comp.data) return comp;
  let result = comp.data;
  if (comp.dict) {
    Object.entries(comp.dict).forEach(([original, code]) => {
      result = result.split(code).join(original);
    });
  }
  return result;
}

// ── AtomBrick ────────────────────────────────────────────────────────────────

class AtomBrick {
  /**
   * @param {string|object} payload – tartalom (string vagy JSON-szerializálható object)
   * @param {object} opts
   *   opts.inetRef  {string}  – internet URL a teljes tartalomhoz
   *   opts.level    {number}  – hierarchia mélység (0 = gyökér)
   *   opts.dir      {string}  – szemantikai irány ('north'|'east'|'south'|'west')
   *   opts.parentId {string}  – anyja brick ID-ja
   */
  constructor(payload, opts = {}) {
    this.id         = nanoId(8);
    this.dir        = opts.dir    || 'east';
    this.level      = opts.level  || 0;
    this.parentId   = opts.parentId || null;
    this.childIds   = [];

    // Tartalom kezelés
    const raw       = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.rawSize    = raw.length;
    this.compressed = compressPayload(raw);
    this.capacity   = Math.min(1, this.rawSize / MINI_CAPACITY);  // telítettség 0–1

    // Internet referencia és QR
    this.inetRef    = opts.inetRef || null;
    this.qrRef      = null;      // /api/qr által generálva
    this.resolved   = false;     // internet feloldás megtörtént-e
    this.offloaded  = false;     // igaz ha payload → qrRef-re tömörítve

    this.created    = Date.now();
    this.accessed   = null;
  }

  /** Kapacitás-telítettség leírás */
  capacityLabel() {
    if (this.capacity < 0.25) return 'ÜRES';
    if (this.capacity < 0.60) return 'RÉSZLEGES';
    if (this.capacity < 0.90) return 'TELI';
    return 'KRITIKUS';
  }

  /** JSON snapshot */
  toJSON() {
    return {
      id:         this.id,
      dir:        this.dir,
      level:      this.level,
      parentId:   this.parentId,
      childIds:   this.childIds,
      rawSize:    this.rawSize,
      capacity:   +this.capacity.toFixed(4),
      capLabel:   this.capacityLabel(),
      inetRef:    this.inetRef,
      qrRef:      this.qrRef,
      resolved:   this.resolved,
      offloaded:  this.offloaded,
      created:    this.created,
      compRatio:  +this.compressed.ratio.toFixed(2),
      preview:    (decompressPayload(this.compressed) || '').slice(0, 80) + '…'
    };
  }
}

// ── AtomLegoCatalog – Registry ───────────────────────────────────────────────

class AtomLegoCatalog {
  constructor() {
    this.bricks = {};   // id → AtomBrick
    this.root   = null; // gyökér brick ID
  }

  /**
   * Új atom brick létrehozása.
   * Ha kapacitás > 1.0 (mini kapacitást meghaladja) → automatikus szétbontás.
   */
  create(payload, opts = {}) {
    const brick = new AtomBrick(payload, opts);
    this.bricks[brick.id] = brick;
    if (!this.root) this.root = brick.id;

    // Automatikus szétbontás ha túl nagy
    if (brick.capacity > 1.0) {
      const n = Math.ceil(brick.capacity);
      return { brick: brick.toJSON(), autoSplit: this.split(brick.id, n) };
    }
    return { brick: brick.toJSON() };
  }

  /**
   * Anyba kantálás – child brick beillesztése parentbe.
   * A parent kapacitása aggregálódik (csökkentett arányban).
   */
  dock(childId, parentId) {
    const child  = this.bricks[childId];
    const parent = this.bricks[parentId];
    if (!child || !parent) return null;
    if (child.parentId) return { error: 'Brick már be van kantálva' };

    child.parentId = parentId;
    parent.childIds.push(childId);
    // Kapacitás megosztás: parent vesz át 30%-ot (anyba befogad)
    parent.capacity = Math.min(1, parent.capacity + child.capacity * 0.30);

    return {
      child:  child.toJSON(),
      parent: parent.toJSON(),
      docked: true
    };
  }

  /**
   * Szétbontás – egy brick n gyermek atomra bontása.
   * A payload egyenlő részekre osztódik, minden rész új brick lesz.
   */
  split(brickId, n = 2, dir = null) {
    const brick   = this.bricks[brickId];
    if (!brick) return null;
    n = Math.min(Math.max(2, n), 16);  // 2–16 gyermek

    const raw     = decompressPayload(brick.compressed) || '';
    const chunkSz = Math.ceil(raw.length / n);
    const children = [];

    for (let i = 0; i < n; i++) {
      const chunk = raw.slice(i * chunkSz, (i + 1) * chunkSz);
      const dirs  = ['north', 'east', 'south', 'west'];
      const childDir = dir || dirs[i % 4];

      const child = new AtomBrick(chunk || `fragment-${i}`, {
        level:    brick.level + 1,
        parentId: brickId,
        dir:      childDir,
        inetRef:  null
      });
      child.qrRef = `lego:${brickId}/${i}`;  // szimbolikus QR hivatkozás
      this.bricks[child.id] = child;
      brick.childIds.push(child.id);
      children.push(child.toJSON());
    }

    // Az eredeti brick zsugorítva lesz (payload → gyermek referenciák)
    brick.offloaded = true;
    brick.capacity  = 0.05;  // szinte üres – csak a referenciák maradnak

    return { parentId: brickId, children, splitCount: n };
  }

  /**
   * QR zsugorítás – a brick tartalmát QR URL hivatkozássá alakítja.
   * Helytakarékos: csak a ~40 karakteres QR URL marad.
   */
  compress(brickId, baseUrl = 'http://localhost:3000') {
    const brick = this.bricks[brickId];
    if (!brick) return null;

    // Rövid URL: /lego/<id> → V1 QR-be férő (~15-20 char + domain)
    const shortUrl = `${baseUrl}/lego/${brick.id}`;
    brick.qrRef    = shortUrl;
    brick.offloaded = true;
    brick.capacity  = 0.02;  // csak a QR maradt

    return {
      id:     brick.id,
      qrRef:  brick.qrRef,
      qrLen:  brick.qrRef.length,
      v1safe: brick.qrRef.length <= QR_V1_MAX,
      saved:  brick.rawSize - brick.qrRef.length
    };
  }

  /**
   * Internet feloldás – brick inetRef URL-jének lekérése.
   * Végtelen tartalom befogadása: a kapott szöveg automatikusan
   * szétbontódik új gyermek brickekre (rekurzív LEGO chain).
   */
  async resolve(brickId, doSplit = true) {
    const brick = this.bricks[brickId];
    if (!brick) return { error: 'Brick nem található' };
    if (!brick.inetRef) return { error: 'Nincs internet referencia' };

    const url = brick.inetRef;
    if (!/^https?:\/\//i.test(url)) return { error: 'Érvénytelen URL (csak http/https)' };

    brick.accessed = Date.now();

    try {
      const content = await fetchUrl(url);
      brick.resolved = true;

      // Tartalom befogadása: ha nagy → automatikus szétbontás (LEGO chain)
      const newPayload = content.slice(0, MAX_RESOLVE_SIZE);
      const newBrick   = new AtomBrick(newPayload, {
        level:    brick.level + 1,
        parentId: brickId,
        dir:      brick.dir,
        inetRef:  null
      });
      newBrick.qrRef = `resolved:${brick.id}`;
      this.bricks[newBrick.id] = newBrick;
      brick.childIds.push(newBrick.id);

      const splitResult = doSplit && newBrick.capacity > 0.5
        ? this.split(newBrick.id, Math.min(8, Math.ceil(newBrick.capacity * 4)))
        : null;

      return {
        brickId:      brickId,
        resolvedId:   newBrick.id,
        contentLen:   content.length,
        fetched:      newPayload.length,
        autoSplit:    splitResult,
        preview:      newPayload.slice(0, 120) + (newPayload.length > 120 ? '…' : '')
      };
    } catch (err) {
      return { error: `Internet feloldás sikertelen: ${err.message}` };
    }
  }

  /** Brick fa lekérése (hierarchikus JSON) */
  getTree(brickId = null) {
    const rootId = brickId || this.root;
    if (!rootId) return null;

    const buildNode = (id, visited = new Set()) => {
      if (visited.has(id)) return null;
      visited.add(id);
      const b = this.bricks[id];
      if (!b) return null;
      return {
        ...b.toJSON(),
        children: b.childIds.map(cid => buildNode(cid, visited)).filter(Boolean)
      };
    };
    return buildNode(rootId);
  }

  /** Katalógus összesítő */
  summary() {
    const all     = Object.values(this.bricks);
    const active  = all.filter(b => !b.offloaded);
    const offload = all.filter(b => b.offloaded);
    const inetResolved = all.filter(b => b.resolved);
    const totalSize = all.reduce((s, b) => s + b.rawSize, 0);

    return {
      totalBricks: all.length,
      activeBricks: active.length,
      offloadedBricks: offload.length,
      resolvedBricks: inetResolved.length,
      totalRawBytes: totalSize,
      avgCapacity: all.length
        ? +(all.reduce((s, b) => s + b.capacity, 0) / all.length).toFixed(4)
        : 0,
      maxDepth: all.length ? Math.max(...all.map(b => b.level)) : 0,
      root: this.root,
      bricks: all.map(b => b.toJSON())
    };
  }
}

// ── Internet feloldó (http/https) ────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib     = url.startsWith('https') ? https : http;
    const timeout = setTimeout(() => reject(new Error('Időtúllépés')), FETCH_TIMEOUT_MS);
    const req     = lib.get(url, { headers: { 'User-Agent': 'FreeTranslator/2.1 AtomLego' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > MAX_RESOLVE_SIZE) req.abort();
      });
      res.on('end', () => { clearTimeout(timeout); resolve(data); });
      res.on('error', err => { clearTimeout(timeout); reject(err); });
    });
    req.on('error', err => { clearTimeout(timeout); reject(err); });
  });
}

// ── Singleton katalógus ───────────────────────────────────────────────────────

const catalog = new AtomLegoCatalog();

module.exports = { AtomBrick, AtomLegoCatalog, catalog, nanoId, fetchUrl };
