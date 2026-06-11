#!/usr/bin/env python3
"""พิมพ์เขียว v3 (docs/jotform-workflow-blueprint-detailed.svg)
สะท้อนสภาพจริง 12 มิ.ย. 2026: เขียว = สร้าง+เทสผ่านแล้ว · ส้มประ = ต้องสร้าง/แก้
ตัวเลข [n] = element id จริง · สเต็ปละเอียด/เทมเพลตเมล: jotform-build-sheet.md
รันใหม่: python3 docs/generate-workflow-blueprint-detailed.py
"""

W, H = 1700, 905
GREEN, ORANGE, GREY = "#0F6E56", "#B45309", "#888780"
FILL_G, FILL_O = "#E1F5EE", "#FFF7ED"

out = []
def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def box(x, y, w, h, title, sub=None, todo=False, accent=None):
    edge = accent or (ORANGE if todo else GREEN)
    fill = FILL_O if todo else FILL_G
    dash = ' stroke-dasharray="6 4"' if todo else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{edge}" stroke-width="1.8"{dash}/>')
    if sub:
        out.append(f'<text x="{x+w/2}" y="{y+16}" text-anchor="middle" font-size="12" font-weight="600" fill="#1c1c1a">{esc(title)}</text>')
        out.append(f'<text x="{x+w/2}" y="{y+31}" text-anchor="middle" font-size="10.5" fill="{edge}">{esc(sub)}</text>')
    else:
        out.append(f'<text x="{x+w/2}" y="{y+h/2+4}" text-anchor="middle" font-size="12" font-weight="600" fill="#1c1c1a">{esc(title)}</text>')

