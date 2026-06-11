# JotForm Workflow — Build Sheet (ลอกตามได้เลย)

- Workflow: **Workflow Setup** (`261201384093450`) → แก้ที่ https://www.jotform.com/workflow/261201384093450/build
- ฟอร์มกลาง: Request Form (`261200763585052`) · แตกสายด้วย q15 (ประเภทคำขอ) + q16 (ประเภทผู้ใช้)
- ภาพรวมโฟลว์ทั้ง 7 สาย: ดู [jotform-workflow-blueprint.svg](jotform-workflow-blueprint.svg)
- สถานะด้านล่างเช็คจากข้อมูลจริงบนเซิร์ฟเวอร์ JotForm เมื่อ 11 มิ.ย. 2026

## สถานะตอนนี้

| สาย | เส้นทาง | สถานะ |
|---|---|---|
| 1. จอดรถค้างคืน | → User Type Branch → (บุคลากร) หัวหน้า → Staff → Manager → แจ้งผล / (นศ.+ภายนอก) Staff → ... | ✅ เสร็จ |
| 2. จอดรถรายเดือน | → BPUU Staff Review → Manager → แจ้งผล | ✅ เสร็จ |
| 3. ตราประทับ | → User Type Branch (ใช้ตัวเดียวกับสาย 1) | ✅ เสร็จ |
| 4. ทะเบียนรถ | → Conditional Branch ใหม่ (บุคลากร→Email FYI / นักศึกษา→Approval) | 🔶 เหลือ 2 เส้น (ข้อ A) |
| 5. พื้นที่ชั่วคราว | → User Type Branch (ตัวเดียวกับสาย 1) | ✅ เสร็จ |
| 6. เข้าพื้นที่คู่สัญญา | → BPUU Staff Review | ✅ เสร็จ |
| 7. แจ้งปัญหา | → Staff รับเรื่อง → แจ้งสรุปผล (ไม่มี Manager) | ⬜ ยังไม่เริ่ม (ข้อ B) |

ทุกขั้นอนุมัติที่มีอยู่: Deny → **Notify Requester Rejection** แล้วเรียบร้อย

## A. ปิดงานสาย 4 ทะเบียนรถ (เหลือนิดเดียว)

ของที่สร้างไว้แล้ว: **Conditional Branch** (สาขา บุคลากร/นักศึกษา จาก q16), **Email** ถึง dev.codegym@gmail.com
(subject "รับทราบคำขอทะเบียนรถ (บุคลากร) — ดำเนินการต่อใน IBGM") ต่อกับสาขาบุคลากรแล้ว, **Approval** (ยังชื่อ "Approval") ต่อกับสาขานักศึกษาแล้ว

1. ลากจาก **Approval** (ตัวใหม่ ใต้ Conditional Branch) ไปวางบน **Notify Requester Approval** → คลิกป้าย *Select Branch* บนเส้น → เลือก **Approve**
2. ลากอีกเส้นไปวางบน **Notify Requester Rejection** → เลือก **Deny**
3. (แนะนำ) เปลี่ยนชื่อให้อ่านง่าย: Conditional Branch → `User Type (ทะเบียนรถ)` และ Approval → `BPUU Staff ตรวจสอบทะเบียนรถ (อัปเดตฐาน Carpark)`
4. Approver ของ Approval ตอนนี้เป็น dev codegym (เจ้าของบัญชี) — ตรงตามพิมพ์เขียวแล้ว ไม่ต้องแก้

## B. สร้างสาย 7 แจ้งปัญหา

1. **Add Element → Approval** → ตั้งชื่อ `BPUU Staff รับเรื่องปัญหา` → approver `dev.codegym@gmail.com`
2. ลากจาก **Request Type Branch** ไปวางบน Approval นี้ → ป้าย *Select Branch* → เลือก **7. แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ**
3. **Add Element → Email** → ผู้รับปล่อยเป็น *อีเมลผู้ยื่นคำขอ* (ค่า default ถูกแล้ว) → Subject: `สรุปผลการแก้ไขปัญหาพื้นที่/ที่จอดรถ`
4. ต่อเส้น: Approval → **Approve** → Email สรุปผล / **Deny** → Notify Requester Rejection
5. ไม่ต้องมีขั้น Manager (ตามพิมพ์เขียว)

## C. จุดที่ควรแก้เพิ่ม (เจอจากการไล่ของจริง)

1. **Department Manager Approval** ใช้อีเมล static `yeongreserve@gmail.com` — พิมพ์เขียวกำหนดให้ดึงจากฟิลด์ q30 (อีเมลหัวหน้างาน): เปิด settings ของ element → ช่อง Approver → ลบอีเมลเดิม แล้วเลือก field จากฟอร์มแทน
2. ป้ายสาขา 6 ใน Request Type Branch สะกด **"คุ่สัญญา"** (ตัวเงื่อนไขจริงสะกดถูก "คู่สัญญา" แล้ว ใช้งานได้ปกติ) — อยากให้สวยค่อยแก้ชื่อใน Edit branches
3. Conditional Branch สาย 4 มี default outcome (Otherwise) ไม่ผูกเส้น — ถ้ามีคนเลือก "บุคคลภายนอก" ในสายทะเบียนรถจะค้าง; ปกติฟอร์มไม่เปิดตัวเลือกนี้ แต่ถ้าจะกันพลาดให้เพิ่มสาขา บุคคลภายนอก ชี้เข้า Approval ตัวเดียวกับนักศึกษา

## ทริคหน้า Builder (จากที่ลองจริง)

- การต่อเส้น: ชี้เมาส์ที่ element ต้นทางให้ปุ่ม **+** โผล่ขอบล่าง แล้วลากไปปล่อยบน element ปลายทาง — **ทั้งสอง node ต้องมองเห็นบนจอ** (ซูมออกก่อนถ้าอยู่คนละมุม)
- เส้นใหม่จะมีป้ายเทา **"Select Branch"** — คลิกป้าย (บางจังหวะต้องคลิก 2 ครั้ง) แล้วเลือกสาขา/Approve/Deny ระบบ save อัตโนมัติทันที
- มุมขวาบนไม่มีแบนเนอร์แดง **"1 Problem"** = ทุกเส้นผูกสาขาครบแล้ว
- ปุ่มซ้ายล่าง (ใต้ปุ่มซูม) = fit view ดูทั้งกราฟ
