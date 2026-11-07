/**
 * Tabletop board renderer on PixiJS. Draws raised pieces (a dark side under each coloured top face), seat badges with
 * pip bars, small regions enlarged in place with a halo, and lifts the selected piece. It only draws: the game decides
 * colours through setStyles and reacts to taps through onTap.
 */
import { Application, Container, Graphics, Text } from "pixi.js";
import { layoutBoard, type BadgeLayout, type BoardLayout, type LayoutOptions, type PieceLayout } from "./layout.js";
import { CREAM, EMPTY, GOLD, GREY_LAND, INK } from "./palette.js";
import { parseRings, parseShapes, type Shape } from "./path.js";
import type { BoardData, Point, RegionStyle } from "./types.js";

export interface BoardViewOptions extends LayoutOptions {
  /** Turns the map (degrees) to fit the screen better; text stays upright. Pakistan uses 30. */
  rotate?: number;
  /** Height of the raised pieces in board units. */
  depth?: number;
  /** Border width between regions in board units. */
  lineWidth?: number;
  /** Fraction of the canvas left empty around the board. */
  margin?: number;
}

const FONT = ["Lilita One", "Arial Black", "sans-serif"];
const LIFT = 7;

export class BoardView {
  readonly app: Application;
  readonly board: BoardData;
  readonly layout: BoardLayout;
  private readonly opts: Required<Pick<BoardViewOptions, "rotate" | "depth" | "lineWidth" | "margin">>;
  private readonly world = new Container();
  private readonly geo = new Container();
  /** Everything that only changes with styles or size: drawn once into a texture. */
  private readonly base = new Container();
  private readonly marks = new Container();
  private readonly faces = new Map<string, Graphics>();
  private readonly enlarged = new Map<string, Graphics>();
  private readonly badgeViews = new Map<string, { root: Container; bar: Graphics; flags: Graphics; text: Text; layout: BadgeLayout }>();
  private readonly lift = new Container();
  private readonly liftShadow = new Graphics();
  private readonly liftFace = new Graphics();
  private styles: Record<string, RegionStyle> = {};
  private selected: string | null = null;
  private liftY = 0;
  private tapHandlers: ((id: string) => void)[] = [];
  private frameQueued = false;
  private renders: number[] = [];
  private cached = false;
  private readonly cx: number;
  private readonly cy: number;

  private constructor(app: Application, board: BoardData, opts: BoardViewOptions) {
    this.app = app;
    this.board = board;
    this.opts = { rotate: opts.rotate ?? 0, depth: opts.depth ?? 5, lineWidth: opts.lineWidth ?? 1.4, margin: opts.margin ?? 0.03 };
    this.layout = layoutBoard(board, opts);
    this.cx = board.width / 2;
    this.cy = board.height / 2;
    this.geo.pivot.set(this.cx, this.cy);
    this.geo.position.set(this.cx, this.cy);
    this.geo.rotation = (this.opts.rotate * Math.PI) / 180;
    this.world.addChild(this.geo, this.marks);
    this.geo.addChild(this.base);
    app.stage.addChild(this.world);
    this.drawStatic();
    this.drawBadges();
    this.lift.addChild(this.liftShadow, this.liftFace);
    this.lift.visible = false;
    this.geo.addChild(this.lift);
    app.renderer.on("resize", () => this.fit());
    this.fit();
  }