def arrow(x1, y1, x2, y2, dashed=False):
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{GREY}" stroke-width="1.4"{dash} marker-end="url(#ar)"/>')

out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="-apple-system, \'Segoe UI\', \'Noto Sans Thai\', sans-serif">')
out.append('<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#888780"/></marker></defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')
out.append(f'<text x="36" y="36" font-size="20" font-weight="700" fill="#2C2C2A">BPUU × JotForm — พิมพ์เขียว v3 ตามสภาพจริง (12 มิ.ย. 2026)</text>')
out.append(f'<text x="36" y="57" font-size="12" fill="#5F5E5A">Workflow 261201384093450 · [n] = element id จริง · ทุกกล่องอนุมัติ Deny → [9] แจ้งปฏิเสธ ยกเว้นที่ระบุ · * = ต้องสร้าง/แก้ · สเต็ปคลิก + เทมเพลตเมล: jotform-build-sheet.md</text>')
out.append(f'<rect x="1280" y="22" width="14" height="14" rx="3" fill="{FILL_G}" stroke="{GREEN}" stroke-width="1.8"/>')
out.append(f'<text x="1300" y="34" font-size="11.5" fill="#2C2C2A">สร้าง + เทสผ่านแล้ว</text>')
out.append(f'<rect x="1440" y="22" width="14" height="14" rx="3" fill="{FILL_O}" stroke="{ORANGE}" stroke-width="1.8" stroke-dasharray="5 3"/>')
out.append(f'<text x="1460" y="34" font-size="11.5" fill="#2C2C2A">ต้องสร้าง/แก้ (สีส้มประ)</text>')

# ส่วนหัวร่วม
box(710, 78, 280, 36, "[1] Start — Request Form", accent=GREEN)
arrow(850, 114, 850, 132)
box(710, 134, 280, 44, "[2] Request Type Branch", "IF ประเภทคำขอ (q15) — 7 สาขา", accent=GREEN)
out.append(f'<text x="850" y="200" text-anchor="middle" font-size="11.5" fill="#5F5E5A">↓ ลากเส้นจาก [2] ไปกล่องแรกของแต่ละสาย แล้วเลือกสาขาบนป้าย Select Branch ↓</text>')

LANES = [
    ("สาย 1 จอดรถค้างคืน — เสร็จ ✓", False, [
        ("[4] แยกผู้ใช้ (q16)", "บุคลากร→[5] · อื่นๆ→[6]"),
        ("[5] หัวหน้างาน", "เฉพาะบุคลากร"),
        ("[6] BPUU Staff", "Deny = เก็บเงิน → [10]"),
        ("[7] BPUU Manager", None),
        ("[8] แจ้งผลอนุมัติ", "แก้ถ้อยคำเป็นกลาง*")]),
    ("โมดูลชำระเงิน — ใช้ร่วมทุกสาย ✓", False, [
        ("[10] ส่งฟอร์มสลิปให้ผู้ขอ", "assignee→q20* · เมล 6.3*"),
        ("[13] Staff ตรวจสลิป", "เพิ่ม Deny→[10] วนขอใหม่*"),
        ("[8] แจ้งผลอนุมัติ", None)]),
    ("สาย 7 แจ้งปัญหา — เสร็จ ✓", False, [
        ("[15] Staff รับเรื่อง + แก้ไข", "Approve/Deny → [16]"),
        ("[16] แจ้งสรุปผลผู้แจ้ง", "แก้ถ้อยคำ (ติด overnight)*")]),
    ("สาย 2 จอดรถรายเดือน", True, [
        ("Staff รายเดือน*", "เมล 6.2 + ปุ่ม"),
        ("Manager รายเดือน*", None),
        ("[10] โมดูลชำระเงิน", "นศ. 900 บ./เดือน"),
        ("[8] แจ้งผลอนุมัติ", None)]),
    ("สาย 3 ตราประทับ", True, [
        ("Branch ผู้ใช้ (q16)*", "บุคลากร / นักศึกษา"),
        ("หัวหน้า ตราประทับ*", "เฉพาะบุคลากร"),
        ("Staff ตราประทับ*", "นักศึกษาเข้าตรงนี้"),
        ("Manager ตราประทับ*", None),
        ("[8] แจ้งผลอนุมัติ", None)]),
    ("สาย 4 ทะเบียนรถ", True, [
        ("Branch ผู้ใช้ (q16)*", None),
        ("บุคลากร → Email FYI*", "รับทราบ→IBGM · จบสาย"),
        ("นักศึกษา → Staff ตรวจ*", "อัปเดตฐาน Carpark"),
        ("[8] แจ้งผลอนุมัติ", None)]),
    ("สาย 5 พื้นที่ชั่วคราว", True, [
        ("Branch ผู้ใช้ (q16)*", "บุคลากร / นศ.+ภายนอก"),
        ("หัวหน้า พื้นที่ฯ*", "เฉพาะบุคลากร"),
        ("Staff พื้นที่ฯ*", None),
        ("Manager พื้นที่ฯ*", "มีค่าใช้จ่าย→[10] (ออปชัน)"),
        ("[8] แจ้งผลอนุมัติ", None)]),
    ("สาย 6 เข้าพื้นที่คู่สัญญา", True, [
        ("Staff คู่สัญญา*", "ตรวจวันที่/คิวว่าง"),
        ("Manager คู่สัญญา*", None),
        ("[8] แจ้งผลอนุมัติ", None)]),
]

BOXW, BOXH, GAP, COLW = 330, 38, 16, 410
for i, (name, todo, steps) in enumerate(LANES):
    col, row = i % 4, i // 4
    x = 60 + col * COLW
    y = 232 + row * 330
    hdr = ORANGE if todo else GREEN
    out.append(f'<text x="{x+BOXW/2}" y="{y}" text-anchor="middle" font-size="13" font-weight="700" fill="{hdr}">{esc(name)}</text>')
    cy = y + 12
    for j, (title, sub) in enumerate(steps):
        h = BOXH if not sub else BOXH + 6
        step_todo = todo or (title.find('*') >= 0 or (sub or '').find('*') >= 0)
        box(x, cy, BOXW, h, title, sub, todo=step_todo)
        if j < len(steps) - 1:
            arrow(x + BOXW/2, cy + h, x + BOXW/2, cy + h + GAP, dashed=todo)
        cy += h + GAP

out.append(f'<text x="36" y="{H-18}" font-size="11.5" fill="#5F5E5A">กติกาสำคัญ: กล่องอนุมัติห้ามใช้ร่วมข้ามสาย (ความหมาย Deny ต่างกัน) · [8] [9] [10]+[13] ใช้ร่วมได้ · เมลอนุมัติทุกกล่องต้องติ๊ก Approve/Deny ในเมนูรูปตา ไม่งั้นไม่มีปุ่ม</text>')
out.append('</svg>')

with open(__file__.replace('generate-workflow-blueprint-detailed.py', 'jotform-workflow-blueprint-detailed.svg'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))
print('written', len('\n'.join(out)), 'bytes')
