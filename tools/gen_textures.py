"""절차적 타일 텍스처 생성 (힉스필드 MCP 대체).

모든 노이즈를 '주기적(토러스)'으로 만들어 처음부터 이음새가 없게 한다.
각 텍스처: basecolor(sRGB) + normal + roughness (+ 필요시 emissive).
생성 후 2x2 미리보기와 seam ratio(경계 대비 / 내부 대비)를 출력한다.

실행: python3 tools/gen_textures.py [출력폴더=textures]
"""
import sys, os
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'textures'
PREVIEW = os.environ.get('PREVIEW_DIR', OUT + '/_preview')
S = 1024
rng = np.random.default_rng(7)
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

yy, xx = (np.mgrid[0:S, 0:S].astype(np.float32) + 0.5) / S  # 픽셀 중심 좌표 → 판 경계가 픽셀 사이에 대칭으로 온다


def smooth(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def value_noise(freq):
    """주기 freq의 값 노이즈 (0..1). 격자를 wrap하므로 경계가 이어진다."""
    g = rng.random((freq, freq)).astype(np.float32)
    x, y = xx * freq, yy * freq
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = smooth(x - x0), smooth(y - y0)
    x0 %= freq; y0 %= freq
    x1, y1 = (x0 + 1) % freq, (y0 + 1) % freq
    a = g[y0, x0] * (1 - fx) + g[y0, x1] * fx
    b = g[y1, x0] * (1 - fx) + g[y1, x1] * fx
    return a * (1 - fy) + b * fy


def fbm(base, octaves=5, gain=0.5):
    total, amp, norm = 0, 1.0, 0
    for o in range(octaves):
        total = total + value_noise(base * 2 ** o) * amp
        norm += amp; amp *= gain
    return total / norm


def worley(cells):
    """주기적 셀룰러 노이즈: (F1, F2, 셀 id) — 균열·돌 모양."""
    pts = rng.random((cells, cells, 2)).astype(np.float32)
    ids = rng.random((cells, cells)).astype(np.float32)
    x, y = xx * cells, yy * cells
    cx, cy = np.floor(x).astype(int), np.floor(y).astype(int)
    f1 = np.full((S, S), 9.0, np.float32); f2 = f1.copy(); idv = np.zeros((S, S), np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx, ny = cx + dx, cy + dy
            p = pts[ny % cells, nx % cells]
            d = np.hypot(nx + p[..., 0] - x, ny + p[..., 1] - y)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idv = np.where(closer, ids[ny % cells, nx % cells], idv)
            f1 = np.where(closer, d, f1)
    return f1, f2, idv


def normal_from_height(h, strength):
    """주기 경계를 고려한 (np.roll) 높이 → 탄젠트 노멀."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def lerp_col(a, b, t):
    a, b = np.array(a, np.float32) / 255, np.array(b, np.float32) / 255
    return a + (b - a) * t[..., None]


def save(name, arr, mode='RGB'):
    arr = np.clip(arr, 0, 1)
    img = Image.fromarray((arr * 255 + 0.5).astype(np.uint8), mode if arr.ndim == 3 else 'L')
    img.save(f'{OUT}/{name}.png', optimize=True)
    return img


def seam_ratio(img, period=None):
    """2x2로 붙였을 때 경계선 대비 / 내부 기준 대비. 1.0에 가까울수록 이음새 없음.
    판넬처럼 경계가 일부러 홈 위에 오는 텍스처는 period(판 크기 px)를 주어
    '같은 구조 위치(내부 판 경계)'와 비교한다."""
    a = np.asarray(img.convert('L'), np.float32)
    if period:
        px, py = period if isinstance(period, tuple) else (period, period)
        interior_x = np.mean([np.abs(a[:, c] - a[:, c - 1]).mean() for c in range(px, a.shape[1], px)])
        interior_y = np.mean([np.abs(a[r, :] - a[r - 1, :]).mean() for r in range(py, a.shape[0], py)])
    else:
        interior_x = np.abs(np.diff(a, axis=1)).mean()
        interior_y = np.abs(np.diff(a, axis=0)).mean()
    seam_x = np.abs(a[:, -1] - a[:, 0]).mean()
    seam_y = np.abs(a[-1, :] - a[0, :]).mean()
    eps = 1e-3  # 완전히 평탄한 맵(경계·내부 모두 0) 대비
    return max((seam_x + eps) / (interior_x + eps), (seam_y + eps) / (interior_y + eps))


def preview(name, img):
    w, h = img.size
    t = Image.new(img.mode, (w * 2, h * 2))
    for x in (0, w):
        for y in (0, h):
            t.paste(img, (x, y))
    t.resize((w, h)).save(f'{PREVIEW}/{name}_tiled2x2.png')


report = []


def finish(name, color, height, rough, nstrength, emissive=None, period=None):
    imgs = {
        'basecolor': save(f'{name}_basecolor', color),
        'normal': save(f'{name}_normal', normal_from_height(height, nstrength)),
        'roughness': save(f'{name}_roughness', rough),
    }
    if emissive is not None:
        imgs['emissive'] = save(f'{name}_emissive', emissive)
    for k, im in imgs.items():
        r = seam_ratio(im, period)
        report.append((f'{name}_{k}', r))
    preview(name, imgs['basecolor'])


# ── 1. 석판 바닥: 4x4 판석 (한 장 = 보드 4x4칸), 판 사이 홈 + 미세 균열
def floor():
    panels = 4
    u, v = (xx * panels) % 1, (yy * panels) % 1
    edge = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))   # 판 가장자리까지 거리
    groove = np.clip(edge / 0.035, 0, 1)                              # 홈 (0=홈)
    bevel = np.clip(edge / 0.09, 0, 1)
    pid = np.floor(xx * panels) + np.floor(yy * panels) * panels
    tone = (np.sin(pid * 12.9898) * 43758.5453) % 1                  # 판마다 약간 다른 톤
    n = fbm(8, 6)
    f1, f2, _ = worley(10)
    crack = np.clip((f2 - f1) / 0.035, 0, 1)                          # 0=균열
    crack = 1 - (1 - crack) * (fbm(4, 3) > 0.52)                      # 균열은 일부만
    t = np.clip(0.35 + (n - 0.5) * 0.9 + (tone - 0.5) * 0.10, 0, 1)
    col = lerp_col((44, 49, 58), (86, 92, 102), t)                    # 차가운 무채색 현무암
    col *= (0.55 + 0.45 * groove)[..., None] * (0.82 + 0.18 * crack)[..., None]
    height = 0.6 * bevel + 0.25 * n + 0.15 * crack
    rough = 0.72 + 0.2 * (1 - groove) + (n - 0.5) * 0.15
    finish('floor', col, height, rough, 3.0, period=S // panels)


# ── 2. 용암 균열 길: 검붉은 암반 + 발광 균열
def path():
    n = fbm(6, 6)
    f1, f2, cid = worley(7)
    vein = 1 - np.clip((f2 - f1) / 0.06, 0, 1)                        # 1=균열 중심
    vein = vein ** 1.6
    warm = fbm(3, 3)
    rock = lerp_col((26, 16, 20), (66, 40, 44), np.clip(n * 1.2 - 0.1 + cid * 0.2, 0, 1))
    glow = lerp_col((150, 30, 20), (255, 120, 40), np.clip(warm, 0, 1))
    col = rock * (1 - vein[..., None]) + glow * vein[..., None] * 0.7
    emis = glow * (vein ** 1.3)[..., None]
    height = 0.7 * (1 - vein) * (0.5 + 0.5 * n)
    rough = 0.85 - 0.45 * vein
    finish('path', col, height, rough, 4.0, emis)


# ── 3. 바깥 지면: 거친 흙 + 자갈
def ground():
    n = fbm(5, 6)
    f1, f2, cid = worley(24)
    pebble = np.clip(1 - f1 / 0.35, 0, 1) * (cid > 0.55)
    t = np.clip(n * 1.1 - 0.05, 0, 1)
    col = lerp_col((22, 25, 32), (48, 52, 60), t)
    stone = lerp_col((36, 39, 46), (50, 54, 62), cid)   # 자갈은 바탕보다 조금만 밝게 (멀리서 별처럼 보이지 않게)
    col = col * (1 - pebble[..., None]) + stone * pebble[..., None]
    height = 0.6 * n + 0.4 * pebble
    rough = 0.92 - 0.1 * pebble
    finish('ground', col, height, rough, 3.5)


# ── 4. 금속 패널: 받침 측면용
def metal():
    panels = 2
    u, v = (xx * panels) % 1, (yy * panels * 2) % 1
    edge = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v))
    seam = np.clip(edge / 0.02, 0, 1)
    brushed = fbm(64, 2) * 0.5 + value_noise(256) * 0.5
    brushed = (brushed + np.roll(brushed, 3, 1) + np.roll(brushed, -3, 1)) / 3   # 가로 결
    rivet_u = np.minimum(u, 1 - u); rivet_v = np.minimum(v, 1 - v)
    rivet = np.clip(1 - np.hypot(rivet_u - 0.05, rivet_v - 0.1) / 0.015, 0, 1)
    dirt = fbm(4, 4)
    t = np.clip(0.4 + (brushed - 0.5) * 0.5 - (dirt - 0.5) * 0.4, 0, 1)
    col = lerp_col((52, 60, 74), (98, 108, 124), t) * (0.5 + 0.5 * seam)[..., None]
    col += rivet[..., None] * 0.15
    height = 0.7 * seam + 0.3 * rivet + brushed * 0.05
    rough = 0.45 + 0.3 * dirt
    finish('metal', col, height, rough, 2.5, period=(S // panels, S // (panels * 2)))


for f in (floor, path, ground, metal):
    f()

print(f'{"texture":28} seam_ratio')
ok = True
for name, r in report:
    flag = 'OK' if r <= 1.3 else 'FAIL'
    ok &= r <= 1.3
    print(f'{name:28} {r:5.2f}  {flag}')
print('ALL PASS' if ok else 'SEAM CHECK FAILED')
sys.exit(0 if ok else 1)
