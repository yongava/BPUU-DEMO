#!/usr/bin/env python3
"""พิมพ์เขียวละเอียด JotForm workflow (docs/jotform-workflow-blueprint-detailed.svg)

อิงโครงจริงใน workflow "Workflow Setup" (ID 261201384093450)
ตัวเลข [n] ในแต่ละกล่อง = element_id จริงบน canvas ของ JotForm
สีเขียว = สร้าง+ต่อเสร็จแล้ว · สีส้มเส้นประ = ยังต้องสร้าง/ต่อเอง

แก้แล้วรันใหม่:
    python3 docs/generate-workflow-blueprint-detailed.py
"""

FORM_ID = "261200763585052"
WORKFLOW_ID = "261201384093450"

W, H = 1700, 1270

# โทนสีตามบทบาท: (fill, stroke, text)
ROLE = {
    "start":  ("#FFF1E2", "#B45309", "#5B2A05"),
    "branch": ("#EEEDFE", "#534AB7", "#26215C"),
    "head":   ("#E6F1FB", "#185FA5", "#042C53"),
    "staff":  ("#E1F5EE", "#0F6E56", "#04342C"),
    "manager":("#DCEBFA", "#1D4F91", "#0A2A52"),
    "ok":     ("#EAF3DE", "#3B6D11", "#173404"),
    "reject": ("#FCEBEB", "#A32D2D", "#501313"),
    "email":  ("#F1EFE8", "#5F5E5A", "#2C2C2A"),
    "lane":   ("#F7F6F1", "#888780", "#444441"),
}

GREEN = "#0F6E56"   # สถานะ: ทำแล้ว
ORANGE = "#B45309"  # สถานะ: ต้องทำ
GREY = "#888780"

out = []

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def box(x, y, w, h, role, title, lines=(), todo=False, badge=None):
    fill, stroke, text = ROLE[role]
    dash = ' stroke-dasharray="6 4"' if todo else ""
    sw = 2.2 if todo else 1.6
    edge = ORANGE if todo else stroke
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{fill}" stroke="{edge}" stroke-width="{sw}"{dash}/>')
    ty = y + 19
    out.append(f'<text x="{x + w/2}" y="{ty}" text-anchor="middle" font-size="12.5" font-weight="700" fill="{text}">{esc(title)}</text>')
    for ln, c in lines:
        ty += 15
        col = {"n": stroke, "t": text, "g": GREEN, "o": ORANGE, "r": "#A32D2D"}[c]
        w8 = ' font-weight="600"' if c in ("o", "r") else ""
        out.append(f'<text x="{x + w/2}" y="{ty}" text-anchor="middle" font-size="10.5"{w8} fill="{col}">{esc(ln)}</text>')
    if badge:
        bw = 9 * len(badge) + 14
        out.append(f'<rect x="{x + w - bw + 6}" y="{y - 9}" width="{bw}" height="18" rx="9" fill="{ORANGE}"/>')
        out.append(f'<text x="{x + w - bw/2 + 6}" y="{y + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#FFFFFF">{esc(badge)}</text>')

