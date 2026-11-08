// Draws the engine's display lists (Packages/CricketKit/Sources/CricketWebCore/DisplayListCodec.swift)
// on a 2D canvas.
const caps = ['butt', 'round', 'square'];
const joins = ['miter', 'round', 'bevel'];
const blends = ['source-over', 'screen', 'lighter', 'multiply'];
const filters = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    return 'filter' in c;
  } catch {
    return false;
  }
})();

const css = (r, g, b, a) => `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;

export function drawList(ctx, f, start = 0, end = f.length) {
  let i = start;
  function paint() {
    const kind = f[i++];
    if (kind === 0) {
      const s = css(f[i], f[i + 1], f[i + 2], f[i + 3]);
      i += 4;
      return s;
    }
    const n = f[i++];
    const stops = [];
    for (let k = 0; k < n; k++) {
      stops.push([f[i + 4], css(f[i], f[i + 1], f[i + 2], f[i + 3])]);
      i += 5;
    }
    let g;
    if (kind === 1) {
      g = ctx.createLinearGradient(f[i], f[i + 1], f[i + 2], f[i + 3]);
      i += 4;
    } else {
      g = ctx.createRadialGradient(f[i], f[i + 1], 0, f[i], f[i + 1], Math.max(0.01, f[i + 2]));
      i += 3;
    }
    for (const [loc, color] of stops) g.addColorStop(Math.min(1, Math.max(0, loc)), color);
    return g;
  }
  function path() {
    const p = new Path2D();
    const n = f[i++];
    for (let k = 0; k < n; k++) {
      switch (f[i++]) {
        case 0: p.moveTo(f[i], f[i + 1]); i += 2; break;
        case 1: p.lineTo(f[i], f[i + 1]); i += 2; break;
        case 2: p.quadraticCurveTo(f[i], f[i + 1], f[i + 2], f[i + 3]); i += 4; break;
        case 3: p.bezierCurveTo(f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]); i += 6; break;
        default: p.closePath();
      }
    }
    return p;
  }
  while (i < end) {
    const op = f[i++];
    if (op === 1) {
      const style = paint();
      const p = path();
      ctx.fillStyle = style;
      ctx.fill(p);
    } else if (op === 2) {
      const style = paint();
      ctx.lineWidth = f[i++];
      ctx.lineCap = caps[f[i++]];
      ctx.lineJoin = joins[f[i++]];
      const dashes = f[i++];
      const dash = [];
      for (let k = 0; k < dashes; k++) dash.push(f[i++]);
      ctx.lineDashOffset = f[i++];
      if (dashes) ctx.setLineDash(dash);
      const p = path();
      ctx.strokeStyle = style;
      ctx.stroke(p);
      if (dashes) ctx.setLineDash([]);
    } else if (op === 3) {
      const x = f[i], y = f[i + 1], size = f[i + 2], weight = f[i + 3];
      const color = css(f[i + 4], f[i + 5], f[i + 6], f[i + 7]);
      const tracking = f[i + 8];
      const n = f[i + 9];
      i += 10;
      let s = '';
      for (let k = 0; k < n; k++) s += String.fromCharCode(f[i++]);
      ctx.font = `${weight} ${size}px ui-rounded, "SF Pro Rounded", -apple-system, system-ui, "Segoe UI", sans-serif`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking}px`;
      ctx.fillText(s, x, y);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    } else if (op === 4) {
      const opacity = f[i++], blend = f[i++], blur = f[i++], clipped = f[i++];
      ctx.save();
      if (clipped) ctx.clip(path());
      ctx.globalAlpha *= opacity;
      ctx.globalCompositeOperation = blends[blend] || 'source-over';
      if (blur > 0.01 && filters) ctx.filter = `blur(${blur / 2}px)`;
    } else if (op === 5) {
      ctx.restore();
    } else {
      return;
    }
  }
}