  /** Creates a board inside a parent element; the canvas follows the parent's size. */
  static async create(parent: HTMLElement, board: BoardData, opts: BoardViewOptions = {}): Promise<BoardView> {
    const app = new Application();
    await app.init({
      resizeTo: parent,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio ?? 1),
      preference: "webgl",
      // No render loop: the board draws only when something changes (see invalidate), which saves battery.
      autoStart: false,
    });
    parent.appendChild(app.canvas);
    return new BoardView(app, board, opts);
  }

  onTap(handler: (id: string) => void): void {
    this.tapHandlers.push(handler);
  }

  /** Colours, pip bars and markers for every region. Regions without a style stay unpainted. */
  setStyles(styles: Record<string, RegionStyle>): void {
    this.styles = styles;
    for (const p of this.layout.pieces) {
      const fill = styles[p.id]?.fill ?? EMPTY;
      this.paint(this.faces.get(p.id)!, p.shapes, fill, this.opts.lineWidth);
      const big = this.enlarged.get(p.id);
      if (big) this.paint(big, p.shapes, fill, this.opts.lineWidth / p.enlarge!.k + 0.4);
    }
    for (const [id, v] of this.badgeViews) this.drawBadgeExtras(v.bar, v.flags, v.layout, styles[id]);
    if (this.selected) this.drawLift(this.selected);
    if (this.cached) {
      this.base.updateCacheTexture();
      this.marks.updateCacheTexture();
    }
    this.invalidate();
  }

  /** Lifts a region (or drops the lifted one with null). */
  select(id: string | null): void {
    if (id !== null && !this.faces.has(id)) throw new Error(`Unknown region "${id}"`);
    this.selected = id;
    this.liftY = 0;
    if (id) this.drawLift(id);
    this.lift.visible = id !== null;
    this.invalidate();
  }

  /** Asks for one redraw on the next animation frame; frames keep coming only while something is animating. */
  invalidate(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => this.frame());
  }

  private frame() {
    this.frameQueued = false;
    const animating = this.animate();
    this.app.render();
    const now = performance.now();
    this.renders.push(now);
    while (this.renders.length > 0 && now - this.renders[0]! > 1000) this.renders.shift();
    if (animating) this.invalidate();
  }

  get selection(): string | null {
    return this.selected;
  }

  /** Where a region's badge (or label) is on the page, in CSS pixels relative to the canvas. For tests and tutorials. */
  screenPoint(id: string): Point {
    const b = this.badgeViews.get(id);
    const region = this.board.regions.find((r) => r.id === id);
    if (!region) throw new Error(`Unknown region "${id}"`);
    const local = b ? { x: b.root.x, y: b.root.y } : this.rotated(region.label[0], region.label[1]);
    return this.world.toGlobal(local);
  }

  /** Where a region's own piece is on the page (its label point), for tapping the piece rather than its badge. */
  piecePoint(id: string): Point {
    const p = this.layout.pieces.find((x) => x.id === id);
    const region = this.board.regions.find((r) => r.id === id);
    if (!p || !region) throw new Error(`Unknown region "${id}"`);
    const local = p.enlarge ? { x: p.enlarge.cx, y: p.enlarge.cy } : { x: region.label[0], y: region.label[1] };
    return this.geo.toGlobal(local);
  }

  /** Frames drawn in the last second. 0 while the board is idle, since nothing is redrawn then. */
  get fps(): number {
    const now = performance.now();
    return this.renders.filter((t) => now - t <= 1000).length;
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }

  private rotated(x: number, y: number): Point {
    const t = this.geo.rotation;
    if (!t) return { x, y };
    const dx = x - this.cx, dy = y - this.cy;
    return { x: this.cx + dx * Math.cos(t) - dy * Math.sin(t), y: this.cy + dx * Math.sin(t) + dy * Math.cos(t) };
  }

  private tap(id: string) {
    for (const h of this.tapHandlers) h(id);
  }

  private trace(g: Graphics, shapes: Shape[]) {
    for (const s of shapes) {
      g.poly(s.outer, true);
      for (const h of s.holes) g.poly(h, true);
    }
  }

  private paint(g: Graphics, shapes: Shape[], fill: number, width: number) {
    g.clear();
    for (const s of shapes) {
      g.poly(s.outer, true).fill({ color: fill });
      for (const h of s.holes) g.poly(h, true).cut();
    }
    this.trace(g, shapes);
    g.stroke({ width, color: INK, join: "round" });
  }

  private drawStatic() {
    const { depth } = this.opts;
    // The dark sides of the raised pieces: every shape again, pushed down.
    const sides = new Graphics();
    for (const p of this.layout.pieces) for (const s of p.shapes) sides.poly(s.outer.map((v, i) => (i % 2 ? v + depth : v)), true);
    sides.fill({ color: INK });
    this.base.addChild(sides);

    if (this.board.greyed) {
      const grey = new Graphics();
      for (const s of parseShapes(this.board.greyed.d)) {
        grey.poly(s.outer.map((v, i) => (i % 2 ? v + depth : v)), true).fill({ color: INK, alpha: 0.5 });
      }
      for (const s of parseShapes(this.board.greyed.d)) grey.poly(s.outer, true).fill({ color: GREY_LAND }).stroke({ width: this.opts.lineWidth, color: INK, alpha: 0.6 });
      this.base.addChild(grey);
    }

    for (const p of this.layout.pieces) {
      const g = new Graphics();
      this.makeTappable(g, p.id);
      this.faces.set(p.id, g);
      this.base.addChild(g);
    }

    if (this.board.areaBorders) {
      const borders = new Graphics();
      for (const line of parseRings(this.board.areaBorders + "Z")) {
        borders.moveTo(line[0]!, line[1]!);
        for (let i = 2; i < line.length; i += 2) borders.lineTo(line[i]!, line[i + 1]!);
      }
      borders.stroke({ width: this.opts.lineWidth * 3.2, color: INK, join: "round", cap: "round" });
      borders.eventMode = "none";
      this.base.addChild(borders);
    }

    // Small regions drawn again, enlarged in place, with a cream halo so they read as separate pieces.
    for (const p of this.layout.pieces) {
      if (!p.enlarge) continue;
      const { cx, cy, k } = p.enlarge;
      const holder = new Container();
      holder.pivot.set(cx, cy);
      holder.position.set(cx, cy);
      holder.scale.set(k);
      const halo = new Graphics();
      this.trace(halo, p.shapes);
      halo.stroke({ width: 7 / k, color: CREAM, join: "round" });
      const side = new Graphics();
      for (const s of p.shapes) side.poly(s.outer.map((v, i) => (i % 2 ? v + depth / k : v)), true);
      side.fill({ color: INK });
      const face = new Graphics();
      this.makeTappable(face, p.id);
      this.enlarged.set(p.id, face);
      holder.addChild(halo, side, face);
      this.base.addChild(holder);
    }
    this.setStyles({});
  }

  private makeTappable(g: Graphics, id: string) {
    g.eventMode = "static";
    g.cursor = "pointer";
    g.on("pointertap", () => this.tap(id));
  }

  private drawBadges() {
    const lines = new Graphics();
    for (const b of this.layout.badges) {
      if (!b.leader) continue;
      const a = this.rotated(b.anchor[0], b.anchor[1]);
      const p = this.rotated(b.x, b.y);
      lines.moveTo(a.x, a.y).lineTo(p.x, p.y);
      lines.circle(a.x, a.y, 1.8);
    }
    lines.stroke({ width: 1.6, color: INK, cap: "round" });
    this.marks.addChild(lines);

    for (const b of this.layout.badges) {
      const root = new Container();
      const pos = this.rotated(b.x, b.y);
      root.position.set(pos.x, pos.y);
      const disc = new Graphics().circle(0, 0, b.r).fill({ color: CREAM }).stroke({ width: Math.max(1.4, b.r * 0.16), color: INK });
      const text = new Text({ text: String(b.seats), style: { fontFamily: FONT, fontSize: b.r * 1.05, fill: INK, fontWeight: "900" } });
      text.anchor.set(0.5, 0.52);
      text.resolution = 3;
      const bar = new Graphics();
      const flags = new Graphics();
      root.addChild(disc, text, bar, flags);
      root.eventMode = "static";
      root.cursor = "pointer";
      root.on("pointertap", () => this.tap(b.id));
      this.marks.addChild(root);
      this.badgeViews.set(b.id, { root, bar, flags, text, layout: b });
    }
  }

  private drawBadgeExtras(bar: Graphics, flags: Graphics, b: BadgeLayout, style: RegionStyle | undefined) {
    bar.clear();
    flags.clear();
    const shares = (style?.shares ?? []).filter((s) => s.share > 0).slice(0, 3);
    if (shares.length > 0) {
      const w = b.r * 1.9, h = Math.max(3, b.r * 0.3), y = b.r + 1.5;
      const total = shares.reduce((a, s) => a + s.share, 0);
      let x = -w / 2;
      bar.roundRect(-w / 2 - 1, y - 1, w + 2, h + 2, 2).fill({ color: INK });
      for (const s of shares) {
        const sw = (w * s.share) / total;
        bar.rect(x, y, sw, h).fill({ color: s.color });
        x += sw;
      }
    }
    if (style?.member) flags.circle(b.r * 0.75, -b.r * 0.75, b.r * 0.32).fill({ color: GOLD }).stroke({ width: 1.2, color: INK });
    if (style?.locked) {
      flags.circle(-b.r * 0.78, -b.r * 0.72, b.r * 0.34).fill({ color: INK });
      flags.moveTo(-b.r * 0.92, -b.r * 0.72).lineTo(-b.r * 0.8, -b.r * 0.6).lineTo(-b.r * 0.62, -b.r * 0.86).stroke({ width: 1.4, color: CREAM, cap: "round" });
    }
  }

  private drawLift(id: string) {
    const p = this.layout.pieces.find((x) => x.id === id) as PieceLayout;
    const fill = this.styles[id]?.fill ?? EMPTY;
    const k = p.enlarge?.k ?? 1;
    const shapes = p.enlarge
      ? p.shapes.map((s) => ({ outer: this.scaleRing(s.outer, p.enlarge!), holes: s.holes.map((h) => this.scaleRing(h, p.enlarge!)) }))
      : p.shapes;
    // A soft shadow on the table, then the piece's dark side stacked up to where the lifted face sits.
    this.liftShadow.clear();
    const at = (dy: number) => {
      for (const s of shapes) this.liftShadow.poly(s.outer.map((v, i) => (i % 2 ? v + dy : v)), true);
    };
    at(this.opts.depth + 4);
    this.liftShadow.fill({ color: INK, alpha: 0.28 });
    for (let dy = this.opts.depth; dy > -LIFT; dy -= 1.5) at(dy);
    this.liftShadow.fill({ color: INK });
    this.paint(this.liftFace, shapes, fill, this.opts.lineWidth);
    this.trace(this.liftFace, shapes);
    this.liftFace.stroke({ width: (this.opts.lineWidth * 2.2) / Math.sqrt(k), color: GOLD, join: "round", alignment: 1 });
    this.makeTappableOnce(this.liftFace, id);
  }

  private scaleRing(r: number[], e: { cx: number; cy: number; k: number }): number[] {
    return r.map((v, i) => (i % 2 ? e.cy + (v - e.cy) * e.k : e.cx + (v - e.cx) * e.k));
  }

  private makeTappableOnce(g: Graphics, id: string) {
    g.removeAllListeners("pointertap");
    this.makeTappable(g, id);
  }

  /** Eases the lifted piece up. Returns true while it is still moving. */
  private animate(): boolean {
    if (!this.selected) return false;
    this.liftY += (LIFT - this.liftY) * 0.3;
    if (LIFT - this.liftY < 0.05) this.liftY = LIFT;
    this.liftFace.y = -this.liftY;
    return this.liftY < LIFT;
  }

  /** Scales and centres the (possibly rotated) board in the canvas. */
  private fit() {
    const pts = parseRings(this.board.outline).flatMap((r) => {
      const out: Point[] = [];
      for (let i = 0; i < r.length; i += 2) out.push(this.rotated(r[i]!, r[i + 1]!));
      return out;
    });
    for (const b of this.badgeViews.values()) out(b.root.x, b.root.y, b.layout.r);
    function out(x: number, y: number, r: number) {
      pts.push({ x: x - r, y: y - r }, { x: x + r, y: y + r + r * 0.6 });
    }
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y)) + this.opts.depth;
    const W = this.app.screen.width, H = this.app.screen.height;
    const m = this.opts.margin;
    const s = Math.min((W * (1 - 2 * m)) / (x1 - x0), (H * (1 - 2 * m)) / (y1 - y0));
    this.world.scale.set(s);
    this.world.position.set((W - (x1 - x0) * s) / 2 - x0 * s, (H - (y1 - y0) * s) / 2 - y0 * s);
    // Re-draw the cached layers at the new size so they stay sharp.
    const res = Math.min(4, Math.max(0.5, s * this.app.renderer.resolution));
    for (const c of [this.base, this.marks]) {
      if (this.cached) c.cacheAsTexture(false);
      c.cacheAsTexture({ resolution: res, antialias: true });
    }
    this.cached = true;
    this.invalidate();
  }
}
