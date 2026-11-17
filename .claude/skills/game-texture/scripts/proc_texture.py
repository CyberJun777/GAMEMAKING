#!/usr/bin/env python3
"""
절차적(procedural) seamless 타일 텍스처 생성기 — 무료, 오프라인, numpy + Pillow만 사용.

모든 노이즈를 '주기적(periodic)'으로 만들어 이음새가 원리적으로 생기지 않는다.
  - fBm  : FFT 스펙트럼 합성 (FFT는 본질적으로 주기 함수)
  - Worley(셀룰러): 토러스(wrap) 거리로 계산
  - 도메인 워프: wrap 바이리니어 샘플링

출력 (재질마다):
  <name>_basecolor.png  (sRGB, colorSpace = SRGBColorSpace)
  <name>_normal.png     (OpenGL/Three.js 규약, 선형)
  <name>_roughness.png  (선형, 흰색=거침)
  <name>_tiled2x2.png   (이음새 육안 검사용)
  + 콘솔에 seam ratio + 판정 (1.0 = 경계가 내부와 구분 불가, ≤1.3 또는 내부 분포 안이면 PASS)

사용:
  python3 proc_texture.py --list
  python3 proc_texture.py sand basalt --size 1024 --out ./textures --seed 7
  python3 proc_texture.py all --out ./textures
  python3 proc_texture.py sand --tint "#c9a46a,#7a5230"   # 팔레트(밝은색,어두운색) 덮어쓰기
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image


# ───────────────────────── 주기적 노이즈 기본 도구 ─────────────────────────

def fbm(n, rng, beta=2.0, lo=2, hi=None):
    """FFT 스펙트럼 합성 fBm. 진폭 ~ 1/f^(beta/2). lo/hi = 사용할 주파수 대역(타일당 주기 수)."""
    hi = hi or n // 2
    fx = np.fft.fftfreq(n) * n
    f = np.sqrt(fx[None, :] ** 2 + fx[:, None] ** 2)
    amp = np.zeros_like(f)
    band = (f >= lo) & (f <= hi)
    amp[band] = f[band] ** (-beta / 2)
    phase = rng.uniform(0, 2 * np.pi, (n, n))
    spec = amp * np.exp(1j * phase)
    out = np.real(np.fft.ifft2(spec))
    return norm(out)


def norm(a):
    a = a - a.min()
    m = a.max()
    return a / m if m > 0 else a


def worley(n, cells, rng, jitter=1.0):
    """토러스 Worley 노이즈. F1, F2 거리(셀 크기 단위) 반환."""
    pts = rng.uniform(0.5 - jitter / 2, 0.5 + jitter / 2, (cells, cells, 2))
    coord = (np.arange(n) + 0.5) / n * cells
    gy, gx = np.meshgrid(coord, coord, indexing="ij")
    cy, cx = np.floor(gy).astype(int), np.floor(gx).astype(int)
    fy, fx = gy - cy, gx - cx
    d1 = np.full((n, n), 9.0)
    d2 = np.full((n, n), 9.0)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            p = pts[(cy + oy) % cells, (cx + ox) % cells]
            dy = oy + p[..., 0] - fy
            dx = ox + p[..., 1] - fx
            d = np.sqrt(dx * dx + dy * dy)
            nd2 = np.where(d < d1, d1, np.minimum(d2, d))
            d1 = np.minimum(d1, d)
            d2 = nd2
    return d1, d2


def sample_wrap(img, y, x):
    """wrap 바이리니어 샘플링 (y, x는 픽셀 좌표 배열)."""
    n = img.shape[0]
    y0 = np.floor(y).astype(int)
    x0 = np.floor(x).astype(int)
    ty, tx = y - y0, x - x0
    y0 %= n
    x0 %= n
    y1, x1 = (y0 + 1) % n, (x0 + 1) % n
    a = img[y0, x0] * (1 - tx) + img[y0, x1] * tx
    b = img[y1, x0] * (1 - tx) + img[y1, x1] * tx
    return a * (1 - ty) + b * ty


def warp(img, wy, wx, strength):
    n = img.shape[0]
    yy, xx = np.meshgrid(np.arange(n, dtype=float), np.arange(n, dtype=float), indexing="ij")
    return sample_wrap(img, yy + (wy - 0.5) * strength * n, xx + (wx - 0.5) * strength * n)


def blur_wrap(a, r):
    """주기적 박스 블러(근사 가우시안: 3회 반복)."""
    for _ in range(3):
        acc = np.zeros_like(a)
        for k in range(-r, r + 1):
            acc += np.roll(a, k, axis=1)
        a = acc / (2 * r + 1)
        acc = np.zeros_like(a)
        for k in range(-r, r + 1):
            acc += np.roll(a, k, axis=0)
        a = acc / (2 * r + 1)
    return a


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hex2rgb(h):
    h = h.strip().lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float) / 255.0


def ramp(t, stops):
    """t∈[0,1] → 색. stops = [(pos, '#hex'), ...]"""
    pos = np.array([s[0] for s in stops])
    cols = np.array([hex2rgb(s[1]) for s in stops])
    out = np.empty(t.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(t, pos, cols[:, c])
    return out


# ───────────────────────── 높이 → 노멀 / 러프니스 ─────────────────────────

def normal_from_height(h, strength):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(h)  # OpenGL(+Y up) 규약
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


# ───────────────────────── 재질 레시피 ─────────────────────────
# 각 함수는 (basecolor[0..1, HxWx3], height[0..1], roughness[0..1]) 반환

def mat_sand(n, rng, tint):
    base = fbm(n, rng, beta=2.4, lo=2, hi=48)
    fine = fbm(n, rng, beta=0.6, lo=n // 8, hi=n // 2)
    wy, wx = fbm(n, rng, 2.6, 1, 8), fbm(n, rng, 2.6, 1, 8)
    yy, xx = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    k = 14  # 타일당 물결 수(정수 → 주기 유지)
    phase = 2 * np.pi * (k * xx + 5 * yy) / n  # 정수 계수 → 타일 주기 유지
    ripple = 0.5 + 0.5 * np.sin(phase + (wy - 0.5) * 9 + (wx - 0.5) * 6)
    h = norm(0.55 * base + 0.25 * ripple ** 1.5 + 0.2 * fine)
    t = norm(0.6 * base + 0.25 * ripple + 0.15 * fine)
    hi_c, lo_c = tint or ("#d9b77e", "#8a6438")
    col = ramp(t, [(0, lo_c), (0.55, mix_hex(lo_c, hi_c, 0.65)), (1, hi_c)])
    col *= (0.92 + 0.16 * fine)[..., None]
    rough = 0.85 + 0.12 * fine
    return col, h, rough


def mat_basalt(n, rng, tint):
    f1, f2 = worley(n, 10, rng)
    edge = f2 - f1
    cracks = 1 - smoothstep(0.0, 0.07, edge)
    big = fbm(n, rng, 2.2, 2, 32)
    fine = fbm(n, rng, 0.8, n // 10, n // 2)
    h = norm(0.55 * smoothstep(0.0, 0.35, edge) + 0.3 * big + 0.15 * fine) * (1 - 0.6 * cracks)
    hi_c, lo_c = tint or ("#6d7378", "#24272b")
    col = ramp(norm(0.6 * big + 0.4 * fine), [(0, lo_c), (1, hi_c)])
    col *= (1 - 0.75 * cracks)[..., None]
    rough = np.clip(0.7 + 0.25 * fine - 0.1 * big + 0.1 * cracks, 0, 1)
    return col, h, rough


def mat_dirt(n, rng, tint):
    big = fbm(n, rng, 2.3, 2, 40)
    mid = fbm(n, rng, 1.6, 8, 128)
    fine = fbm(n, rng, 0.7, n // 8, n // 2)
    f1, _ = worley(n, 28, rng)
    pebble = 1 - smoothstep(0.18, 0.32, f1)
    pebble *= (mid > 0.5)
    h = norm(0.45 * big + 0.25 * mid + 0.1 * fine + 0.35 * pebble)
    hi_c, lo_c = tint or ("#7b5a3c", "#2e2117")
    col = ramp(norm(0.5 * big + 0.3 * mid + 0.2 * fine), [(0, lo_c), (1, hi_c)])
    peb_col = ramp(fine, [(0, "#5d564e"), (1, "#8c8378")])
    col = col * (1 - pebble[..., None]) + peb_col * pebble[..., None]
    rough = np.clip(0.9 - 0.25 * pebble + 0.08 * fine, 0, 1)
    return col, h, rough


def mat_metal(n, rng, tint):
    panels = 4  # 타일당 패널 수(정수)
    yy, xx = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    s = n / panels
    yy, xx = yy + s / 2, xx + s / 2  # 타일 경계가 패널 홈이 아니라 패널 중앙을 지나게
    py, px = (yy % s) / s, (xx % s) / s
    seam = np.minimum(np.minimum(py, 1 - py), np.minimum(px, 1 - px))
    bevel = smoothstep(0.0, 0.035, seam)
    # 리벳
    rv = 0.07
    rivet = np.zeros((n, n))
    for cy in (rv, 1 - rv):
        for cx in (rv, 0.5, 1 - rv):
            d = np.sqrt((py - cy) ** 2 + (px - cx) ** 2)
            rivet = np.maximum(rivet, 1 - smoothstep(0.012, 0.022, d))
    # 패널별 미세 색차
    pid_y, pid_x = (yy // s).astype(int) % panels, (xx // s).astype(int) % panels
    var = rng.uniform(-0.06, 0.06, (panels, panels))[pid_y, pid_x]
    grime = fbm(n, rng, 2.0, 2, 32)
    scratch = fbm(n, rng, 0.4, n // 6, n // 2)
    streak = norm(blur_wrap(scratch, 2))
    h = norm(0.75 * bevel + 0.25 * rivet + 0.03 * scratch)
    hi_c, lo_c = tint or ("#8d969c", "#3a3f44")
    col = ramp(np.clip(0.55 + var + 0.25 * (grime - 0.5), 0, 1), [(0, lo_c), (1, hi_c)])
    col *= (0.55 + 0.45 * bevel)[..., None]
    col *= (1 - 0.18 * smoothstep(0.55, 0.9, grime))[..., None]
    col = col * (1 - rivet[..., None]) + hex2rgb(hi_c) * 1.1 * rivet[..., None]
    rough = np.clip(0.38 + 0.35 * grime + 0.15 * streak - 0.15 * rivet, 0, 1)
    return np.clip(col, 0, 1), h, rough


def mat_creep(n, rng, tint):
    a = fbm(n, rng, 2.4, 2, 24)
    wy, wx = fbm(n, rng, 2.4, 1, 8), fbm(n, rng, 2.4, 1, 8)
    org = norm(warp(a, wy, wx, 0.18))
    f1, f2 = worley(n, 12, rng)
    vein = 1 - smoothstep(0.0, 0.05, f2 - f1)
    vein = norm(warp(vein, wy, wx, 0.05))
    fine = fbm(n, rng, 0.9, n // 10, n // 2)
    h = norm(0.6 * org + 0.25 * vein + 0.15 * fine)
    hi_c, lo_c = tint or ("#8a3f86", "#2a0f2b")
    col = ramp(org, [(0, lo_c), (0.6, mix_hex(lo_c, hi_c, 0.6)), (1, hi_c)])
    col = col * (1 - 0.7 * vein[..., None]) + hex2rgb("#c25a7c") * 0.7 * vein[..., None]
    col *= (0.9 + 0.2 * fine)[..., None]
    rough = np.clip(0.35 + 0.3 * (1 - org) + 0.1 * fine, 0, 1)  # 끈적 → 낮은 러프니스
    return np.clip(col, 0, 1), h, rough


def mat_lava(n, rng, tint):
    f1, f2 = worley(n, 7, rng)
    wy, wx = fbm(n, rng, 2.5, 1, 6), fbm(n, rng, 2.5, 1, 6)
    edge = warp(f2 - f1, wy, wx, 0.04)
    glow = 1 - smoothstep(0.0, 0.12, edge)
    crust = fbm(n, rng, 1.4, 6, 160)
    h = norm(smoothstep(0.0, 0.3, edge) * (0.7 + 0.3 * crust))
    hi_c, lo_c = tint or ("#ffb030", "#1a1210")
    crust_col = ramp(crust, [(0, lo_c), (1, "#3b2c26")])
    hot = ramp(glow, [(0, "#8a1a00"), (0.6, "#ff5a00"), (1, hi_c)])
    col = crust_col * (1 - glow[..., None]) + hot * glow[..., None]
    rough = np.clip(0.85 - 0.6 * glow + 0.1 * crust, 0, 1)
    return np.clip(col, 0, 1), h, rough


def mix_hex(a, b, t):
    c = hex2rgb(a) * (1 - t) + hex2rgb(b) * t
    return "#" + "".join(f"{int(round(v * 255)):02x}" for v in c)


def mat_grass(n, rng, tint):
    """경기장 잔디: 넓은 색 얼룩 + 촘촘한 잎 반점. 팀색(청록·주황) 모두와 대비되도록 채도 낮은 황록."""
    patch = fbm(n, rng, 2.4, 2, 24)
    mid = fbm(n, rng, 1.2, 16, 160)
    fine = fbm(n, rng, 0.2, n // 6, n // 2)
    f1, _ = worley(n, 96, rng)
    blade = 1 - smoothstep(0.05, 0.35, f1)          # 잎 끝 하이라이트 점
    h = norm(0.35 * mid + 0.45 * fine + 0.2 * blade)
    hi_c, lo_c = tint or ("#7aa04a", "#2f5424")
    t = np.clip(0.45 * patch + 0.25 * mid + 0.3 * fine + 0.15 * blade - 0.05, 0, 1)
    col = ramp(t, [(0, lo_c), (0.55, mix_hex(lo_c, hi_c, 0.6)), (1, hi_c)])
    rough = np.clip(0.88 + 0.1 * fine - 0.08 * blade, 0, 1)
    return col, h, rough


def mat_concrete(n, rng, tint):
    """관중석·구조물 콘크리트: 얼룩 + 미세 거칠기 + 작은 기공."""
    stain = fbm(n, rng, 2.2, 2, 20)
    mid = fbm(n, rng, 1.5, 10, 120)
    fine = fbm(n, rng, 0.5, n // 8, n // 2)
    f1, _ = worley(n, 40, rng)
    pore = 1 - smoothstep(0.03, 0.09, f1)
    h = norm(0.3 * mid + 0.5 * fine - 0.5 * pore)
    hi_c, lo_c = tint or ("#a7a7a2", "#6b6c69")
    col = ramp(np.clip(0.5 * stain + 0.3 * mid + 0.2 * fine, 0, 1), [(0, lo_c), (1, hi_c)])
    col *= (1 - 0.35 * pore)[..., None]
    col *= (1 - 0.12 * smoothstep(0.6, 0.95, stain))[..., None]
    rough = np.clip(0.8 + 0.15 * fine + 0.05 * pore, 0, 1)
    return np.clip(col, 0, 1), h, rough


MATERIALS = {
    "sand":   (mat_sand,   3.0, "사막 모래 + 바람 물결 (지형)"),
    "basalt": (mat_basalt, 4.0, "현무암 판석 + 균열 (지형, 진영색과 대비 좋은 한랭 회색)"),
    "dirt":   (mat_dirt,   3.5, "어두운 흙 + 자갈 (지형)"),
    "metal":  (mat_metal,  5.0, "금속 장갑판 4×4 패널 + 리벳 (구조물)"),
    "creep":  (mat_creep,  3.0, "유기질 점막 + 혈관 (특수 표면)"),
    "lava":   (mat_lava,   4.0, "용암 균열 + 식은 지각 (특수 표면, 균열을 emissive로)"),
    "grass":  (mat_grass,  2.0, "경기장 잔디 (지형, 채도 낮은 황록 — 원색 팀색과 대비)"),
    "concrete": (mat_concrete, 2.5, "콘크리트 (관중석·구조물)"),
}


# ───────────────────────── 검증 ─────────────────────────

def seam_check(img):
    """타일 경계(마지막 열→첫 열, 마지막 행→첫 행)가 내부 이음선들과 구분되는지 검사.
    ratio   = 경계 차이 ÷ 내부 인접 차이 평균 (1.0 이 이상적)
    outlier = 경계 차이가 내부 이음선 분포의 p99 를 넘는가
    통과: ratio ≤ 1.3  또는  경계가 내부 분포 안(p99 이하)  — 균열·패널처럼 구조가 큰
    재질은 이음선 하나하나의 편차가 커서 평균 비율만으로는 오판하기 때문."""
    a = img.astype(float)
    if a.ndim == 3:
        a = a.mean(-1)
    worst_ratio, outlier = 0.0, False
    for ax in (1, 0):
        lines = np.abs(np.diff(a, axis=ax)).mean(axis=1 - ax)
        edge = np.abs(np.take(a, 0, axis=ax) - np.take(a, -1, axis=ax)).mean()
        worst_ratio = max(worst_ratio, edge / max(lines.mean(), 1e-9))
        outlier |= edge > np.percentile(lines, 99)
    return worst_ratio, (worst_ratio <= 1.3) or not outlier


def to_img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def tiled2x2(img):
    w, h = img.size
    t = Image.new(img.mode, (w * 2, h * 2))
    for x in (0, w):
        for y in (0, h):
            t.paste(img, (x, y))
    return t


# ───────────────────────── 메인 ─────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("materials", nargs="*", help="재질 이름들 또는 all")
    ap.add_argument("--size", type=int, default=1024, help="2의 거듭제곱 권장 (기본 1024)")
    ap.add_argument("--out", default="./textures")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--tint", help="'밝은색,어두운색' hex 두 개로 팔레트 덮어쓰기")
    ap.add_argument("--no-preview", action="store_true", help="tiled2x2 미리보기 생략")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    if a.list or not a.materials:
        for k, (_, _, d) in MATERIALS.items():
            print(f"  {k:8s} {d}")
        return 0

    names = list(MATERIALS) if a.materials == ["all"] else a.materials
    bad = [m for m in names if m not in MATERIALS]
    if bad:
        print("알 수 없는 재질:", ", ".join(bad), "| --list 로 확인", file=sys.stderr)
        return 2
    if a.size & (a.size - 1):
        print("경고: --size 가 2의 거듭제곱이 아님 (밉맵 비효율)", file=sys.stderr)
    tint = tuple(a.tint.split(",")) if a.tint else None

    os.makedirs(a.out, exist_ok=True)
    fail = 0
    for i, name in enumerate(names):
        fn, nstr, _ = MATERIALS[name]
        rng = np.random.default_rng(a.seed * 1000 + i)
        col, h, rough = fn(a.size, rng, tint)
        nrm = normal_from_height(h, nstr * a.size / 256)
        base_img = to_img(col)
        base_img.save(os.path.join(a.out, f"{name}_basecolor.png"))
        to_img(nrm).save(os.path.join(a.out, f"{name}_normal.png"))
        to_img(rough).save(os.path.join(a.out, f"{name}_roughness.png"))
        if not a.no_preview:
            tiled2x2(base_img).save(os.path.join(a.out, f"{name}_tiled2x2.png"))
        r1, ok1 = seam_check(np.asarray(base_img))
        r2, ok2 = seam_check(h)
        ok = ok1 and ok2
        fail += not ok
        print(f"{name:7s} seam ratio {max(r1, r2):.3f}  {'PASS' if ok else 'FAIL (경계가 내부 분포를 벗어남 → --seed 바꿔 재생성)'}")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
