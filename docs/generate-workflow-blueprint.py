#!/usr/bin/env python3
"""สร้างพิมพ์เขียว JotForm workflow (docs/jotform-workflow-blueprint.svg)

แก้โครงโฟลว์ได้ที่ตัวแปร LANES ด้านล่าง แล้วรันใหม่:
    python3 docs/generate-workflow-blueprint.py
"""

FORM_ID = "261200763585052"

# สี: (fill, stroke, text)
ROLE_COLORS = {
    "branch":  ("#F1EFE8", "#5F5E5A", "#2C2C2A"),
    "head":    ("#EEEDFE", "#534AB7", "#26215C"),
    "staff":   ("#E1F5EE", "#0F6E56", "#04342C"),
    "manager": ("#E6F1FB", "#185FA5", "#042C53"),
    "approve": ("#EAF3DE", "#3B6D11", "#173404"),
    "reject":  ("#FCEBEB", "#A32D2D", "#501313"),
    "phase2":  ("#FAEEDA", "#854F0B", "#412402"),
    "info":    ("#F1EFE8", "#888780", "#444441"),
}

HEAD = ("head", "หัวหน้างานอนุมัติ", "อีเมลจากฟิลด์ q30")
STAFF = ("staff", "BPUU Staff พิจารณา", "dev.codegym@gmail.com")
MGR = ("manager", "BPUU Manager อนุมัติ", "n.chotthanin@gmail.com")
OK = ("approve", "แจ้งผลอนุมัติ", "อีเมลผู้ขอ q20")

# โครงแต่ละสาย: (ชื่อสาย, ค่า q15, split, chains, phase2-notes)
# split=None -> สายเดี่ยว, ไม่งั้นเป็น [(หัวข้อย่อย, chain), (หัวข้อย่อย, chain)]
LANES = [
    ("1. จอดรถค้างคืน", "แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)",
     [("บุคลากร", [HEAD, STAFF, MGR, OK]),
      ("นักศึกษา + ภายนอก", [STAFF, MGR, OK])],
     ["+ แจ้งยอด/QR → สลิป → ใบเสร็จ"]),
    ("2. จอดรถรายเดือน", "แบบฟอร์มขอจอดรถรายเดือน",
     None, ["+ QR/ชำระเงิน/ใบเสร็จ", "+ กรณีพิเศษ: สายรองอธิการบดี-อธิการบดี"]),
    ("3. ตราประทับ", "แบบฟอร์มขอใช้ตราประทับ",
     [("บุคลากร", [HEAD, STAFF, MGR, OK]),
      ("นักศึกษา", [STAFF, MGR, OK])],
     ["+ field 'ขอในนาม' ในฟอร์ม", "+ ในนามโครงการ: ข้ามหัวหน้า, เพิ่มรองฯ การเงิน", "+ ใบแจ้งหนี้ D365 หลังใช้งาน"]),
    ("4. ทะเบียนรถ", "แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์",
     [("บุคลากร (ไป IBGM)", [("info", "บันทึกรับทราบ", "แจ้ง BPUU Staff (FYI)"),
                              ("approve", "จบ — ดำเนินการต่อใน IBGM", "ไม่มีการอนุมัติ")]),
      ("นักศึกษา", [("staff", "BPUU Staff ตรวจสอบ", "อัปเดตฐาน Carpark"), OK])],
     []),
    ("5. พื้นที่ชั่วคราว", "แบบฟอร์มขอใช้พื้นที่ชั่วคราว",
     [("บุคลากร", [HEAD, STAFF, MGR, OK]),
      ("นักศึกษา + ภายนอก", [STAFF, MGR, OK])],
     ["+ รองอธิการบดีการเงิน (สายบุคลากร)", "+ QR/ชำระเงิน/ใบเสร็จ (กรณีมีค่าใช้จ่าย)"]),
    ("6. เข้าพื้นที่คู่สัญญา", "แบบฟอร์มขอเข้าพื้นที่คู่สัญญา",
     None, ["+ ผู้ดูแลพื้นที่ตรวจสอบวันที่", "เฉพาะบุคคลภายนอก (Vendor)"]),
    ("7. แจ้งปัญหา", "แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ",
     [("ทุกประเภทผู้ขอ", [("staff", "BPUU Staff รับเรื่อง", "แก้ไขปัญหา"),
                            ("approve", "แจ้งสรุปผล", "อีเมลผู้ขอ q20")])],
     ["ไม่มีขั้น Manager"]),
]
# สายเดี่ยว (split=None) ใช้ chain มาตรฐาน Staff -> Manager -> แจ้งผล
DEFAULT_CHAIN = [STAFF, MGR, OK]

LANE_W, LANE_GAP, M = 240, 14, 24
BOX_H, GAP = 44, 16
W = M * 2 + len(LANES) * LANE_W + (len(LANES) - 1) * LANE_GAP

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def box(out, x, y, w, h, role, title, sub=None, dashed=False, fs=12):
    fill, stroke, text = ROLE_COLORS[role]
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="{fill}" stroke="{stroke}" stroke-width="1.4"{dash}/>')
    if sub:
        out.append(f'<text x="{x + w/2}" y="{y + h/2 - 4}" text-anchor="middle" font-size="{fs}" font-weight="600" fill="{text}">{esc(title)}</text>')
        out.append(f'<text x="{x + w/2}" y="{y + h/2 + 13}" text-anchor="middle" font-size="{fs-2.5}" fill="{stroke}">{esc(sub)}</text>')
    else:
        out.append(f'<text x="{x + w/2}" y="{y + h/2 + 4}" text-anchor="middle" font-size="{fs}" font-weight="600" fill="{text}">{esc(title)}</text>')

