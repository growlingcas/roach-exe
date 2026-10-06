# Custom inscriptional capitals for the PRAY wordmark (cap height 100). Pure outlines, no fonts.
T, t, SW, SH = 15, 5.2, 8, 3.4

def poly(pts): return "M" + " L".join(f"{a:.2f},{b:.2f}" for a, b in pts) + " Z"

def serif(x0, x1, y, top=False, sl=None, sr=None, f=6):
    """Slab serif; if stem edges sl/sr are given, add curved fillets into the stem."""
    s = 1 if top else -1  # direction into the letter
    y1 = y + s * SH
    if sl is None:
        return poly([(x0, y), (x1, y), (x1, y1), (x0, y1)])
    return (f"M{x0},{y} L{x1},{y} L{x1},{y1} Q{sr},{y1} {sr},{y1 + s*f} L{sl},{y1 + s*f} Q{sl},{y1} {x0},{y1} Z")

def stem(x, y0, y1, w=T): return poly([(x, y0), (x + w, y0), (x + w, y1), (x, y1)])

def bowl(x, b, reach, cw):
    """D-shaped bowl attached to a stem at x; thick on the right (cw), hairline top/bottom (t). evenodd."""
    o = f"M{x},0 L{x+reach*0.45},0 C{x+reach*1.07},0 {x+reach*1.07},{b} {x+reach*0.45},{b} L{x},{b} Z"
    ir = reach - cw
    i = f"M{x},{t} L{x+ir*0.48},{t} C{x+ir*1.05},{t} {x+ir*1.05},{b-t} {x+ir*0.48},{b-t} L{x},{b-t} Z"
    return o + " " + i

def P(ox):
    x = ox + SW
    parts = [(stem(x, 0, 100), 'nonzero'), (bowl(x + T - 0.5, 57, 44, 14), 'evenodd'),
             (serif(x - SW, x + T + SW, 100, sl=x, sr=x + T), 'nonzero'), (serif(x - SW, x + T, 0, True, sl=x, sr=x + T), 'nonzero')]
    return parts, SW + T + 44 + 4

def R(ox):
    x = ox + SW
    b = 53
    leg = poly([(x + T + 10, b - 3), (x + T + 26, b - 3), (x + T + 49, 100), (x + T + 32, 100)])
    parts = [(stem(x, 0, 100), 'nonzero'), (bowl(x + T - 0.5, b, 42, 13.5), 'evenodd'), (leg, 'nonzero'),
             (serif(x - SW, x + T + SW, 100, sl=x, sr=x + T), 'nonzero'), (serif(x - SW, x + T, 0, True, sl=x, sr=x + T), 'nonzero'),
             (serif(x + T + 29, x + T + 56, 100), 'nonzero')]
    return parts, SW + T + 56

def A(ox):
    x = ox + SW
    w = 76; ap = x + w / 2
    left = poly([(ap - 2.2, -4), (ap + 1.8, -4), (x + t + 1.5, 100), (x + 1.5, 100)])
    right = poly([(ap - 2.2, -4), (ap + 2.6, -4), (x + w - 1, 100), (x + w - T - 3, 100)])
    yb = 67
    bar = poly([(x + 16, yb), (x + w - 15, yb), (x + w - 14, yb + t), (x + 15, yb + t)])
    parts = [(left, 'nonzero'), (right, 'nonzero'), (bar, 'nonzero'),
             (serif(x - SW + 2, x + t + 10, 100), 'nonzero'), (serif(x + w - T - 11, x + w + SW - 2, 100), 'nonzero')]
    return parts, SW * 2 + w

def Y(ox):
    x = ox + SW
    w = 74; mid = x + w / 2; j = 52
    left = poly([(x + 1, 0), (x + T + 3, 0), (mid + T / 2, j + 1), (mid - T / 2, j + 1)])
    right = poly([(x + w - t - 1.5, 0), (x + w - 1, 0), (mid + T / 2, j), (mid + T / 2 - t - 1.5, j)])
    parts = [(left, 'nonzero'), (right, 'nonzero'), (stem(mid - T / 2, j, 100), 'nonzero'),
             (serif(x - SW + 3, x + T + SW + 2, 0, True), 'nonzero'), (serif(x + w - t - 9, x + w + SW - 3, 0, True), 'nonzero'),
             (serif(mid - T / 2 - SW, mid + T / 2 + SW, 100, sl=mid - T / 2, sr=mid + T / 2), 'nonzero')]
    return parts, SW * 2 + w

def wordmark(track=14):
    out, x = [], 0
    for g in (P, R, A, Y):
        parts, adv = g(x); out += parts; x += adv + track
    return out, x - track

def paths(parts, fill):
    return "".join(f'<path d="{d}" fill="{fill}" fill-rule="{r}"/>' for d, r in parts)
