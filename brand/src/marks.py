# Three PRAY mark concepts on a 200×200 grid. Returns list of (d, fill-rule).
import glyphs
def spear():
    # leaf blade with a fuller, collar, short shaft
    blade_o = "M100,10 C122,48 128,82 112,112 L100,124 L88,112 C72,82 78,48 100,10 Z"
    fuller  = "M100,34 C106,58 107,82 102,104 L100,108 L98,104 C93,82 94,58 100,34 Z"
    collar = "M84,128 L116,128 L116,136 L84,136 Z M88,140 L112,140 L112,145 L88,145 Z"
    shaft = "M95,145 L105,145 L105,192 L95,192 Z"
    return [(blade_o + " " + fuller, 'evenodd'), (collar, 'nonzero'), (shaft, 'nonzero')]
def eye():
    # almond eye; pupil is a vertical spear blade
    outer = "M8,100 C48,40 152,40 192,100 C152,160 48,160 8,100 Z"
    inner = "M26,100 C62,56 138,56 174,100 C138,144 62,144 26,100 Z"
    pupil = "M100,46 C114,70 118,88 110,110 L100,154 L90,110 C82,88 86,70 100,46 Z"
    return [(outer + " " + inner, 'evenodd'), (pupil, 'nonzero')]
def column_p():
    # P monogram: stem is a fluted column with capital and base; classical bowl
    cap = "M52,14 L108,14 L104,24 L56,24 Z"
    base = "M52,186 L108,186 L104,176 L56,176 Z"
    col = "M60,24 L100,24 L100,176 L60,176 Z M67,30 L71,30 L71,170 L67,170 Z M78,30 L82,30 L82,170 L78,170 Z M89,30 L93,30 L93,170 L89,170 Z"
    bowl = "M100,24 L122,24 C168,24 168,108 122,108 L100,108 L100,96 L120,96 C150,96 150,36 120,36 L100,36 Z"
    return [(cap, 'nonzero'), (base, 'nonzero'), (col, 'evenodd'), (bowl, 'nonzero')]
CONCEPTS = [('I · Spear', 'The weapon of the believer. A single vertical blade.', spear), ('II · Oracle', 'The eye that weighs your record, with a spear for a pupil.', eye), ('III · Column', 'A P carved as a temple column. Weight and order.', column_p)]
def svg(parts, fill, bg=None, size=200, pad=0):
    v = f"{-pad} {-pad} {200+2*pad} {200+2*pad}"
    r = f'<rect x="{-pad}" y="{-pad}" width="{200+2*pad}" height="{200+2*pad}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{v}" width="{size}" height="{size}">{r}{glyphs.paths(parts, fill)}</svg>'