def arrow(out, x1, y1, x2, y2):
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#888780" stroke-width="1.3" marker-end="url(#ar)"/>')

out = []
lane_tops = []
body_y = 196

lane_heights = []
for _, _, split, notes in LANES:
    cols = split if split else [(None, DEFAULT_CHAIN)]
    longest = max(len(c) for _, c in cols)
    h = 26 + longest * (BOX_H + GAP) + 8 + 34  # หัวคอลัมน์ + กล่อง + กล่องปฏิเสธ
    h += 10 + len(notes) * 20 + (8 if notes else 0)
    lane_heights.append(h)
H = body_y + max(lane_heights) + 70

out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="-apple-system, \'Segoe UI\', \'Noto Sans Thai\', sans-serif">')
out.append('<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#888780"/></marker></defs>')
out.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#FFFFFF"/>')
out.append(f'<text x="{M}" y="34" font-size="20" font-weight="600" fill="#2C2C2A">BPUU × JotForm — พิมพ์เขียว workflow รวมทุกประเภทคำขอ (รุ่นย่อ v1, 11 มิ.ย. 2026)</text>')
out.append(f'<text x="{M}" y="56" font-size="13" fill="#5F5E5A">ฟอร์มกลาง: Request Form ({FORM_ID}) · เงื่อนไขแตกสายใช้ฟิลด์ q15 (ประเภทคำขอ) และ q16 (ประเภทผู้ใช้) · Deny ทุกกล่องอนุมัติ → กล่องแจ้งปฏิเสธท้ายสายของตัวเอง</text>')

cx = W / 2
box(out, cx - 110, 76, 220, 40, "info", "Start: Request Form", f"submission จากหน้าเว็บ BPUU")
arrow(out, cx, 116, cx, 132)
box(out, cx - 130, 134, 260, 40, "branch", "Branch 1: ประเภทคำขอ (q15)", "แตก 7 สาย")

for i, (name, q15, split, notes) in enumerate(LANES):
    x0 = M + i * (LANE_W + LANE_GAP)
    lane_cx = x0 + LANE_W / 2
    arrow(out, cx + (lane_cx - cx) * 0.18, 174, lane_cx, body_y - 6)
    out.append(f'<rect x="{x0}" y="{body_y}" width="{LANE_W}" height="{H - body_y - 40}" rx="8" fill="#FAFAF7" stroke="#D3D1C7"/>')
    out.append(f'<text x="{lane_cx}" y="{body_y + 24}" text-anchor="middle" font-size="14" font-weight="600" fill="#2C2C2A">{esc(name)}</text>')
    out.append(f'<text x="{lane_cx}" y="{body_y + 42}" text-anchor="middle" font-size="10" fill="#888780">q15 = "{esc(q15[:34])}{"…" if len(q15) > 34 else ""}"</text>')

    cols = split if split else [(None, DEFAULT_CHAIN)]
    two = len(cols) == 2
    if two:
        out.append(f'<text x="{lane_cx}" y="{body_y + 62}" text-anchor="middle" font-size="10.5" fill="#534AB7">Branch 2: ผู้ขอ (q16)</text>')
    y_chain0 = body_y + (74 if two else 56)
    longest = 0
    for ci, (subhead, chain) in enumerate(cols):
        if two:
            bw = (LANE_W - 24) / 2
            bx = x0 + 8 + ci * (bw + 8)
        else:
            bw = LANE_W - 32
            bx = x0 + 16
        y = y_chain0
        if subhead:
            out.append(f'<text x="{bx + bw/2}" y="{y}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#444441">{esc(subhead)}</text>')
        y += 8
        for bi, (role, title, sub) in enumerate(chain):
            box(out, bx, y, bw, BOX_H, role, title, sub, fs=10.5 if two else 12)
            if bi < len(chain) - 1:
                arrow(out, bx + bw/2, y + BOX_H, bx + bw/2, y + BOX_H + GAP - 2)
            y += BOX_H + GAP
        longest = max(longest, len(chain))
    ry = y_chain0 + 8 + longest * (BOX_H + GAP) + 4
    box(out, x0 + 16, ry, LANE_W - 32, 32, "reject", "Deny จุดใดก็ตาม → แจ้งปฏิเสธ (q20)", fs=10.5)
    ny = ry + 42
    for note in notes:
        box(out, x0 + 16, ny, LANE_W - 32, 24, "phase2", note, dashed=True, fs=10)
        ny += 28

ly = H - 26
legend = [("head", "หัวหน้างาน (อีเมล dynamic จาก q30)"), ("staff", "BPUU Staff"), ("manager", "BPUU Manager"),
          ("approve", "แจ้งผล/จบ"), ("reject", "ปฏิเสธ"), ("phase2", "Phase 2 (ยังไม่สร้าง)")]
lx = M
for role, label in legend:
    fill, stroke, _ = ROLE_COLORS[role]
    out.append(f'<rect x="{lx}" y="{ly - 12}" width="14" height="14" rx="3" fill="{fill}" stroke="{stroke}"/>')
    out.append(f'<text x="{lx + 20}" y="{ly}" font-size="12" fill="#444441">{esc(label)}</text>')
    lx += 26 + len(label) * 7.2

out.append('</svg>')

with open(__file__.replace("generate-workflow-blueprint.py", "jotform-workflow-blueprint.svg"), "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print(f"written: jotform-workflow-blueprint.svg ({W}x{H})")