def arrow(x1, y1, x2, y2, label=None, color=GREY, dashed=False, lx=None, ly=None, lcolor=None):
    dash = ' stroke-dasharray="6 4"' if dashed else ""
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.5"{dash} marker-end="url(#ar)"/>')
    if label:
        mx = (x1 + x2) / 2 if lx is None else lx
        my = (y1 + y2) / 2 if ly is None else ly
        pw = 6.8 * len(label) + 16
        pc = lcolor or color
        out.append(f'<rect x="{mx - pw/2}" y="{my - 10}" width="{pw}" height="20" rx="10" fill="#FFFFFF" stroke="{pc}" stroke-width="1.2"/>')
        out.append(f'<text x="{mx}" y="{my + 3.5}" text-anchor="middle" font-size="10" font-weight="600" fill="{pc}">{esc(label)}</text>')

out.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="-apple-system, \'Segoe UI\', \'Noto Sans Thai\', sans-serif">')
out.append('<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7.5" markerHeight="7.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#888780"/></marker></defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')

out.append(f'<text x="36" y="38" font-size="21" font-weight="700" fill="#2C2C2A">BPUU × JotForm — พิมพ์เขียวละเอียด รวมทุกประเภทคำขอ × ประเภทผู้ใช้ (v2, 11 มิ.ย. 2026)</text>')
out.append(f'<text x="36" y="60" font-size="12.5" fill="#5F5E5A">ฟอร์มกลาง: Request Form ({FORM_ID}) · Workflow: "Workflow Setup" ({WORKFLOW_ID}) · ตัวเลข [n] = element id จริงบน canvas · แตกสายด้วย q15 (ประเภทคำขอ) และ q16 (ประเภทผู้ใช้)</text>')

# legend
out.append(f'<rect x="1258" y="74" width="14" height="14" rx="3" fill="#E1F5EE" stroke="{GREEN}" stroke-width="1.6"/>')
out.append(f'<text x="1280" y="86" font-size="11.5" fill="#2C2C2A">สร้าง + ต่อเสร็จแล้วบน canvas</text>')
out.append(f'<rect x="1478" y="74" width="14" height="14" rx="3" fill="#FFF7ED" stroke="{ORANGE}" stroke-width="2" stroke-dasharray="5 3"/>')
out.append(f'<text x="1500" y="86" font-size="11.5" fill="#2C2C2A">ยังต้องสร้าง/ต่อเอง</text>')

# ---------- แถวบน: Start + Request Type Branch ----------
box(720, 78, 320, 46, "start", "[1] Start — Request Form", [("trigger: submission เข้าใหม่", "n")])
arrow(880, 124, 880, 154)
box(720, 156, 320, 60, "branch", "[2] Request Type Branch", [
    ("Conditional Branch · IF ประเภทคำขอ (q15) IS EQUAL TO …", "n"),
    ("7 สาขา — ค่าตรงกับชื่อแบบฟอร์มเป๊ะ ๆ", "t"),
])

# ---------- กลุ่มปลายทางของ 7 สาขา ----------
box(150, 268, 290, 76, "lane", "สาย 4 — ทะเบียนรถยนต์", [
    ("q15 = แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์", "n"),
    ("→ [10] แยกประเภทผู้ใช้", "t"),
])
box(740, 268, 280, 76, "lane", "สาย 1 / 3 / 5 — มีหัวหน้างานคั่น", [
    ("จอดรถค้างคืน (S2) · ตราประทับ · พื้นที่ชั่วคราว", "n"),
    ("→ [4] แยกประเภทผู้ใช้", "t"),
])
box(1080, 268, 270, 76, "lane", "สาย 2 / 6 — สายเดี่ยว", [
    ("จอดรถรายเดือน · เข้าพื้นที่คู่สัญญา", "n"),
    ("→ [6] เริ่มที่ BPUU Staff เลย", "t"),
])
box(1400, 268, 260, 76, "lane", "สาย 7 — แจ้งปัญหา", [
    ("q15 = แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ", "n"),
    ("→ [13] ไม่มีขั้น Manager", "t"),
], todo=True, badge="ต้องต่อ")

arrow(800, 216, 320, 266)
arrow(880, 216, 880, 266)
arrow(960, 216, 1200, 266)
arrow(1040, 200, 1510, 266, dashed=True, color=ORANGE)

# ---------- สายหลัก (โหนดแชร์ร่วมกัน) ----------
box(740, 392, 280, 62, "branch", "[4] User Type Branch", [
    ("IF ประเภทผู้ใช้ (q16) IS EQUAL TO …", "n"),
    ("บุคลากร / นักศึกษา / บุคคลภายนอก", "t"),
])
arrow(880, 344, 880, 390)

box(620, 512, 300, 92, "head", "[5] Department Manager Approval", [
    ("Approval · หัวหน้างานของผู้ขอ", "n"),
    ("ตอนนี้: yeongreserve@gmail.com (ค่าทดสอบ)", "t"),
    ("เป้าหมายจริง: ใช้อีเมลจากฟิลด์ q30", "o"),
    ("Deny → [9]", "r"),
])
arrow(810, 454, 745, 510, label="บุคลากร", lcolor="#185FA5")

box(740, 648, 280, 76, "staff", "[6] BPUU Staff Review", [
    ("Approval · dev.codegym@gmail.com", "n"),
    ("รับงานจากสาย 1,2,3,5,6 + Approve ของ [5]", "t"),
    ("Deny → [9]", "r"),
])
arrow(940, 454, 940, 646, label="นักศึกษา / บุคคลภายนอก", lcolor="#185FA5", ly=480)
arrow(770, 604, 810, 646, label="Approve", lcolor=GREEN, lx=735, ly=632)
arrow(1215, 344, 990, 646, label="สาย 2 / 6", lcolor=GREY, lx=1130, ly=480)

box(740, 772, 280, 74, "manager", "[7] BPUU Manager Approval", [
    ("Approval · n.chotthanin@gmail.com", "n"),
    ("Deny → [9]", "r"),
])
arrow(880, 724, 880, 770, label="Approve", lcolor=GREEN)

box(740, 900, 280, 62, "ok", "[8] Email: Notify Requester Approval", [
    ("ถึง {input20} — อีเมลผู้ยื่นคำขอ", "n"),
    ("ปลายทาง Approve ของ [7] และ [12]", "t"),
])
arrow(880, 846, 880, 898, label="Approve", lcolor=GREEN)

box(1180, 900, 330, 62, "reject", "[9] Email: Notify Requester Rejection", [
    ("ถึง {input20} — อีเมลผู้ยื่นคำขอ", "n"),
    ("ปลายทางของทุกปุ่ม Deny: [5] [6] [7] [12] [13]", "r"),
])

# ---------- สาย 4: ทะเบียนรถ ----------
box(160, 392, 270, 62, "branch", "[10] Conditional Branch (ทะเบียนรถ)", [
    ("IF ประเภทผู้ใช้ (q16) IS EQUAL TO …", "n"),
    ("สร้างแล้ว: บุคลากร / นักศึกษา", "t"),
])
arrow(295, 344, 295, 390)

box(30, 512, 250, 86, "email", "[11] Email: รับทราบ (FYI)", [
    ("ถึง dev.codegym@gmail.com", "n"),
    ("เรื่อง: รับทราบคำขอทะเบียนรถ (บุคลากร)", "t"),
    ("— ดำเนินการต่อใน IBGM · จบสาย ไม่มีอนุมัติ", "t"),
])
arrow(230, 454, 160, 510, label="บุคลากร", lcolor="#185FA5")

box(300, 512, 260, 94, "staff", "[12] Approval: ตรวจสอบทะเบียนรถ", [
    ("dev.codegym@gmail.com · อัปเดตฐาน Carpark", "n"),
    ("ชื่อบน canvas ยังเป็น “Approval” (default)", "t"),
    ("เหลือ: Approve → [8] · Deny → [9]", "o"),
], badge="เหลือ 2 เส้น")
arrow(360, 454, 425, 510, label="นักศึกษา", lcolor="#185FA5")
arrow(430, 606, 730, 898, label="Approve (ยังไม่ต่อ)", dashed=True, color=ORANGE, lcolor=ORANGE, lx=560, ly=760)

# ---------- สาย 7: แจ้งปัญหา ----------
box(1400, 392, 260, 90, "staff", "[13] Approval: BPUU Staff รับเรื่อง", [
    ("dev.codegym@gmail.com · รับเรื่อง/แก้ปัญหา", "n"),
    ("ทั้ง 3 ประเภทผู้ใช้ ไม่ต้องแยกสาขา", "t"),
    ("Deny → [9] (แนะนำ)", "r"),
], todo=True, badge="ต้องสร้าง")
box(1400, 542, 260, 76, "ok", "[14] Email: แจ้งสรุปผลการแก้ไข", [
    ("ถึง {input20} — อีเมลผู้ยื่นคำขอ", "n"),
    ("จบสาย", "t"),
], todo=True, badge="ต้องสร้าง")
arrow(1530, 482, 1530, 540, label="Approve", dashed=True, color=ORANGE, lcolor=ORANGE)

# ---------- เช็กลิสต์งานที่เหลือ ----------
cy = 1020
out.append(f'<rect x="36" y="{cy}" width="{W-72}" height="218" rx="10" fill="#FFF7ED" stroke="{ORANGE}" stroke-width="1.6"/>')
out.append(f'<text x="56" y="{cy+30}" font-size="14.5" font-weight="700" fill="#5B2A05">เช็กลิสต์สิ่งที่เหลือ (ทุกอย่างนอกเหนือจากนี้ต่อเสร็จแล้วบน canvas จริง) — สเต็ปคลิกละเอียดดู docs/jotform-build-sheet.md</text>')
steps = [
    "1)  [12] ลากจุด + ใต้กล่อง ไปวางบน [8] แล้วกดป้าย “Select Branch” บนเส้น เลือก Approve · ลากอีกเส้นไป [9] เลือก Deny  (ซูมออกให้เห็นทั้งสองกล่องก่อนลาก)",
    "2)  สร้าง [13] Approval (ผู้อนุมัติ dev.codegym@gmail.com) → ลากเส้นจาก [2] ไป [13] แล้วเลือกสาขา “7. แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ”",
    "3)  สร้าง [14] Email (ถึง อีเมลผู้ยื่นคำขอ {input20}, เรื่อง “สรุปผลการแก้ไขปัญหา”) → ต่อ [13] Approve → [14] และ [13] Deny → [9]",
    "4)  เปลี่ยนชื่อกล่องให้สื่อความ: [10] “Vehicle Registry Branch” · [12] “BPUU Staff ตรวจสอบทะเบียนรถ” (ตอนนี้เป็นชื่อ default)",
    "5)  ก่อนใช้จริง: เปลี่ยนผู้อนุมัติ [5] จาก yeongreserve@gmail.com → อีเมลหัวหน้างานจากฟิลด์ q30 ของฟอร์ม",
    "6)  แก้ตัวสะกดชื่อสาขา 6 ใน [2]: “คุ่สัญญา” → “คู่สัญญา” (เฉพาะชื่อโชว์ — เงื่อนไข q15 ถูกต้องอยู่แล้ว)",
    "7)  กด PUBLISH แล้วทดสอบด้วย Test run ทีละสาย (เลือกประเภทคำขอ × ประเภทผู้ใช้ ให้ครบทุกคู่)",
]
for i, s in enumerate(steps):
    out.append(f'<text x="56" y="{cy+58+i*23}" font-size="12" fill="#3D2A12">{esc(s)}</text>')

out.append('</svg>')

with open(__file__.replace('generate-workflow-blueprint-detailed.py', 'jotform-workflow-blueprint-detailed.svg'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))
print('written', len('\n'.join(out)), 'bytes')
