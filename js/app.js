const STAFF_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRzYO0Kyv2yxDlo40zJ06bkb3Vh70X_HZj5gowDC_wHjCF2LxoaCu4CFLkBzd6j2Q4Do_3-ntiipx3-/pub?gid=955988221&single=true&output=csv";
const STUDENT_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRzYO0Kyv2yxDlo40zJ06bkb3Vh70X_HZj5gowDC_wHjCF2LxoaCu4CFLkBzd6j2Q4Do_3-ntiipx3-/pub?gid=32041089&single=true&output=csv";
const CONTRACT_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRzYO0Kyv2yxDlo40zJ06bkb3Vh70X_HZj5gowDC_wHjCF2LxoaCu4CFLkBzd6j2Q4Do_3-ntiipx3-/pub?gid=1831450496&single=true&output=csv";
const JOTFORM_FORM_ID = "261200763585052";
const JOTFORM_SUBMIT_URL = `https://submit.jotform.com/submit/${JOTFORM_FORM_ID}`;
const WORKFLOW_STORAGE_KEY = 'bpuu-workflow-tickets';
const LEGACY_WORKFLOW_STORAGE_KEYS = ['bpuu-admin-tickets'];
const WORKFLOW_BASE_SEQUENCE = 14;
const WORKFLOW_TEST_CONFIG = window.BPUU_WORKFLOW_TEST_CONFIG || {};

let currentSelectedForm = "";
let loginModalInstance = null;
let modlinkModalInstance = null;
let summaryModalInstance = null;
let successModalInstance = null;
let currentLoginType = ""; 

let staffDatabase = []; 
let studentDatabase = [];
let contractDatabase = []; 
let loadedDbs = 0; 
let globalUserData = null;
let staffDepartmentLookup = null;
let staffDepartmentLookupSourceSize = -1;

const OTHER_OVERNIGHT_PARKING_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc0_fqdfSl6Ix0tPu_m8Z7gs7OWd-LXUPO-FLmhTIfv2aWyw/viewform";
const JOTFORM_USER_TYPE_VALUES = {
    staff: "บุคลากร",
    student: "นักศึกษา",
    external: "บุคคลภายนอก"
};
const LOCAL_WORKFLOW_TEMPLATES = {
    overnightStaff: ['รับคำขอ', 'หัวหน้างานอนุมัติ', 'BPUU พิจารณา', 'BPUU Manager พิจารณา', 'BPUU Staff แจ้งยอด', 'รอชำระเงิน', 'ตรวจสลิป', 'ออกใบเสร็จ', 'แจ้งผลกลับผู้ขอ', 'ปิดเรื่อง'],
    overnightExternal: ['รับคำขอ', 'BPUU พิจารณา', 'BPUU Manager พิจารณา', 'BPUU Staff แจ้งยอด', 'รอชำระเงิน', 'ตรวจสลิป', 'ออกใบเสร็จ', 'แจ้งผลกลับผู้ขอ', 'ปิดเรื่อง'],
    monthlyRegular: ['รับคำขอ', 'BPUU ตรวจสอบ', 'BPUU Manager Sign', 'ส่ง QR Code / แจ้งยอด', 'รอชำระเงิน', 'ออกใบเสร็จ', 'ปิดเรื่อง'],
    monthlySpecial: ['รับคำขอ', 'BPUU ตรวจสอบ', 'BPUU Manager Sign', 'รองอธิการบดีฝ่ายการเงินฯ', 'รองอธิการบดีอาวุโสฝ่ายบริหาร', 'อธิการบดี', 'แจ้งผลกลับผู้ขอ'],
    monthlyBlocked: ['รับคำขอ', 'BPUU ตรวจสอบ', 'ตีกลับแก้ไขเอกสาร', 'รอข้อมูลจากผู้ขอ'],
    stampUnit: ['รับคำขอ', 'หัวหน้างานอนุมัติ', 'BPUU ตรวจสอบ', 'BPUU Manager Approve', 'ส่งคู่มือและรหัสตราประทับ', 'ปิดเรื่อง'],
    stampProject: ['รับคำขอ', 'BPUU ตรวจสอบ', 'BPUU Manager Approve', 'รองอธิการบดีฝ่ายการเงิน Approve', 'ส่งคู่มือและรหัสตราประทับ', 'ปิดเรื่อง'],
    plateRedirect: ['รับคำขอ', 'ส่งต่อไป IBGM', 'รอดำเนินการในระบบภายนอก'],
    plateStudent: ['รับคำขอ', 'ตรวจสอบข้อมูล', 'อัปเดตฐานข้อมูล Carpark', 'แจ้งผลผู้ยื่นคำขอ', 'ปิดเรื่อง'],
    tempInternal: ['รับคำขอ', 'หัวหน้างานอนุมัติ', 'BPUU ตรวจสอบ', 'BPUU Manager Sign', 'รองอธิการบดีฝ่ายการเงิน Approve', 'แจ้งผลกลับผู้ขอ', 'ปิดเรื่อง'],
    tempExternal: ['รับคำขอ', 'BPUU ตรวจสอบ', 'BPUU Manager Sign', 'แจ้งผลกลับผู้ขอ', 'ปิดเรื่อง'],
    contractVendor: ['รับคำขอ', 'BPUU พิจารณา', 'BPUU Manager พิจารณา', 'BPUU Manager อนุมัติ', 'ผู้ดูแลพื้นที่ตรวจสอบวัน', 'แจ้งผลกลับผู้ขอ', 'ปิดเรื่อง'],
    issueInternal: ['รับเรื่อง', 'แนะนำช่องทาง Modlink', 'BPUU รับเรื่อง', 'แก้ไขปัญหา', 'สรุปผล', 'ปิดเรื่อง'],
    issueExternal: ['รับเรื่อง', 'BPUU รับเรื่อง', 'แก้ไขปัญหา', 'สรุปผล', 'ปิดเรื่อง'],
    invoiceFollowup: ['ตรวจบันทึกจอดฟรี', 'รอหน่วยงานตอบกลับ', 'ออกใบแจ้งหนี้ D365', 'ตรวจรหัสงบประมาณ', 'บันทึกบัญชีรับ-จ่าย', 'ส่ง Voucher', 'ปิดเรื่อง']
};

function uniqueNonEmpty(values) {
    return [...new Set(values.map(value => (value || '').trim()).filter(Boolean))];
}

function buildStaffDepartmentLookup() {
    if (staffDepartmentLookup && staffDepartmentLookupSourceSize === staffDatabase.length) return staffDepartmentLookup;
    staffDepartmentLookup = new Map();
    staffDepartmentLookupSourceSize = staffDatabase.length;
    staffDatabase.forEach(row => {
        const code = (row[1] || '').trim();
        const name = (row[8] || '').trim();
        if (code && name && !staffDepartmentLookup.has(code)) {
            staffDepartmentLookup.set(code, name);
        }
    });
    return staffDepartmentLookup;
}

function getStaffDepartmentCodes(code) {
    const normalized = (code || '').trim();
    if (!/^\d{8}$/.test(normalized)) return normalized ? [normalized] : [];

    const l2 = `${normalized.slice(0, 3)}00000`;
    const l3 = `${normalized.slice(0, 5)}000`;

    if (normalized.endsWith('00000')) return [l2];
    if (normalized.endsWith('000')) return uniqueNonEmpty([l2, l3]);
    return uniqueNonEmpty([l2, l3, normalized]);
}

function getStaffDepartment(data) {
    const lookup = buildStaffDepartmentLookup();
    const currentCode = (data[1] || '').trim();
    const fallbackName = (data[8] || '').trim();
    const departmentNames = getStaffDepartmentCodes(currentCode)
        .map(code => lookup.get(code))
        .filter(Boolean);

    if (fallbackName && !departmentNames.includes(fallbackName)) {
        departmentNames.push(fallbackName);
    }

    if (!departmentNames.length) return '-';

    // Show the hierarchy from the top level to the user's current unit.
    return uniqueNonEmpty(departmentNames).join('\n');
}

function getTestEmailOverride(group, key, fallback = '') {
    const value = String(WORKFLOW_TEST_CONFIG?.[group]?.[key] || '').trim();
    return value || fallback || '';
}

function resolveRequesterEmail(loginType, fallback = '') {
    return getTestEmailOverride('requesterEmails', loginType, fallback);
}

function resolveApproverEmail(name, position, fallback = '') {
    const normalized = `${name || ''} ${position || ''}`.toLowerCase();
    let roleKey = '';

    if (normalized.includes('รองอธิการบดีฝ่ายการเงิน')) {
        roleKey = 'financeViceRector';
    } else if (normalized.includes('ผู้คุมพื้นที่') || normalized.includes('ผู้ดูแลพื้นที่')) {
        roleKey = 'areaController';
    } else if (normalized.includes('manager')) {
        roleKey = 'bpuuManager';
    } else if (normalized.includes('หัวหน้าฝ่าย') || normalized.includes('หัวหน้างาน')) {
        roleKey = 'bpuuHead';
    } else if (normalized.includes('bpuu')) {
        roleKey = 'bpuuStaff';
    }

    return roleKey ? getTestEmailOverride('roleEmails', roleKey, fallback) : (fallback || '');
}

function getLocalWorkflowStep(ticket) {
    const steps = LOCAL_WORKFLOW_TEMPLATES[ticket.workflowKey] || [];
    return steps[Math.max(0, Math.min(ticket.stepIndex || 0, steps.length - 1))] || '';
}

function getWorkflowAdminLink(ticket) {
    const tools = window.BPUU_APPROVAL_LINKS || {};
    if (typeof tools.buildApprovalLinkUrl === 'function') {
        return tools.buildApprovalLinkUrl(ticket, getLocalWorkflowStep(ticket), window.location.href);
    }

    const url = new URL('approve.html', window.location.href);
    url.searchParams.set('ticket', ticket.ticketId);
    return url.toString();
}

function getEmailRecipientForStep(ticket, step) {
    const roleEmails = WORKFLOW_TEST_CONFIG.roleEmails || {};
    const requesterEmail = ticket.requesterEmail
        || ticket.emailDetails?.requesterSubmittedEmail
        || ticket.requester?.submittedEmail
        || ticket.requester?.email
        || '';
    const approverEmail = ticket.approverEmail
        || ticket.emailDetails?.approverSubmittedEmail
        || '';
    const normalizedStep = String(step || '').toLowerCase();

    if (/แจ้งผลกลับผู้ขอ|แจ้งผลผู้ยื่นคำขอ|รอข้อมูลจากผู้ขอ|รอหน่วยงานตอบกลับ|ส่ง qr code|แจ้งยอด|รอชำระเงิน|ตรวจสลิป|ออกใบเสร็จ|ส่งคู่มือ|สรุปผล|ส่ง voucher|แนะนำช่องทาง/i.test(normalizedStep)) {
        return requesterEmail;
    }
    if (/อธิการบดี/i.test(step) && !/รองอธิการบดี/i.test(step)) return roleEmails.president || roleEmails.financeViceRector || approverEmail;
    if (/รองอธิการบดีอาวุโส/i.test(step)) return roleEmails.seniorViceRector || roleEmails.financeViceRector || approverEmail;
    if (/รองอธิการบดีฝ่ายการเงิน|การเงิน/i.test(step)) return roleEmails.financeViceRector || approverEmail;
    if (/ผู้คุมพื้นที่|ผู้ดูแลพื้นที่/i.test(step)) return roleEmails.areaController || approverEmail;
    if (/หัวหน้างาน|หัวหน้าฝ่าย/i.test(step)) return roleEmails.bpuuHead || approverEmail;
    if (/manager/i.test(step)) return roleEmails.bpuuManager || roleEmails.bpuuStaff || approverEmail;
    if (/bpuu/i.test(step) || /พิจารณา|ตรวจสอบ|อนุมัติ|รับเรื่อง|แก้ไขปัญหา|อัปเดตฐานข้อมูล|บันทึกบัญชี|ออกใบแจ้งหนี้|ตรวจรหัสงบประมาณ|ออกใบเสร็จ|ตรวจสลิป|แจ้งยอด/i.test(normalizedStep)) {
        return roleEmails.bpuuStaff || approverEmail;
    }
    return '';
}

function getEmailEventTypeForStep(step) {
    const value = String(step || '').toLowerCase();
    if (/ปิดเรื่อง|ปิดรายการ|รับคำขอ|รับเรื่อง|ส่งต่อไป ibgm/i.test(value)) return '';
    if (/ตีกลับ|แก้ไขเอกสาร|รอข้อมูลจากผู้ขอ|รอหน่วยงานตอบกลับ/i.test(value)) return 'more-info';
    if (/ส่ง qr code|แจ้งยอด|รอชำระเงิน/i.test(value)) return 'payment-notification';
    if (/แจ้งผลกลับผู้ขอ|แจ้งผลผู้ยื่นคำขอ|ส่งคู่มือ|สรุปผล|ส่ง voucher|แนะนำช่องทาง/i.test(value)) return 'completed';
    return 'approval-request';
}

function buildWorkflowEmail(ticket, eventType = 'approval-request') {
    const step = getLocalWorkflowStep(ticket);
    const primaryApprovalEmail = WORKFLOW_TEST_CONFIG.primaryApprovalEmail
        || WORKFLOW_TEST_CONFIG.roleEmails?.bpuuHead
        || WORKFLOW_TEST_CONFIG.roleEmails?.bpuuStaff
        || '';
    const recipient = eventType === 'received'
        ? ticket.requesterEmail
        : eventType === 'new-submission-approval'
            ? primaryApprovalEmail
            : getEmailRecipientForStep(ticket, step);
    const requesterName = ticket.requesterName || ticket.requester?.requesterName || '-';
    const serviceType = ticket.formName || 'คำขอใช้บริการ';
    const details = ticket.summaryText || ticket.note || '-';
    const submittedAt = formatThaiDateTime(ticket.submittedAt || new Date().toISOString());

    if (eventType === 'received') {
        return {
            to: recipient,
            subject: `[Received] ระบบได้รับคำขอ ${serviceType} (Ref: ${ticket.ticketId})`,
            body: [
                `เรียน คุณ ${requesterName}`,
                '',
                `ระบบกระบวนงานการให้บริการของกลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU) ได้รับคำขอใช้บริการ "${serviceType}" ของท่านเรียบร้อยแล้ว`,
                '',
                'รายละเอียดคำขอ:',
                `- หมายเลขคำขอ (Ticket No.): ${ticket.ticketId}`,
                `- วันที่ส่งเรื่อง: ${submittedAt}`,
                '- สถานะปัจจุบัน: รอการตรวจสอบ (Pending Review)',
                '',
                'เจ้าหน้าที่จะดำเนินการตรวจสอบข้อมูลและแจ้งผลการพิจารณาให้ท่านทราบผ่านทางอีเมลนี้',
                '',
                'ขอแสดงความนับถือ',
                'กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)',
                'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี'
            ].join('\n')
        };
    }

    if (eventType === 'new-submission-approval') {
        const adminLink = getWorkflowAdminLink(ticket);
        return {
            to: recipient,
            subject: `[Action Required] มีคำขอใหม่รออนุมัติ ${serviceType} (Ref: ${ticket.ticketId})`,
            body: [
                'เรียน ผู้อนุมัติ',
                '',
                'ระบบ BPUU ได้รับคำขอใหม่และต้องการให้ท่านตรวจสอบ/อนุมัติผ่านหน้าเว็บ',
                '',
                'ข้อมูลคำขอ:',
                `- หมายเลขคำขอ: ${ticket.ticketId}`,
                `- ผู้ขอ: ${requesterName}`,
                `- ประเภทบริการ: ${serviceType}`,
                `- ขั้นตอนปัจจุบัน: ${step || '-'}`,
                `- วันที่ส่งเรื่อง: ${submittedAt}`,
                `- รายละเอียด: ${details}`,
                '',
                'กรุณาเปิดรายการนี้ในระบบ:',
                adminLink,
                '',
                'หมายเหตุ: ลิงก์นี้ใช้อนุมัติหรือไม่อนุมัติได้เพียงครั้งเดียวเท่านั้น',
                '',
                'ขอแสดงความนับถือ',
                'BPUU Workflow System'
            ].join('\n')
        };
    }

    if (eventType === 'payment-notification') {
        const paymentResponseUrl = ticket.paymentResponseUrl || `${window.location.origin}/payment-response.html?ticket=${encodeURIComponent(ticket.ticketId)}`;
        const qrAttachment = ticket.paymentQrAttachment ? [{
            filename: ticket.paymentQrAttachment.name || 'payment-qr.png',
            content: ticket.paymentQrAttachment.dataUrl || '',
            contentType: ticket.paymentQrAttachment.type || 'image/png'
        }] : [];
        return {
            to: recipient,
            subject: `[Payment Required] แจ้งยอดชำระเงิน ${serviceType} (Ref: ${ticket.ticketId})`,
            body: [
                `เรียน คุณ ${requesterName}`,
                '',
                `กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน ขอแจ้งขั้นตอนชำระเงินสำหรับคำขอ "${serviceType}"`,
                '',
                `หมายเลขคำขอ: ${ticket.ticketId}`,
                `ขั้นตอนปัจจุบัน: ${step || '-'}`,
                `ยอดชำระ: ${Number(ticket.paymentAmount || 0).toLocaleString('th-TH')} บาท`,
                `รายละเอียด: ${details}`,
                '',
                'กรุณาชำระเงินตาม QR Code ที่แนบมา และแนบสลิปผ่านลิงก์ด้านล่าง',
                paymentResponseUrl,
                '',
                'ขอแสดงความนับถือ',
                'กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)'
            ].join('\n'),
            attachments: qrAttachment
        };
    }

    if (eventType === 'completed' || eventType === 'more-info') {
        const isMoreInfo = eventType === 'more-info';
        const receiptAttachment = ticket.receiptAttachment ? [{
            filename: ticket.receiptAttachment.name || 'receipt.pdf',
            content: ticket.receiptAttachment.dataUrl || '',
            contentType: ticket.receiptAttachment.type || 'application/pdf'
        }] : [];
        return {
            to: recipient,
            subject: `${isMoreInfo ? '[More Info Required]' : '[Completed]'} แจ้งผลคำขอ ${serviceType} (Ref: ${ticket.ticketId})`,
            body: [
                `เรียน คุณ ${requesterName}`,
                '',
                isMoreInfo
                    ? `กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน ขอข้อมูลหรือเอกสารเพิ่มเติมสำหรับคำขอ "${serviceType}"`
                    : `กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน ขอแจ้งความคืบหน้าของคำขอ "${serviceType}"`,
                '',
                `หมายเลขคำขอ: ${ticket.ticketId}`,
                `ขั้นตอนปัจจุบัน: ${step || '-'}`,
                `รายละเอียด: ${details}`,
                '',
                window.location.origin,
                '',
                'ขอแสดงความนับถือ',
                'กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)'
            ].join('\n'),
            attachments: receiptAttachment
        };
    }

    return {
        to: recipient,
        subject: `[Action Required] อนุมัติคำขอใช้บริการ ${serviceType} - คุณ ${requesterName}`,
        body: [
            'เรียน ผู้อนุมัติ',
            '',
            'มีรายการคำขอใหม่รอการอนุมัติจากท่าน กรุณาตรวจสอบรายละเอียดดังนี้:',
            '',
            'ข้อมูลคำขอ:',
            `- ผู้ขอ: ${requesterName}`,
            `- ประเภทบริการ: ${serviceType}`,
            `- ขั้นตอนปัจจุบัน: ${step || '-'}`,
            `- รายละเอียด: ${details}`,
            '',
            'กรุณาเลือกผลการพิจารณาในระบบ:',
            adminLink,
            '',
            'หมายเหตุ: ลิงก์นี้ใช้อนุมัติหรือไม่อนุมัติได้เพียงครั้งเดียวเท่านั้น'
        ].join('\n')
    };
}

function getEmailTransportEndpoint() {
    return String(WORKFLOW_TEST_CONFIG.emailTransport?.endpoint || '/api/send-email').trim();
}

async function sendWorkflowEmailViaApi(email, ticket, eventType) {
    if (!email?.to) return { ok: false, status: 'skipped', error: 'Missing recipient email' };
    const endpoint = getEmailTransportEndpoint();
    if (!endpoint) return { ok: false, status: 'skipped', error: 'Missing email API endpoint' };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: WORKFLOW_TEST_CONFIG.systemEmail || '',
                to: email.to,
                subject: email.subject,
                text: email.body,
                body: email.body,
                attachments: email.attachments || [],
                ticketId: ticket.ticketId,
                eventType,
                workflowKey: ticket.workflowKey,
                step: getLocalWorkflowStep(ticket)
            })
        });

        if (!response.ok) {
            const message = await response.text().catch(() => '');
            return { ok: false, status: 'failed', error: message || `HTTP ${response.status}` };
        }

        return { ok: true, status: 'sent' };
    } catch (error) {
        return { ok: false, status: 'failed', error: error?.message || 'Email API request failed' };
    }
}

function addWorkflowEmailEvent(ticket, email, eventType, status, errorMessage = '') {
    ticket.emailEvents = Array.isArray(ticket.emailEvents) ? ticket.emailEvents : [];
    ticket.emailEvents.unshift({
        id: `email-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        eventType,
        to: email?.to || '',
        subject: email?.subject || '',
        status,
        errorMessage,
        createdAt: new Date().toISOString()
    });
}

async function sendAndLogWorkflowEmail(ticket, eventType) {
    const email = buildWorkflowEmail(ticket, eventType);
    const result = await sendWorkflowEmailViaApi(email, ticket, eventType);
    addWorkflowEmailEvent(ticket, email, eventType, result.status, result.error || '');
    return result.ok;
}

function formatThaiDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function shouldHideExternalType(formName) {
    return formName === 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว' || formName === 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา';
}

function configureExternalContactForm(formName) {
    const typeSection = document.getElementById('divExtType');
    if (!typeSection) return;
    typeSection.style.display = shouldHideExternalType(formName) ? 'none' : 'block';
}

function getStampRequesterHTML() {
    if (currentLoginType !== 'staff' && currentLoginType !== 'student') return '';
    return `
        <div class="col-md-12">
            <label class="form-label text-ci-bluegrey fw-bold small">ขอในนาม <span class="req-star">*</span></label>
            <div class="d-flex flex-wrap gap-4 align-items-center">
                <div class="form-check">
                    <input class="form-check-input border-ci-bluegrey" type="radio" name="stampRequestFor" id="stampForProject" value="โครงการ" checked>
                    <label class="form-check-label" for="stampForProject">โครงการ</label>
                </div>
                <div class="form-check">
                    <input class="form-check-input border-ci-bluegrey" type="radio" name="stampRequestFor" id="stampForUnit" value="หน่วยงาน">
                    <label class="form-check-label" for="stampForUnit">หน่วยงาน</label>
                </div>
            </div>
        </div>
        <div class="col-md-12">
            <label class="form-label text-ci-bluegrey fw-bold small">ชื่อโครงการ / หน่วยงาน <span class="req-star">*</span></label>
            <input type="text" class="form-control border-light shadow-sm" id="stampProjectUnitName" placeholder="ระบุชื่อโครงการหรือหน่วยงาน">
        </div>`;
}

function getModlinkAdviceHTML() {
    if (currentLoginType !== 'staff' && currentLoginType !== 'student') return '';
    return `
        <div class="col-md-12">
            <div class="alert small mb-0 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-orange) !important;">
                <strong class="text-ci-orange"><i class="bi bi-megaphone-fill me-1"></i> แนะนำช่องทาง MOD LINK</strong><br>
                บุคลากรและนักศึกษา มจธ. สามารถแจ้งปัญหาและติดตามสถานะผ่านแอปพลิเคชัน MOD LINK ได้
            </div>
        </div>`;
}

document.addEventListener("DOMContentLoaded", function() {
    loginModalInstance = new bootstrap.Modal(document.getElementById('loginModal'));
    modlinkModalInstance = new bootstrap.Modal(document.getElementById('modlinkModal'));
    summaryModalInstance = new bootstrap.Modal(document.getElementById('summaryModal'));
    successModalInstance = new bootstrap.Modal(document.getElementById('successModal'));
    loadDatabases();
});

function loadDatabases() {
    Papa.parse(STAFF_DATA_URL, { download: true, header: false, skipEmptyLines: true, complete: function(results) { staffDatabase = results.data.slice(1); checkLoadingStatus(); }});
    Papa.parse(STUDENT_DATA_URL, { download: true, header: false, skipEmptyLines: true, complete: function(results) { studentDatabase = results.data.slice(1); checkLoadingStatus(); }});
    Papa.parse(CONTRACT_DATA_URL, { download: true, header: false, skipEmptyLines: true, complete: function(results) { contractDatabase = results.data; checkLoadingStatus(); }});
}

function checkLoadingStatus() {
    loadedDbs++;
    if(loadedDbs >= 3) {
        const loginBtn = document.getElementById('loginBtn');
        document.getElementById('loginSpinner').style.display = 'none';
        document.getElementById('loginBtnText').innerText = 'เข้าสู่ระบบ';
        loginBtn.disabled = false;
    }
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    window.scrollTo(0, 0);
    if(viewId === 'homeView') updateMenuVisibility();
}

function goHome() { 
    currentSelectedForm = "";
    currentLoginType ? switchView('homeView') : switchView('initialUserTypeView'); 
}

function logout() {
    currentLoginType = "";
    globalUserData = null;
    switchView('initialUserTypeView');
}

function setExternalUser() {
    currentLoginType = 'external';
    document.getElementById('welcomeText').innerText = "ยินดีต้อนรับ, บุคคลภายนอก";
    switchView('homeView');
}

function openLoginModal(type) {
    currentLoginType = type;
    const modalTitle = document.getElementById('loginModalTitle');
    const modalDesc = document.getElementById('loginModalDesc');
    const inputField = document.getElementById('loginEmpId');
    const modalHeader = document.getElementById('loginModalHeader');

    if(type === 'staff') {
        modalHeader.className = "modal-header bg-ci-orange text-white";
        modalTitle.innerHTML = '<i class="bi bi-person-badge-fill me-2"></i>เข้าสู่ระบบ (บุคลากร)';
        modalDesc.innerText = 'กรุณากรอกรหัสประจำตัวเพื่อดึงข้อมูลของคุณและสายการอนุมัติ';
        document.getElementById('lblReqId').innerText = "รหัสประจำตัว";
        inputField.value = "2550190"; 
    } else if(type === 'student') {
        modalHeader.className = "modal-header bg-ci-bluegrey text-white";
        modalTitle.innerHTML = '<i class="bi bi-mortarboard-fill me-2"></i>เข้าสู่ระบบ (นักศึกษา)';
        modalDesc.innerText = 'กรุณากรอกรหัสนักศึกษาเพื่อดึงข้อมูลของคุณ';
        document.getElementById('lblReqId').innerText = "รหัสนักศึกษา";
        inputField.value = "68070501034"; 
    }
    loginModalInstance.show();
}

function processLogin() {
    const inputId = document.getElementById('loginEmpId').value.trim();
    if(!inputId) { alert("กรุณากรอกรหัสเพื่อเข้าสู่ระบบ"); return; }

    if (currentLoginType === 'staff') {
        globalUserData = staffDatabase.find(row => row[0].trim() === inputId);
        if(!globalUserData) { alert("❌ ไม่พบข้อมูลบุคลากรนี้ในระบบ"); return; }
        let name = `${globalUserData[2] || ''}${globalUserData[3] || ''} ${globalUserData[4] || ''}`.trim();
        document.getElementById('welcomeText').innerText = `ยินดีต้อนรับ, ${name}`;
    } else if (currentLoginType === 'student') {
        globalUserData = studentDatabase.find(row => row[0].trim() === inputId);
        if(!globalUserData) { alert("❌ ไม่พบข้อมูลนักศึกษานี้ในระบบ"); return; }
        let title = (globalUserData[2] === "หญิง") ? "นางสาว" : (globalUserData[2] === "ชาย" ? "นาย" : "");
        let name = `${title}${globalUserData[3] || ''} ${globalUserData[4] || ''}`.trim();
        document.getElementById('welcomeText').innerText = `ยินดีต้อนรับ, ${name}`;
    }

    loginModalInstance.hide();
    switchView('homeView');
}

function updateMenuVisibility() {
    const allItems = document.querySelectorAll('.menu-item');
    allItems.forEach(item => item.style.display = 'block');

    if (currentLoginType === 'student' || currentLoginType === 'staff') {
        document.getElementById('menu-contract-area').style.display = 'none';
    } else if (currentLoginType === 'external') {
        document.getElementById('menu-contract-area').style.display = 'block'; // บุคคลภายนอกเห็นเข้าพื้นที่คู่สัญญา
        document.getElementById('menu-monthly').style.display = 'none';
        document.getElementById('menu-edit-plate').style.display = 'none';
        document.getElementById('menu-stamp').style.display = 'none'; // บุคคลภายนอกไม่เห็นตราประทับ
    }
}

function selectForm(formName) {
    currentSelectedForm = formName;
    
    if (formName === 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์' && currentLoginType === 'staff') {
        void logPlateRedirectTicket();
        window.open('https://app.ibgm.cloud/signin', '_blank');
        return; 
    }
    
    if (formName === 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา') {
        document.getElementById('externalFormHeaderTitle').innerText = formName;
        configureExternalContactForm(formName);
        renderDynamicForm(formName, 'dynamicExternalFormSection');
        switchView('externalFormView');
        setTimeout(initContractDropdowns, 100);
        return;
    }

    if (currentLoginType === 'external') {
        document.getElementById('externalFormHeaderTitle').innerText = formName + " (บุคคลภายนอก)";
        configureExternalContactForm(formName);
        renderDynamicForm(formName, 'dynamicExternalFormSection');
        switchView('externalFormView');
    } else {
        document.getElementById('formHeaderTitle').innerText = formName;
        fillInternalData(formName);
        renderDynamicForm(formName, 'dynamicFormSection');
        switchView('formContentView');

        if (formName === 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ' && (currentLoginType === 'staff' || currentLoginType === 'student')) {
            setTimeout(() => { modlinkModalInstance.show(); }, 500); 
        }
    }
}

function fillInternalData(formName) {
    if(!globalUserData) return;
    const d = globalUserData;
    const isStaff = currentLoginType === 'staff';

    document.getElementById('divReqId').style.display = isStaff ? 'none' : 'block';
    document.getElementById('divReqPosition').style.display = isStaff ? 'block' : 'none';
    document.getElementById('divReqDeptCode').style.display = isStaff ? 'block' : 'none';
    document.getElementById('divReqInternalPhone').style.display = isStaff ? 'block' : 'none';
    document.getElementById('divReqStatus').style.display = isStaff ? 'none' : 'block';
    document.getElementById('divReqFaculty').style.display = isStaff ? 'none' : 'block';
    document.getElementById('divReqMajor').style.display = isStaff ? 'none' : 'block';

    document.getElementById('reqEmpId').value = d[0];
    document.getElementById('reqEmail').value = isStaff ? d[6] : d[7];

    if (isStaff) {
        document.getElementById('reqName').value = `${d[2] || ''}${d[3] || ''} ${d[4] || ''}`.trim();
        document.getElementById('reqPosition').value = d[5] || '-';
        document.getElementById('reqDeptCode').value = getStaffDepartment(d);
        document.getElementById('reqInternalPhone').value = d[7] ? `0${d[7]}` : '-'; 
        setApprover(d[9], `${d[10] || ''}${d[11] || ''} ${d[12] || ''}`.trim(), d[14], d[13]);
    } else {
        let title = (d[2] === "หญิง") ? "นางสาว" : (d[2] === "ชาย" ? "นาย" : "");
        document.getElementById('reqName').value = `${title}${d[3] || ''} ${d[4] || ''}`.trim();
        document.getElementById('reqStatus').value = d[8] || '-';
        document.getElementById('reqFaculty').value = d[5] || '-';
        document.getElementById('reqMajor').value = d[6] || '-';
        setApprover(d[9], `${d[10] || ''}${d[11] || ''} ${d[12] || ''}`.trim(), d[14], d[13]);
    }

    const showApprover = formName !== 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ' && (isStaff || (currentLoginType === 'student' && formName === 'แบบฟอร์มขอใช้ตราประทับ'));
    const hideApprover = !showApprover;
    document.getElementById('approverSectionTitle').style.display = hideApprover ? 'none' : 'block';
    document.getElementById('approverSectionContent').style.display = hideApprover ? 'none' : 'flex';
    
    if(!hideApprover) {
        const approverContext = isStaff ? 'สายงานบุคลากร' : 'สายงานนักศึกษา';
        document.getElementById('approverSectionTitle').innerHTML = `<i class="bi bi-2-circle-fill me-2"></i>ส่วนที่ 2: ข้อมูลผู้มีอำนาจอนุมัติ (${approverContext})`;
    }
    document.getElementById('dynamicSectionTitle').innerHTML = hideApprover ? '<i class="bi bi-2-circle-fill me-2"></i>ส่วนที่ 2: รายละเอียดคำขอ' : '<i class="bi bi-3-circle-fill me-2"></i>ส่วนที่ 3: รายละเอียดคำขอ';
}

function setApprover(id, name, pos, email) {
    const isErr = !id || id.includes("หาหน่วยงานไม่เจอ") || id.includes("ไม่พบข้อมูล");
    document.getElementById('appName').value = isErr ? 'ไม่มีข้อมูลผู้อนุมัติในสายงาน (ติดต่อส่วนกลาง)' : name;
    document.getElementById('appPosition').value = isErr ? '-' : pos;
    document.getElementById('appEmail').innerText = isErr ? '-' : email;
    document.getElementById('appEmail').className = isErr ? "text-danger fw-bold border-bottom border-danger" : "text-dark fw-bold border-bottom border-ci-yellow";
}

function renderDynamicForm(formName, targetContainerId) {
    const container = document.getElementById(targetContainerId);
    container.innerHTML = ""; 
    let formHTML = "";

    switch (formName) {
        case 'แบบฟอร์มขอจอดรถรายเดือน':
            let monthlyForOtherHTML = "";
            let monthlyContractFileHTML = "";
            if (currentLoginType === 'staff') {
                monthlyForOtherHTML = `
                    <div class="col-md-12 mb-2">
                        <label class="form-label text-ci-bluegrey fw-bold small">ผู้ใช้บริการจริง <span class="req-star">*</span></label>
                        <div class="d-flex flex-wrap gap-4 align-items-center">
                            <div class="form-check">
                                <input class="form-check-input border-ci-bluegrey" type="radio" name="monthlyForWho" id="monthlyForMe" value="ตนเอง" checked onchange="toggleMonthlyForOther()">
                                <label class="form-check-label" for="monthlyForMe">ขอให้ตนเอง</label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input border-ci-bluegrey" type="radio" name="monthlyForWho" id="monthlyForOther" value="ผู้อื่น" onchange="toggleMonthlyForOther()">
                                <label class="form-check-label" for="monthlyForOther">ขอให้ผู้อื่น</label>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-12" id="divMonthlyOtherDetails" style="display:none;">
                        <div class="p-3 bg-light rounded border border-light shadow-sm mb-3" style="border-left: 4px solid var(--ci-orange) !important;">
                            <label class="form-label fw-bold text-ci-orange small mb-3">ระบุข้อมูลผู้ใช้บริการจริง</label>
                            <div class="row g-3">
                                <div class="col-md-12">
                                    <label class="form-label text-ci-bluegrey fw-bold small">ชื่อ-สกุล <span class="req-star">*</span></label>
                                    <input type="text" class="form-control" id="monthlyOtherName" placeholder="ระบุชื่อ-สกุล ผู้ใช้บริการจริง">
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label text-ci-bluegrey fw-bold small">เบอร์โทรศัพท์ <span class="req-star">*</span></label>
                                    <input type="tel" class="form-control" id="monthlyOtherPhone" placeholder="08X-XXX-XXXX">
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label text-ci-bluegrey fw-bold small">อีเมล <span class="req-star">*</span></label>
                                    <input type="email" class="form-control" id="monthlyOtherEmail" placeholder="example@domain.com">
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                monthlyContractFileHTML = `
                    <div class="col-md-12">
                        <label class="form-label text-ci-bluegrey fw-bold small">แนบสัญญาจ้าง <span class="req-star">*</span></label>
                        <input type="file" class="form-control border-light shadow-sm" id="monthlyContractFile" accept=".pdf, .jpg, .png">
                    </div>`;
            }

            formHTML = `
                <div class="row g-3 text-start">
                    ${monthlyForOtherHTML}
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">ข้อมูลรถ <span class="req-star">*</span></label><input type="text" class="form-control" placeholder="เช่น 1กข2345 (ไม่ต้องเว้นวรรค และไม่ต้องระบุจังหวัด)" id="in_monthly_plate"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">วันที่เริ่มต้น <span class="req-star">*</span></label><input type="date" class="form-control" id="parkingStartDate" onchange="calculateEndDate()"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">วันที่สิ้นสุด (คำนวณอัตโนมัติ 1 เดือน)</label><input type="text" class="form-control bg-light text-dark fw-bold" id="parkingEndDate" readonly placeholder="DD/MM/YYYY"></div>
                    ${monthlyContractFileHTML}
                    
                    <div class="col-12 mt-4">
                        <div class="alert small mb-2 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-yellow) !important;">
                            <strong class="text-ci-orange"><i class="bi bi-info-circle-fill me-1 text-ci-yellow"></i> เงื่อนไขการใช้บริการ:</strong><br>
                            <ol class="mb-0 mt-2 ps-3 text-dark">
                                <li>การเก็บรวมรวม ใช้และเปิดเผยข้อมูลส่วนบุคคลนี้ ได้รับการยกเว้นไม่ต้องขอความยินยอมตามมาตรา 24 มาตรา 27 แห่ง พระราชบัญญัติ คุ้มครองข้อมูลส่วนบุคคล พ.ศ.2562</li>
                                <li>เมื่อท่านกรอกรหัสนักศึกษา/บุคลากร ทำการตรวจสอบข้อมูลจากระบบหลัก</li>
                                <li>ระยะเวลา 1 เดือน นับจากวันที่เริ่มใช้งาน เช่น 20/01/XXXX-19/02/XXXX (ระยะเวลา 1 เดือน)</li>
                                <li>ต่อรายเดือนครั้งถัดไปที่ ตู้ Kiosk ชั้น 1 อาคารจอดรถ (S2)</li>
                                <li>ค่าบำรุงสถานที่อาคารจอดรถ สำหรับนักศึกษาอัตรา 900 บาท/เดือน</li>
                            </ol>
                        </div>
                        <div class="form-check mt-3">
                            <input class="form-check-input border-ci-bluegrey" type="checkbox" id="consentCheck">
                            <label class="form-check-label fw-bold text-dark" for="consentCheck">รับทราบและตกลงให้ความยินยอม (Consent)</label>
                        </div>
                    </div>
                </div>`;
            break;

        case 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)':
            const overnightOtherPlaceHTML = currentLoginType === 'staff' ? `
                <div class="col-12">
                    <div class="alert small mb-0 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-orange) !important;">
                        หากต้องการจอดรถค้างคืนสถานที่อื่นในมหาวิทยาลัย
                        <a href="${OTHER_OVERNIGHT_PARKING_URL}" target="_blank" class="fw-bold text-decoration-none text-ci-orange">คลิกที่นี่</a>
                    </div>
                </div>` : '';
            const overnightReasonOptions = currentLoginType === 'external'
                ? '<option value="" selected disabled>-- กรุณาระบุเหตุผล --</option><option value="2">เหตุสุดวิสัย</option><option value="3">อื่น ๆ (ต้องดำเนินการขอจอดล่วงหน้าอย่างน้อย 1 สัปดาห์)</option>'
                : '<option value="" selected disabled>-- กรุณาระบุเหตุผล --</option><option value="1">กรณีไปราชการ หรือ ปฏิบัติงานของมหาวิทยาลัย</option><option value="2">เหตุสุดวิสัย</option><option value="3">อื่น ๆ (ต้องดำเนินการขอจอดล่วงหน้าอย่างน้อย 1 สัปดาห์)</option>';
            const overnightStaffFileHTML = currentLoginType === 'staff' ? `
                    <div class="col-md-12">
                        <label class="form-label text-ci-bluegrey fw-bold small">แนบไฟล์เพิ่มเติม <span class="text-muted fw-normal">(ถ้ามี)</span></label>
                        <input type="file" class="form-control border-light shadow-sm" id="overnightStaffFile" accept=".pdf, .jpg, .png">
                    </div>` : '';
            formHTML = `
                <div class="row g-3 text-start">
                    ${overnightOtherPlaceHTML}
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">ข้อมูลรถ <span class="req-star">*</span></label><input type="text" class="form-control" id="in_overnight_plate" placeholder="เช่น 1กข2345 (ไม่ต้องเว้นวรรค และไม่ต้องระบุจังหวัด)"></div>
                    <div class="col-md-12">
                        <div class="form-check">
                            <input class="form-check-input border-ci-bluegrey" type="checkbox" id="overnightMultipleCars" onchange="toggleOvernightMultipleCars()">
                            <label class="form-check-label fw-bold text-dark" for="overnightMultipleCars">ขอจอดมากกว่า 1 คัน</label>
                        </div>
                    </div>
                    <div class="col-md-12" id="divOvernightMultipleCars" style="display:none;">
                        <div class="p-3 bg-light rounded border border-light shadow-sm" style="border-left: 4px solid var(--ci-yellow) !important;">
                            <div class="row g-3">
                                <div class="col-md-4">
                                    <label class="form-label text-ci-bluegrey fw-bold small">จำนวนรถทั้งหมด <span class="req-star">*</span></label>
                                    <select class="form-select border-light shadow-sm" id="overnightCarCount" onchange="renderOvernightCarFields()">
                                        <option value="2" selected>2 คัน</option>
                                        <option value="3">3 คัน</option>
                                        <option value="4">4 คัน</option>
                                        <option value="5">5 คัน</option>
                                        <option value="6">6 คัน</option>
                                        <option value="7">7 คัน</option>
                                        <option value="8">8 คัน</option>
                                        <option value="9">9 คัน</option>
                                        <option value="10">10 คัน</option>
                                    </select>
                                </div>
                                <div class="col-md-12" id="overnightCarFields"></div>
                            </div>
                        </div>
                    </div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">วันที่เริ่มต้น <span class="req-star">*</span></label><input type="date" class="form-control" id="overnightStartDate" onchange="calculateDuration('overnightStartDate', 'overnightEndDate', 'overnightTotalDays', 'nights')"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">วันที่สิ้นสุด <span class="req-star">*</span></label><input type="date" class="form-control" id="overnightEndDate" onchange="calculateDuration('overnightStartDate', 'overnightEndDate', 'overnightTotalDays', 'nights')"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">จำนวนคืน</label><div class="input-group"><input type="text" class="form-control bg-light text-dark fw-bold text-center" id="overnightTotalDays" readonly value="0"><span class="input-group-text bg-white border-light text-ci-bluegrey">คืน</span></div></div>
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">เหตุผลการขอจอด <span class="req-star">*</span></label><select class="form-select border-light shadow-sm" id="overnightReason" onchange="toggleReasonDetails()">${overnightReasonOptions}</select></div>
                    <div class="col-md-12 p-3 bg-light rounded mt-3 shadow-sm border border-light" id="divReasonDetails" style="display:none; border-left: 4px solid var(--ci-orange) !important;"><label class="form-label fw-bold text-ci-orange small">ระบุรายละเอียดเพิ่มเติม <span class="req-star">*</span></label><textarea class="form-control mb-3 border-light" rows="3" id="in_overnight_detail" placeholder="โปรดระบุรายละเอียดให้ชัดเจน..."></textarea><div id="divReasonFile"><label class="form-label fw-bold text-ci-bluegrey small">แนบเอกสารประกอบการพิจารณา <span class="req-star">*</span></label><input type="file" class="form-control border-light" accept=".pdf, .jpg, .png"></div></div>
                    ${overnightStaffFileHTML}
                    
                    <div class="col-12 mt-4">
                        <div class="alert small mb-2 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-yellow) !important;">
                            <strong class="text-ci-orange"><i class="bi bi-info-circle-fill me-1 text-ci-yellow"></i> เงื่อนไข การขอจอดรถค้างคืน:</strong><br>
                            <span class="text-muted">(ตามประกาศมหาวิทยาลัยฯ เรื่อง อัตราค่าบริหารจัดการและระเบียบสถานที่จอดรถภายในมหาวิทยาลัย พ.ศ. 2562)</span>
                            <ol class="mb-0 mt-2 ps-3 text-dark">
                                <li>กรณีขออนุญาตไปราชการ / กิจกรรมของมหาวิทยาลัย</li>
                                <li>เหตุสุดวิสัย เช่น รถเสีย เป็นต้น</li>
                                <li>กรณีข้อมูล (เอกสารแนบ) เป็นไปตามเงื่อนไข / ไม่เป็นไปตามเงื่อนไขของประกาศ ใช้ระยะเวลา 1 วัน (ในวันเวลาราชการ) ในการพิจารณาผล</li>
                                <li>กรณีต้องการขอข้อมูล / เอกสารเพิ่มเติม จะแจ้งกลับทางภายใน 1 ชม. และจะส่งอีเมล์แจ้งผลการพิจารณา</li>
                            </ol>
                        </div>
                        <div class="form-check mt-3">
                            <input class="form-check-input border-ci-bluegrey" type="checkbox" id="consentCheck">
                            <label class="form-check-label fw-bold text-dark" for="consentCheck">รับทราบและตกลงให้ความยินยอม (Consent)</label>
                        </div>
                    </div>
                </div>`;
            break;

        case 'แบบฟอร์มขอใช้ตราประทับ':
            formHTML = `
                <div class="row g-3 text-start">
                    ${getStampRequesterHTML()}
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">ประเภทผู้ใช้ตราประทับ <span class="req-star">*</span></label><select class="form-select border-light shadow-sm" id="in_stamp_type" onchange="toggleStampOther(this)"><option value="" selected disabled>-- กรุณาระบุประเภท --</option><option value="วิทยากร">วิทยากร</option><option value="ผู้เข้าร่วมอบรม/ผู้เข้าร่วมกิจกรรม/ผู้เข้าร่วมงาน">ผู้เข้าร่วมอบรม/ผู้เข้าร่วมกิจกรรม/ผู้เข้าร่วมงาน</option><option value="โครงการ/อบรม/สัมมนา">โครงการ/อบรม/สัมมนา</option><option value="อื่นๆ">อื่น ๆ</option></select><input type="text" id="in_stamp_other" class="form-control mt-2 border-light shadow-sm" style="display:none;" placeholder="โปรดระบุประเภทผู้ใช้ตราประทับ"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">วันที่เริ่มต้น <span class="req-star">*</span></label><input type="date" class="form-control" id="stampStartDate" onchange="calculateDuration('stampStartDate', 'stampEndDate', 'stampTotalDays', 'days')"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">วันที่สิ้นสุด <span class="req-star">*</span></label><input type="date" class="form-control" id="stampEndDate" onchange="calculateDuration('stampStartDate', 'stampEndDate', 'stampTotalDays', 'days')"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">จำนวนวัน</label><div class="input-group"><input type="text" class="form-control bg-light text-dark fw-bold text-center" id="stampTotalDays" readonly value="0"><span class="input-group-text bg-white border-light text-ci-bluegrey">วัน</span></div></div>
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">แนบรายละเอียดเอกสาร <span class="req-star">*</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>
                    
                    <div class="col-12 mt-4">
                        <div class="alert small mb-2 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-yellow) !important;">
                            <strong class="text-ci-orange"><i class="bi bi-info-circle-fill me-1 text-ci-yellow"></i> เงื่อนไข การขอใช้ตราประทับ:</strong><br>
                            <span class="text-muted">(ตามประกาศมหาวิทยาลัยฯ เรื่อง อัตราค่าบริหารจัดการและระเบียบสถานที่จอดรถภายในมหาวิทยาลัย พ.ศ. 2562)</span>
                            <ol class="mb-0 mt-2 ps-3 text-dark">
                                <li>กรณีข้อมูล (เอกสารแนบ) เป็นไปตามเงื่อนไข / ไม่เป็นไปตามเงื่อนไขของประกาศ ใช้ระยะเวลา 1 วัน (ในวันเวลาราชการ) ในการพิจารณาผล</li>
                                <li>ทางกลุ่มงานจัดการผลประโยชน์และทรัพย์สิน จะส่งคู่มือการใช้งานกลับไปยังอีเมล์ที่ผู้ขอใช้ตราประทับ</li>
                                <li>หน่วยงานที่จัดอบรมสัมมนาเป็นผู้รับผิดชอบค่าบำรุงสถานที่จอดรถ อัตรา 20 บาท/คัน/วัน ตามประกาศฯ</li>
                                <li>เมื่อหน่วยงานใช้ตราประทับเรียบร้อยแล้ว ให้หน่วยงานตรวจสอบความถูกต้อง หากมีข้อมูลแก้ไข ให้แจ้งภายใน 2 วันทำการ</li>
                            </ol>
                        </div>
                        <div class="form-check mt-3">
                            <input class="form-check-input border-ci-bluegrey" type="checkbox" id="consentCheck">
                            <label class="form-check-label fw-bold text-dark" for="consentCheck">รับทราบข้อตกลงและให้ความยินยอม (Consent)</label>
                        </div>
                    </div>
                </div>`;
            break;

        case 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์':
            formHTML = `
                <div class="row g-3 text-start">
                    <div class="col-12">
                        <label class="form-label text-ci-bluegrey fw-bold small">ประเภทคำขอ <span class="req-star">*</span></label>
                        <div class="d-flex flex-wrap gap-4 align-items-center mb-3">
                            <div class="form-check">
                                <input class="form-check-input border-ci-bluegrey" type="radio" name="plateAction" id="plateActionAdd" value="เพิ่ม" checked onchange="togglePlateAction()">
                                <label class="form-check-label" for="plateActionAdd">เพิ่มทะเบียน</label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input border-ci-bluegrey" type="radio" name="plateAction" id="plateActionEdit" value="แก้ไข" onchange="togglePlateAction()">
                                <label class="form-check-label" for="plateActionEdit">แก้ไขทะเบียน</label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input border-ci-bluegrey" type="radio" name="plateAction" id="plateActionCancel" value="ยกเลิก" onchange="togglePlateAction()">
                                <label class="form-check-label" for="plateActionCancel">ยกเลิกทะเบียน</label>
                            </div>
                        </div>
                        <div class="row g-3 align-items-end">
                            <div class="col-md-4">
                                <label class="form-label text-ci-bluegrey fw-bold small">จำนวนคันที่ต้องการดำเนินการ <span class="req-star">*</span></label>
                                <select class="form-select border-light shadow-sm" id="plateActionCount" onchange="renderPlateActionFields()">
                                    <option value="1" selected>1 คัน</option>
                                    <option value="2">2 คัน</option>
                                    <option value="3">3 คัน</option>
                                    <option value="4">4 คัน</option>
                                    <option value="5">5 คัน</option>
                                </select>
                            </div>
                            <div class="col-md-8">
                                <div class="small text-ci-bluegrey">รองรับสูงสุด 5 คันต่อคำขอ</div>
                            </div>
                        </div>
                        <div id="plateActionFields" class="mt-3"></div>
                    </div>
                    
                    <div class="col-12 mt-4">
                        <div class="alert small mb-2 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-yellow) !important;">
                            <strong class="text-ci-orange"><i class="bi bi-info-circle-fill me-1 text-ci-yellow"></i> เงื่อนไข การเพิ่ม/แก้ไข/ยกเลิก ทะเบียนรถยนต์:</strong><br>
                            <ol class="mb-0 mt-2 ps-3 text-dark">
                                <li><strong>รถยนต์ของท่านต้องอยู่นอกลานจอดรถ</strong> ในขณะที่ทำการอนุมัติข้อมูล</li>
                                <li>อาคารจอดรถ (S2) เปิดให้บริการตั้งแต่ 05.00 น. ถึง 24.00 น. หากพ้นเวลาดังกล่าวจะคิดค่าบริการค้างคืน 400 บาท/คัน/วัน</li>
                            </ol>
                        </div>
                        <div class="form-check mt-3">
                            <input class="form-check-input border-ci-bluegrey" type="checkbox" id="consentCheck">
                            <label class="form-check-label fw-bold text-dark" for="consentCheck">รับทราบและตกลงให้ความยินยอม (Consent)</label>
                        </div>
                    </div>
                </div>`;
            break;

        case 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว':
            formHTML = `
                <div class="row g-3 text-start">
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">ชื่อกิจกรรม <span class="req-star">*</span></label><input type="text" class="form-control border-light shadow-sm" id="in_area_event"></div>
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">ทะเบียนรถยนต์ <span class="text-muted fw-normal">(ถ้ามี)</span></label><input type="text" class="form-control border-light shadow-sm" id="in_area_plate" placeholder="เช่น 1กข2345 (ไม่ต้องเว้นวรรค)"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">วันที่เริ่มต้น <span class="req-star">*</span></label><input type="date" class="form-control border-light shadow-sm" id="areaStartDate"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">เวลาเริ่มต้น <span class="req-star">*</span></label><input type="time" class="form-control border-light shadow-sm" id="areaStartTime" step="60"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">วันที่สิ้นสุด <span class="req-star">*</span></label><input type="date" class="form-control border-light shadow-sm" id="areaEndDate"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">เวลาสิ้นสุด <span class="req-star">*</span></label><input type="time" class="form-control border-light shadow-sm" id="areaEndTime" step="60"></div>
                    <div class="col-md-12 mt-4"><label class="form-label text-ci-bluegrey fw-bold small">วัตถุประสงค์ <span class="req-star">*</span></label><div class="form-check mb-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="obj1" value="ประชาสัมพันธ์"><label class="form-check-label" for="obj1">ประชาสัมพันธ์</label></div><div class="form-check mb-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="obj2" value="แจกผลิตภัณฑ์"><label class="form-check-label" for="obj2">แจกผลิตภัณฑ์</label></div><div class="form-check d-flex align-items-center gap-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="obj3" value="อื่นๆ" onchange="toggleOtherInput('obj3', 'objOtherText')"><label class="form-check-label text-nowrap" for="obj3">อื่น ๆ</label><input type="text" class="form-control form-control-sm w-50 border-light shadow-sm" id="objOtherText" placeholder="โปรดระบุ" disabled></div></div>
                    <div class="col-md-12 mt-4"><label class="form-label text-ci-bluegrey fw-bold small">สถานที่ <span class="req-star">*</span></label><div class="form-check mb-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="loc1" value="อาคารจอดรถ 1 (S2)"><label class="form-check-label" for="loc1">อาคารจอดรถ 1 (S2)</label></div><div class="form-check mb-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="loc2" value="โรงอาหาร (S14)"><label class="form-check-label" for="loc2">โรงอาหาร (S14)</label></div><div class="form-check d-flex align-items-center gap-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="loc3" value="อื่นๆ" onchange="toggleOtherInput('loc3', 'locOtherText')"><label class="form-check-label text-nowrap" for="loc3">อื่น ๆ</label><input type="text" class="form-control form-control-sm w-50 border-light shadow-sm" id="locOtherText" placeholder="โปรดระบุสถานที่" disabled></div></div>
                    
                    <div class="col-md-12 mt-4"><label class="form-label text-ci-bluegrey fw-bold small">แนบรายละเอียดกิจกรรม <span class="req-star">*</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>
                    <div class="col-md-12 mt-2"><label class="form-label text-ci-bluegrey fw-bold small">แนบไฟล์เพิ่มเติม <span class="text-muted fw-normal">(ถ้ามี)</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>
                    <div class="col-md-12 mt-2"><label class="form-label text-ci-bluegrey fw-bold small">ข้อความเสนอพิจารณา</label><textarea class="form-control border-light shadow-sm" rows="3" placeholder="ระบุรายละเอียดเพิ่มเติม..."></textarea></div>
                    <div class="col-12 mt-4">
                        <div class="form-check">
                            <input class="form-check-input border-ci-bluegrey" type="checkbox" id="consentCheck">
                            <label class="form-check-label fw-bold text-dark" for="consentCheck">รับทราบและตกลงให้ความยินยอม (Consent)</label>
                        </div>
                    </div>
                </div>`;
            break;

        case 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา':
            formHTML = `
                <div class="row g-3 text-start">
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">ทะเบียนรถยนต์ <span class="text-muted fw-normal">(ถ้ามี)</span></label><input type="text" class="form-control border-light shadow-sm" id="in_contract_plate" placeholder="เช่น 1กข2345"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">วันที่เข้าพื้นที่ <span class="req-star">*</span></label><input type="date" class="form-control border-light shadow-sm" id="in_contract_date"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">ตั้งแต่เวลา <span class="req-star">*</span></label><input type="time" class="form-control border-light shadow-sm" id="in_contract_time_start"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">ถึงเวลา <span class="req-star">*</span></label><input type="time" class="form-control border-light shadow-sm" id="in_contract_time_end"></div>
                    
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">1. ชื่อบริษัท <span class="req-star">*</span></label><select class="form-select border-light shadow-sm" id="contractCompany" onchange="onCompanyChange()"><option value="" selected disabled>กำลังโหลดข้อมูล...</option></select></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">2. ประเภทธุรกิจ <span class="req-star">*</span></label><select class="form-select border-light shadow-sm" id="contractBusinessType" onchange="onBusinessTypeChange()" disabled><option value="" selected disabled>-- เลือกประเภทธุรกิจ --</option></select></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">3. พื้นที่การศึกษา <span class="req-star">*</span></label><select class="form-select border-light shadow-sm" id="contractCampus" onchange="onCampusChange()" disabled><option value="" selected disabled>-- เลือกพื้นที่การศึกษา --</option></select></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">4. อาคาร <span class="req-star">*</span></label><select class="form-select border-light shadow-sm" id="contractBuilding" disabled><option value="" selected disabled>-- เลือกอาคาร --</option></select></div>

                    <div class="col-md-12 mt-4"><label class="form-label text-ci-bluegrey fw-bold small">ข้อความเสนอพิจารณา</label><textarea class="form-control border-light shadow-sm" rows="3" placeholder="ระบุรายละเอียด หรือเหตุผลการเข้าพื้นที่..."></textarea></div>
                    
                    <div class="col-md-12 mt-2"><label class="form-label text-ci-bluegrey fw-bold small">เอกสารแนบ <span class="req-star">*</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>
                    <div class="col-md-12 mt-2"><label class="form-label text-ci-bluegrey fw-bold small">แนบไฟล์แจ้งปัญหาการใช้บริการ <span class="text-muted fw-normal">(ถ้ามี)</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>
                    <div class="col-md-12 mt-2"><label class="form-label text-ci-bluegrey fw-bold small">แนบไฟล์อื่นๆ <span class="text-muted fw-normal">(ถ้ามี)</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>

                    <div class="col-12 mt-4">
                        <div class="alert small mb-2 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-yellow) !important;">
                            <strong class="text-ci-orange"><i class="bi bi-info-circle-fill me-1 text-ci-yellow"></i> เงื่อนไข การขอเข้าพื้นที่:</strong><br>
                            <p class="mb-1 mt-1 text-dark">กรุณาศึกษาและปฏิบัติตามกฎระเบียบของมหาวิทยาลัยอย่างเคร่งครัด</p>
                            <a href="https://bpuu.kmutt.ac.th/wp-content/uploads/2020/02/%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%B2%E0%B8%A8-%E0%B9%80%E0%B8%A3%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%87%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B5%E0%B8%A2%E0%B8%9A%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B9%83%E0%B8%8A%E0%B9%89%E0%B8%AA%E0%B8%96%E0%B8%B2%E0%B8%99%E0%B8%97%E0%B8%B5%E0%B9%88.pdf" target="_blank" class="fw-bold text-decoration-none text-ci-bluegrey">
                                <i class="bi bi-file-earmark-pdf-fill text-ci-orange"></i> คลิกเพื่ออ่านประกาศฯ เรื่องอัตราค่าบำรุงการใช้สถานที่ พ.ศ. 2549
                            </a>
                        </div>
                        <div class="form-check mt-3">
                            <input class="form-check-input border-ci-bluegrey" type="checkbox" id="consentCheck">
                            <label class="form-check-label fw-bold text-dark" for="consentCheck">รับทราบและตกลงให้ความยินยอม (Consent)</label>
                        </div>
                    </div>
                </div>`;
            break;

        case 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ':
            formHTML = `
                <div class="row g-3 text-start">
                    ${getModlinkAdviceHTML()}
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">เลือกกลุ่มของปัญหาที่แจ้ง <span class="req-star">*</span></label><select class="form-select border-light shadow-sm" id="issueCategory"><option value="" selected disabled>-- กรุณาเลือกสถานที่/กลุ่มปัญหา --</option><option value="ตลาดนัด">ตลาดนัด</option><option value="โรงอาหาร">โรงอาหาร</option><option value="อาคารจอดรถ">อาคารจอดรถ</option><option value="อื่นๆ">อื่นๆ</option></select></div>
                    <div class="col-md-12 mt-3"><label class="form-label text-ci-bluegrey fw-bold small">รายละเอียดปัญหาที่พบ <span class="req-star">*</span></label><textarea class="form-control border-light shadow-sm" id="issueDetail" rows="4"></textarea></div>
                    <div class="col-md-12 mt-3"><label class="form-label text-ci-bluegrey fw-bold small">แนบรูปภาพ หรือ เอกสารเพิ่มเติม <span class="text-muted fw-normal">(ถ้ามี)</span></label><input type="file" class="form-control border-light shadow-sm" accept="image/*,.pdf,.mp4"></div>
                    <input type="hidden" id="consentCheck" value="checked"> 
                </div>`;
            break;
    }
    container.innerHTML = formHTML;
    if (formName === 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์') {
        window.renderPlateActionFields();
    }
}

// =========================================================
// Flow การ Submit ข้อมูล (Preview & Confirm)
// =========================================================
function showSummaryModal() {
    const consent = document.getElementById('consentCheck');
    if (consent && consent.type === 'checkbox' && !consent.checked) {
        alert("กรุณาทำเครื่องหมายรับทราบและตกลงให้ความยินยอมก่อนส่งข้อมูลครับ");
        return;
    }

    let html = `<ul class="list-group list-group-flush small mb-3">`;
    const addRow = (label, value, valueClass = 'text-dark fw-bold') => {
        if(value && value !== '-- กรุณาระบุเหตุผล --' && value !== '-- กรุณาระบุประเภท --') {
            html += `<li class="list-group-item d-flex justify-content-between align-items-start px-0 bg-transparent border-light"><div class="ms-2 me-auto"><div class="fw-bold text-ci-bluegrey" style="font-size:0.75rem;">${label}</div><span class="${valueClass}" style="white-space: pre-line;">${value}</span></div></li>`;
        }
    };

    html += `<h6 class="fw-bold text-ci-orange border-bottom border-ci-orange pb-2 mt-2">ข้อมูลผู้ติดต่อ</h6>`;
    if (currentLoginType === 'staff') {
        addRow('ประเภท', 'บุคลากร');
        addRow('ชื่อ-สกุล', document.getElementById('reqName').value, 'text-dark');
        addRow('ตำแหน่ง', document.getElementById('reqPosition').value);
        addRow('หน่วยงาน', document.getElementById('reqDeptCode').value, 'text-dark');
        addRow('เบอร์โทรภายใน', document.getElementById('reqInternalPhone').value);
        addRow('อีเมล', document.getElementById('reqEmail').value);
        addRow('เบอร์โทรมือถือ', document.getElementById('reqPhone').value || '-');
    } else if (currentLoginType === 'student') {
        addRow('ประเภท', 'นักศึกษา');
        addRow('รหัสประจำตัว', document.getElementById('reqEmpId').value);
        addRow('ชื่อ-สกุล', document.getElementById('reqName').value, 'text-dark');
        addRow('สถานภาพ', document.getElementById('reqStatus').value);
        addRow('คณะ/สังกัด', document.getElementById('reqFaculty').value);
        addRow('อีเมล', document.getElementById('reqEmail').value);
        addRow('เบอร์โทร', document.getElementById('reqPhone').value || '-');
    } else {
        let extType = "";
        if(document.getElementById('extType1')?.checked) extType = "ผู้ปกครอง";
        if(document.getElementById('extType2')?.checked) extType = "คู่สัญญา";
        if(document.getElementById('extType3')?.checked) extType = document.getElementById('extTypeOther').value || "อื่นๆ";
        
        if (!shouldHideExternalType(currentSelectedForm)) addRow('ประเภทผู้ขอ', extType);
        addRow('ชื่อ-สกุล', document.getElementById('extFname').value + ' ' + document.getElementById('extLname').value, 'text-dark');
        addRow('หน่วยงาน/บริษัท', document.getElementById('extCompany').value, 'text-dark');
        addRow('เบอร์โทร', document.getElementById('extPhone').value);
        addRow('อีเมล', document.getElementById('extEmail').value);
    }

    html += `</ul><h6 class="fw-bold text-ci-orange border-bottom border-ci-orange pb-2 mt-3">รายละเอียดคำขอ</h6><ul class="list-group list-group-flush small">`;
    
    if (currentSelectedForm === 'แบบฟอร์มขอจอดรถรายเดือน') {
        if (currentLoginType === 'staff') {
            const isOther = document.getElementById('monthlyForOther')?.checked;
            addRow('ผู้ใช้บริการจริง', isOther ? 'ขอให้ผู้อื่น' : 'ตนเอง');
            if (isOther) {
                addRow('ชื่อ-สกุล (ผู้ใช้จริง)', document.getElementById('monthlyOtherName')?.value);
                addRow('เบอร์โทร (ผู้ใช้จริง)', document.getElementById('monthlyOtherPhone')?.value);
                addRow('อีเมล (ผู้ใช้จริง)', document.getElementById('monthlyOtherEmail')?.value);
            }
        }
        addRow('ทะเบียนรถ', document.getElementById('in_monthly_plate')?.value);
        addRow('วันที่เริ่มต้น', document.getElementById('parkingStartDate')?.value);
        addRow('วันที่สิ้นสุด', document.getElementById('parkingEndDate')?.value);
        const contractFile = document.getElementById('monthlyContractFile')?.files?.[0]?.name;
        addRow('สัญญาจ้าง', contractFile);
    } 
    else if (currentSelectedForm === 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)') {
        addRow('ทะเบียนรถ', document.getElementById('in_overnight_plate')?.value);
        if (document.getElementById('overnightMultipleCars')?.checked) {
            const carCount = Number(document.getElementById('overnightCarCount')?.value || 0);
            addRow('จำนวนรถทั้งหมด', carCount ? `${carCount} คัน` : '');
            for (let i = 1; i <= carCount; i++) {
                const firstName = document.getElementById(`overnightCarFirstName${i}`)?.value || '';
                const lastName = document.getElementById(`overnightCarLastName${i}`)?.value || '';
                const plate = document.getElementById(`overnightCarPlate${i}`)?.value || '';
                addRow(`รถคันที่ ${i}`, `${firstName} ${lastName} ${plate}`.trim());
            }
        }
        addRow('วันที่เริ่มต้น', document.getElementById('overnightStartDate')?.value);
        addRow('วันที่สิ้นสุด', document.getElementById('overnightEndDate')?.value);
        addRow('จำนวนคืน', document.getElementById('overnightTotalDays')?.value);
        let sel = document.getElementById('overnightReason');
        addRow('เหตุผล', sel ? sel.options[sel.selectedIndex]?.text : "");
        addRow('รายละเอียดเหตุผล', document.getElementById('in_overnight_detail')?.value);
        addRow('ไฟล์แนบเพิ่มเติม', document.getElementById('overnightStaffFile')?.files?.[0]?.name);
    }
    else if (currentSelectedForm === 'แบบฟอร์มขอใช้ตราประทับ') {
        let sel = document.getElementById('in_stamp_type');
        let stampType = sel ? sel.options[sel.selectedIndex]?.text : "";
        if(stampType === "อื่น ๆ" || stampType === "อื่นๆ") stampType = document.getElementById('in_stamp_other')?.value || "อื่นๆ";
        const stampFor = document.getElementById('stampForUnit')?.checked ? 'หน่วยงาน' : (document.getElementById('stampForProject') ? 'โครงการ' : '');
        addRow('ขอในนาม', stampFor);
        addRow('ชื่อโครงการ/หน่วยงาน', document.getElementById('stampProjectUnitName')?.value);
        addRow('ประเภทผู้ใช้ตราประทับ', stampType);
        addRow('วันที่เริ่มต้น', document.getElementById('stampStartDate')?.value);
        addRow('วันที่สิ้นสุด', document.getElementById('stampEndDate')?.value);
        addRow('จำนวนวัน', document.getElementById('stampTotalDays')?.value);
    }
    else if (currentSelectedForm === 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์') {
        const action = document.querySelector('input[name="plateAction"]:checked')?.value || '';
        const count = Math.min(5, Math.max(1, Number(document.getElementById('plateActionCount')?.value || 1)));
        addRow('ประเภทคำขอ', action);
        addRow('จำนวนคัน', `${count} คัน`);
        if (action === 'แก้ไข') {
            for (let i = 1; i <= count; i++) {
                const oldPlate = document.getElementById(`plateOld${i}`)?.value || '';
                const newPlate = document.getElementById(`plateNew${i}`)?.value || '';
                addRow(`คันที่ ${i}`, `${oldPlate ? `เดิม: ${oldPlate}` : ''}${oldPlate && newPlate ? ' / ' : ''}${newPlate ? `ใหม่: ${newPlate}` : ''}`);
            }
        } else {
            for (let i = 1; i <= count; i++) {
                addRow(`ทะเบียนคันที่ ${i}`, document.getElementById(`plate${i}`)?.value);
            }
        }
    }
    else if (currentSelectedForm === 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว') {
        addRow('ชื่อกิจกรรม', document.getElementById('in_area_event')?.value);
        addRow('ทะเบียนรถ', document.getElementById('in_area_plate')?.value);
        addRow('วันที่เริ่มต้น', document.getElementById('areaStartDate')?.value);
        addRow('เวลาเริ่มต้น', document.getElementById('areaStartTime')?.value);
        addRow('วันที่สิ้นสุด', document.getElementById('areaEndDate')?.value);
        addRow('เวลาสิ้นสุด', document.getElementById('areaEndTime')?.value);
        let objs = []; if(document.getElementById('obj1')?.checked) objs.push('ประชาสัมพันธ์'); if(document.getElementById('obj2')?.checked) objs.push('แจกผลิตภัณฑ์'); if(document.getElementById('obj3')?.checked) objs.push(document.getElementById('objOtherText')?.value || 'อื่นๆ');
        addRow('วัตถุประสงค์', objs.join(', '));
        let locs = []; if(document.getElementById('loc1')?.checked) locs.push('อาคารจอดรถ 1 (S2)'); if(document.getElementById('loc2')?.checked) locs.push('โรงอาหาร (S14)'); if(document.getElementById('loc3')?.checked) locs.push(document.getElementById('locOtherText')?.value || 'อื่นๆ');
        addRow('สถานที่', locs.join(', '));
    }
    else if (currentSelectedForm === 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา') {
        addRow('ทะเบียนรถ', document.getElementById('in_contract_plate')?.value);
        addRow('วันที่เข้าพื้นที่', document.getElementById('in_contract_date')?.value);
        addRow('เวลา', (document.getElementById('in_contract_time_start')?.value || '') + " - " + (document.getElementById('in_contract_time_end')?.value || ''));
        addRow('บริษัท', document.getElementById('contractCompany')?.value);
        addRow('พื้นที่การศึกษา', document.getElementById('contractCampus')?.value);
        addRow('อาคาร', document.getElementById('contractBuilding')?.value);
    }
    else if (currentSelectedForm === 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ') {
        let sel = document.getElementById('issueCategory');
        addRow('กลุ่มปัญหา', sel ? sel.options[sel.selectedIndex]?.text : "");
        addRow('รายละเอียด', document.getElementById('issueDetail')?.value);
    }

    html += `</ul>`;

    // โชว์ผู้อนุมัติสำหรับบุคลากร และกรณีนักศึกษาขอใช้ตราประทับ
    if (currentSelectedForm !== 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ' && (currentLoginType === 'staff' || (currentLoginType === 'student' && currentSelectedForm === 'แบบฟอร์มขอใช้ตราประทับ'))) {
        html += `<h6 class="fw-bold text-ci-bluegrey border-bottom border-light pb-2 mt-3">ผู้มีอำนาจอนุมัติ</h6><ul class="list-group list-group-flush small">`;
        addRow('ชื่อผู้อนุมัติ', document.getElementById('appName').value);
        html += `</ul>`;
    }

    document.getElementById('summaryContent').innerHTML = html;
    summaryModalInstance.show();
}

function getInputValue(id) {
    return (document.getElementById(id)?.value || '').trim();
}

function getTextValue(id) {
    return (document.getElementById(id)?.innerText || '').trim();
}

function getHtmlValue(id) {
    return (document.getElementById(id)?.innerHTML || '').trim();
}

function getSelectedOptionText(id) {
    const el = document.getElementById(id);
    if (!el || el.selectedIndex < 0) return '';
    return (el.options[el.selectedIndex]?.text || '').trim();
}

function getExternalTypeForJotform() {
    if (currentLoginType !== 'external' || shouldHideExternalType(currentSelectedForm)) return '';
    if (document.getElementById('extType1')?.checked) return 'ผู้ปกครอง';
    if (document.getElementById('extType2')?.checked) return 'คู่สัญญา';
    if (document.getElementById('extType3')?.checked) return 'อื่นๆ';
    return '';
}

function formatPhoneForJotform(value) {
    const digits = (value || '').replace(/\D/g, '');
    if (digits.length >= 10) {
        const phone = digits.slice(0, 10);
        return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
    }
    return value || '';
}

function appendHiddenField(form, name, value) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value || '';
    form.appendChild(input);
}

function getRequesterDataForJotform() {
    if (currentLoginType === 'staff') {
        const displayEmail = getInputValue('reqEmail');
        const submittedEmail = resolveRequesterEmail('staff', displayEmail);
        return {
            requesterId: getInputValue('reqEmpId'),
            requesterName: getInputValue('reqName'),
            displayEmail,
            email: submittedEmail,
            submittedEmail,
            phone: getInputValue('reqPhone'),
            department: getInputValue('reqDeptCode'),
            position: getInputValue('reqPosition'),
            internalPhone: getInputValue('reqInternalPhone'),
            studentStatus: '',
            faculty: '',
            major: ''
        };
    }

    if (currentLoginType === 'student') {
        const displayEmail = getInputValue('reqEmail');
        const submittedEmail = resolveRequesterEmail('student', displayEmail);
        return {
            requesterId: getInputValue('reqEmpId'),
            requesterName: getInputValue('reqName'),
            displayEmail,
            email: submittedEmail,
            submittedEmail,
            phone: getInputValue('reqPhone'),
            department: getInputValue('reqFaculty'),
            position: '',
            internalPhone: '',
            studentStatus: getInputValue('reqStatus'),
            faculty: getInputValue('reqFaculty'),
            major: getInputValue('reqMajor')
        };
    }

    const displayEmail = getInputValue('extEmail');
    const submittedEmail = resolveRequesterEmail('external', displayEmail);
    return {
        requesterId: '',
        requesterName: `${getInputValue('extFname')} ${getInputValue('extLname')}`.trim(),
        displayEmail,
        email: submittedEmail,
        submittedEmail,
        phone: getInputValue('extPhone'),
        department: getInputValue('extCompany'),
        position: '',
        internalPhone: '',
        studentStatus: '',
        faculty: '',
        major: ''
    };
}

function buildJotformSubmissionFields() {
    const requester = getRequesterDataForJotform();
    const approverEmail = getTextValue('appEmail');
    const summaryText = getTextValue('summaryContent');
    return {
        q15_input15: currentSelectedForm,
        q16_input16: JOTFORM_USER_TYPE_VALUES[currentLoginType] || '',
        q17_input17: getExternalTypeForJotform(),
        q18_input18: requester.requesterId,
        q19_input19: requester.requesterName,
        q20_input20: requester.email,
        'q21_input21[full]': formatPhoneForJotform(requester.phone),
        q22_input22: requester.department,
        q23_input23: requester.position,
        q24_input24: requester.internalPhone,
        q25_input25: requester.studentStatus,
        q26_input26: requester.faculty,
        q27_input27: requester.major,
        q28_input28: getInputValue('appName'),
        q29_input29: getInputValue('appPosition'),
        q30_input30: resolveApproverEmail(getInputValue('appName'), getInputValue('appPosition'), approverEmail),
        q31_input31: 'ใช่',
        q32_summary: summaryText
    };
}

async function loadWorkflowTickets() {
    return window.BPUU_WORKFLOW_API.listTickets();
}

async function saveWorkflowTickets(tickets) {
    return window.BPUU_WORKFLOW_API.replaceTickets(tickets);
}

function notifyWorkflowTicketsChanged() {
    window.BPUU_WORKFLOW_API.notifyChanged();
}

async function saveWorkflowTicketRecord(ticket) {
    return window.BPUU_WORKFLOW_API.upsertTicket(ticket);
}

function createLightweightWorkflowTicket(ticket) {
    const lightweight = { ...ticket };
    if (Array.isArray(lightweight.selectedAttachments)) {
        lightweight.selectedAttachments = lightweight.selectedAttachments.map(file => ({
            name: file.name || 'ไฟล์แนบ',
            type: file.type || '',
            size: file.size || 0,
            dataUrl: ''
        }));
    }
    return lightweight;
}

function getNextWorkflowTicketId(tickets) {
    const currentYear = new Date().getFullYear();
    let maxSequence = WORKFLOW_BASE_SEQUENCE;

    tickets.forEach(ticket => {
        const match = String(ticket.ticketId || '').match(/^REQ-(\d{4})-(\d{4})$/);
        if (!match) return;
        if (Number(match[1]) !== currentYear) return;
        maxSequence = Math.max(maxSequence, Number(match[2]));
    });

    return `REQ-${currentYear}-${String(maxSequence + 1).padStart(4, '0')}`;
}

function getRequesterTypeLabel() {
    return JOTFORM_USER_TYPE_VALUES[currentLoginType] || '';
}

function getSelectedPlateAction() {
    return document.querySelector('input[name="plateAction"]:checked')?.value || 'เพิ่ม';
}

function getPlateRequestPayload() {
    const action = getSelectedPlateAction();
    const count = Math.min(5, Math.max(1, Number(document.getElementById('plateActionCount')?.value || 1)));

    if (action === 'แก้ไข') {
        const items = [];
        for (let i = 1; i <= count; i++) {
            items.push({
                index: i,
                oldPlate: document.getElementById(`plateOld${i}`)?.value || '',
                newPlate: document.getElementById(`plateNew${i}`)?.value || ''
            });
        }

        return {
            plateAction: action,
            plateCount: count,
            plateItems: items,
            plateRequest: {
                action,
                count,
                items
            }
        };
    }

    const items = [];
    for (let i = 1; i <= count; i++) {
        items.push({
            index: i,
            plate: document.getElementById(`plate${i}`)?.value || ''
        });
    }

    return {
        plateAction: action,
        plateCount: count,
        plateItems: items,
        plateRequest: {
            action,
            count,
            items
        }
    };
}

function getSelectedStampRequestFor() {
    return document.querySelector('input[name="stampRequestFor"]:checked')?.value || 'โครงการ';
}

function collectSelectedFileNames() {
    return [...document.querySelectorAll('.view-section.active input[type="file"]')]
        .flatMap(input => [...(input.files || [])].map(file => file.name));
}

function collectSelectedFilePayloads() {
    const fileInputs = [...document.querySelectorAll('.view-section.active input[type="file"]')]
        .filter(input => input.files && input.files.length > 0);

    const filePromises = fileInputs.flatMap(input => [...input.files].map(file => readFileAsDataUrl(file).then(dataUrl => ({
        name: file.name,
        type: file.type || '',
        size: file.size || 0,
        dataUrl
    }))));

    return Promise.all(filePromises);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function getWorkflowSubmissionConfig() {
    if (currentSelectedForm === 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)') {
        if (currentLoginType === 'staff') {
            return {
                typeKey: 'overnight',
                workflowKey: 'overnightStaff',
                status: 'รอหัวหน้างานอนุมัติ',
                stepIndex: 1,
                assignee: 'หัวหน้างาน',
                priority: 'สูง',
                routeSummary: 'หัวหน้างาน → BPUU',
                contextLabel: 'หน่วยงาน',
                contextValue: getInputValue('reqDeptCode') || getInputValue('extCompany') || '-',
                note: 'รอหัวหน้างานอนุมัติก่อนเข้าสู่ BPUU'
            };
        }

        return {
            typeKey: 'overnight',
            workflowKey: 'overnightExternal',
            status: 'รอ BPUU พิจารณา',
            stepIndex: 1,
            assignee: 'BPUU Staff',
            priority: 'กลาง',
            routeSummary: 'BPUU ตรวจสอบโดยตรง',
            contextLabel: 'องค์กร',
            contextValue: getInputValue('extCompany') || '-',
            note: 'ส่งเข้าพิจารณาโดย BPUU โดยตรง'
        };
    }

    if (currentSelectedForm === 'แบบฟอร์มขอจอดรถรายเดือน') {
        const requesterForOther = currentLoginType === 'staff' && document.getElementById('monthlyForOther')?.checked;
        const monthlyOwner = requesterForOther
            ? `${getInputValue('monthlyOtherName')} (${getInputValue('monthlyOtherEmail') || '-'})`.trim()
            : 'ตนเอง';

        return {
            typeKey: 'monthly',
            workflowKey: 'monthlyRegular',
            status: 'รอ BPUU ตรวจสอบ',
            stepIndex: 1,
            assignee: 'BPUU Staff',
            priority: 'สูง',
            routeSummary: 'BPUU → ผู้ขอ',
            contextLabel: 'ผู้ใช้บริการจริง',
            contextValue: monthlyOwner || 'ตนเอง',
            note: requesterForOther ? 'ขอให้ผู้อื่น' : 'ขอให้ตนเอง'
        };
    }

    if (currentSelectedForm === 'แบบฟอร์มขอใช้ตราประทับ') {
        const stampFor = getSelectedStampRequestFor();
        const isUnit = stampFor === 'หน่วยงาน';

        return {
            typeKey: 'stamp',
            workflowKey: isUnit ? 'stampUnit' : 'stampProject',
            status: isUnit ? 'รอหัวหน้างานอนุมัติ' : 'รอ BPUU ตรวจสอบ',
            stepIndex: 1,
            assignee: isUnit ? 'หัวหน้างาน' : 'BPUU Staff',
            priority: 'สูง',
            routeSummary: isUnit ? 'หัวหน้างาน → BPUU' : 'BPUU → ฝ่ายการเงิน',
            contextLabel: 'ขอในนาม',
            contextValue: stampFor,
            note: `ขอใช้ตราประทับในนาม${stampFor}`
        };
    }

    if (currentSelectedForm === 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์') {
        const plateAction = getSelectedPlateAction();
        const plateRequest = getPlateRequestPayload();

        if (currentLoginType === 'staff') {
            return {
                typeKey: 'plate',
                workflowKey: 'plateRedirect',
                status: 'ส่งต่อไป IBGM',
                stepIndex: 1,
                assignee: 'ระบบ IBGM',
                priority: 'กลาง',
                routeSummary: 'redirect ไป IBGM',
                contextLabel: 'ประเภทคำขอ',
                contextValue: plateAction,
                note: 'บุคลากรถูกส่งต่อไป IBGM',
                ...plateRequest
            };
        }

        return {
            typeKey: 'plate',
            workflowKey: 'plateStudent',
            status: 'รอ BPUU ตรวจสอบ',
            stepIndex: 1,
            assignee: 'BPUU Staff',
            priority: 'กลาง',
            routeSummary: 'BPUU → Carpark',
            contextLabel: 'คณะ / สาขา',
            contextValue: getInputValue('reqFaculty') || '-',
            note: `คำขอทะเบียนของนักศึกษา (${plateAction})`,
            ...plateRequest
        };
    }

    if (currentSelectedForm === 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว') {
        const requesterIsStaff = currentLoginType === 'staff';
        return {
            typeKey: 'temporary',
            workflowKey: requesterIsStaff ? 'tempInternal' : 'tempExternal',
            status: requesterIsStaff ? 'รอหัวหน้างานอนุมัติ' : 'รอ BPUU ตรวจสอบ',
            stepIndex: 1,
            assignee: requesterIsStaff ? 'หัวหน้างาน' : 'BPUU Staff',
            priority: 'สูง',
            routeSummary: requesterIsStaff ? 'หัวหน้างาน → BPUU → การเงิน' : 'BPUU → ผู้ขอ',
            contextLabel: requesterIsStaff ? 'หน่วยงาน' : 'องค์กร',
            contextValue: requesterIsStaff ? (getInputValue('reqDeptCode') || '-') : (getInputValue('extCompany') || '-'),
            note: getInputValue('in_area_event') || 'คำขอใช้พื้นที่ชั่วคราว'
        };
    }

    if (currentSelectedForm === 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา') {
        return {
            typeKey: 'contract',
            workflowKey: 'contractVendor',
            status: 'รอ BPUU พิจารณา',
            stepIndex: 1,
            assignee: 'BPUU Staff',
            priority: 'กลาง',
            routeSummary: 'BPUU → ผู้ดูแลพื้นที่',
            contextLabel: 'บริษัท',
            contextValue: getInputValue('contractCompany') || getInputValue('extCompany') || '-',
            note: 'คำขอเข้าพื้นที่คู่สัญญา'
        };
    }

    if (currentSelectedForm === 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ') {
        const internalIssue = currentLoginType === 'staff' || currentLoginType === 'student';
        return {
            typeKey: 'issue',
            workflowKey: internalIssue ? 'issueInternal' : 'issueExternal',
            status: internalIssue ? 'ส่งต่อไป Modlink' : 'รับเรื่อง',
            stepIndex: 1,
            assignee: internalIssue ? 'Modlink / BPUU' : 'BPUU Staff',
            priority: 'กลาง',
            routeSummary: internalIssue ? 'Modlink → BPUU' : 'BPUU รับเรื่อง',
            contextLabel: 'กลุ่มปัญหา',
            contextValue: getSelectedOptionText('issueCategory') || '-',
            note: getInputValue('issueDetail') || 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ'
        };
    }

    return {
        typeKey: 'issue',
        workflowKey: 'issueExternal',
        status: 'รับเรื่อง',
        stepIndex: 1,
        assignee: 'BPUU Staff',
        priority: 'กลาง',
        routeSummary: 'BPUU รับเรื่อง',
        contextLabel: 'รายละเอียด',
        contextValue: '-',
        note: 'คำขอไม่อยู่ในหมวดที่กำหนด'
    };
}

function logPlateRedirectTicket() {
    const submittedAt = new Date().toISOString();
    const requester = getRequesterDataForJotform();
    const requesterDisplayEmail = requester.displayEmail || '';
    const requesterSubmittedEmail = requester.submittedEmail || requester.email || '';
    const plateRequest = getPlateRequestPayload();

    const ticket = {
        typeKey: 'plate',
        requesterType: getRequesterTypeLabel(),
        requesterName: requester.requesterName || getInputValue('reqName') || 'ไม่ระบุชื่อ',
        contextLabel: 'ปลายทาง',
        contextValue: 'IBGM',
        formName: 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์',
        status: 'ส่งต่อไป IBGM',
        workflowKey: 'plateRedirect',
        stepIndex: 1,
        submittedAt,
        updatedAt: submittedAt,
        assignee: 'ระบบ IBGM',
        priority: 'กลาง',
        routeSummary: 'redirect ไป IBGM',
        note: 'บุคลากรถูกส่งต่อไป IBGM',
        submissionMode: 'redirect',
        requester,
        requesterEmail: requesterSubmittedEmail,
        approverEmail: '',
        approverDisplayEmail: '',
        approverSubmittedEmail: '',
        ...plateRequest,
        emailDetails: {
            requesterDisplayEmail,
            requesterSubmittedEmail,
            approverDisplayEmail: '',
            approverSubmittedEmail: ''
        }
    };

    saveWorkflowTicketRecord(ticket).catch(error => {
        console.error('Failed to save plate redirect ticket.', error);
    });
}

function buildWorkflowTicketRecord() {
    const requester = getRequesterDataForJotform();
    const config = getWorkflowSubmissionConfig();
    const submittedAt = new Date().toISOString();
    const summaryHtml = getHtmlValue('summaryContent');
    const summaryText = getTextValue('summaryContent');
    const rawSubmissionFields = buildJotformSubmissionFields();
    const approverDisplayEmail = getTextValue('appEmail');
    const approverSubmittedEmail = resolveApproverEmail(getInputValue('appName'), getInputValue('appPosition'), approverDisplayEmail);
    const requesterDisplayEmail = requester.displayEmail || '';
    const requesterSubmittedEmail = requester.submittedEmail || requester.email || '';

    return {
        typeKey: config.typeKey,
        requesterType: getRequesterTypeLabel(),
        requesterName: requester.requesterName || getInputValue('reqName') || getInputValue('extFname') || 'ไม่ระบุชื่อ',
        contextLabel: config.contextLabel,
        contextValue: config.contextValue,
        formName: currentSelectedForm,
        status: config.status,
        workflowKey: config.workflowKey,
        stepIndex: config.stepIndex,
        submittedAt,
        updatedAt: submittedAt,
        assignee: config.assignee,
        priority: config.priority,
        routeSummary: config.routeSummary,
        note: config.note,
        submissionMode: 'local-storage',
        summaryHtml,
        summaryText,
        selectedFiles: collectSelectedFileNames(),
        requester,
        requesterEmail: requesterSubmittedEmail,
        approverEmail: approverSubmittedEmail,
        approverDisplayEmail,
        approverSubmittedEmail,
        emailDetails: {
            requesterDisplayEmail,
            requesterSubmittedEmail,
            approverDisplayEmail,
            approverSubmittedEmail
        },
        submissionFields: rawSubmissionFields
    };
}

async function submitWorkflowLocally() {
    try {
        const selectedAttachments = await collectSelectedFilePayloads();
        const ticket = {
            ...buildWorkflowTicketRecord(),
            selectedAttachments
        };

        const savedTicket = await saveWorkflowTicketRecord(ticket);
        notifyWorkflowTicketsChanged();
        showSubmitSuccess();

        sendAndLogWorkflowEmail(savedTicket, 'new-submission-approval')
            .finally(() => {
                void saveWorkflowTicketRecord(savedTicket).catch(error => {
                    console.error('Failed to refresh saved workflow ticket.', error);
                });
            });
    } catch (error) {
        console.error('Failed to submit workflow ticket.', error);
        alert('บันทึกคำขอไม่สำเร็จ กรุณาลองอีกครั้ง หรือเช็กการเชื่อมต่อกับระบบหลังบ้าน');
    }
}

function appendSelectedFiles(form) {
    const fileInputs = [...document.querySelectorAll('.view-section.active input[type="file"]')]
        .filter(input => input.files && input.files.length > 0);

    fileInputs.forEach(sourceInput => {
        try {
            const fileInput = document.createElement('input');
            const files = new DataTransfer();
            fileInput.type = 'file';
            fileInput.name = 'q33_input33[]';
            fileInput.multiple = true;
            [...sourceInput.files].forEach(file => files.items.add(file));
            fileInput.files = files.files;
            fileInput.style.display = 'none';
            form.appendChild(fileInput);
        } catch (error) {
            sourceInput.name = 'q33_input33[]';
            sourceInput.style.display = 'none';
            form.appendChild(sourceInput);
        }
    });
}

function showSubmitSuccess() {
    successModalInstance.show();
    setTimeout(() => {
        successModalInstance.hide();
        goHome();
    }, 2000);
}

function submitToJotform() {
    document.getElementById('jotformSubmitFrame')?.remove();
    document.getElementById('jotformDirectSubmitForm')?.remove();

    const iframe = document.createElement('iframe');
    iframe.name = 'jotformSubmitFrame';
    iframe.id = 'jotformSubmitFrame';
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const form = document.createElement('form');
    form.id = 'jotformDirectSubmitForm';
    form.action = JOTFORM_SUBMIT_URL;
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    form.acceptCharset = 'utf-8';
    form.target = iframe.name;
    form.style.display = 'none';

    appendHiddenField(form, 'formID', JOTFORM_FORM_ID);
    appendHiddenField(form, 'simple_spc', `${JOTFORM_FORM_ID}-${JOTFORM_FORM_ID}`);
    appendHiddenField(form, 'submitSource', 'BPUU-DEMO');
    appendHiddenField(form, 'submitDate', new Date().toISOString());
    appendHiddenField(form, 'eventObserver', '1');
    appendHiddenField(form, 'website', '');

    Object.entries(buildJotformSubmissionFields()).forEach(([name, value]) => {
        appendHiddenField(form, name, value);
    });
    appendSelectedFiles(form);

    let successShown = false;
    const completeSubmit = () => {
        if (successShown) return;
        successShown = true;
        showSubmitSuccess();
    };
    iframe.addEventListener('load', completeSubmit);
    document.body.appendChild(form);
    form.submit();
    setTimeout(completeSubmit, 4000);
}

async function confirmSubmitForm() {
    summaryModalInstance.hide();
    await submitWorkflowLocally();
}

// =========================================================
// JavaScript Logic Helpers
// =========================================================
window.initContractDropdowns = function() {
    const companySelect = document.getElementById('contractCompany');
    if(!companySelect) return;
    const companies = [...new Set(contractDatabase.map(row => row[7]).filter(c => c && c !== 'ชื่อบริษัท' && c !== 'CompanyName'))];
    companySelect.innerHTML = '<option value="" selected disabled>-- 1. เลือกชื่อบริษัท --</option>';
    companies.forEach(c => { companySelect.innerHTML += `<option value="${c}">${c}</option>`; });
};

window.onCompanyChange = function() {
    const company = document.getElementById('contractCompany').value;
    const bizSelect = document.getElementById('contractBusinessType');
    const filtered = contractDatabase.filter(row => row[7] === company);
    const bizTypes = [...new Set(filtered.map(row => row[5]).filter(b => b))];
    bizSelect.innerHTML = '<option value="" selected disabled>-- 2. เลือกประเภทธุรกิจ --</option>';
    bizTypes.forEach(b => { bizSelect.innerHTML += `<option value="${b}">${b}</option>`; });
    bizSelect.disabled = false;
    
    document.getElementById('contractCampus').innerHTML = '<option value="" selected disabled>-- 3. เลือกพื้นที่การศึกษา --</option>';
    document.getElementById('contractCampus').disabled = true;
    document.getElementById('contractBuilding').innerHTML = '<option value="" selected disabled>-- 4. เลือกอาคาร --</option>';
    document.getElementById('contractBuilding').disabled = true;
};

window.onBusinessTypeChange = function() {
    const company = document.getElementById('contractCompany').value;
    const biz = document.getElementById('contractBusinessType').value;
    const campusSelect = document.getElementById('contractCampus');
    const filtered = contractDatabase.filter(row => row[7] === company && row[5] === biz);
    const campuses = [...new Set(filtered.map(row => row[1]).filter(c => c))];
    campusSelect.innerHTML = '<option value="" selected disabled>-- 3. เลือกพื้นที่การศึกษา --</option>';
    campuses.forEach(c => { campusSelect.innerHTML += `<option value="${c}">${c}</option>`; });
    campusSelect.disabled = false;
    document.getElementById('contractBuilding').innerHTML = '<option value="" selected disabled>-- 4. เลือกอาคาร --</option>';
    document.getElementById('contractBuilding').disabled = true;
};

window.onCampusChange = function() {
    const company = document.getElementById('contractCompany').value;
    const biz = document.getElementById('contractBusinessType').value;
    const campus = document.getElementById('contractCampus').value;
    const buildingSelect = document.getElementById('contractBuilding');
    const filtered = contractDatabase.filter(row => row[7] === company && row[5] === biz && row[1] === campus);
    const buildings = [...new Set(filtered.map(row => row[3]).filter(b => b))];
    buildingSelect.innerHTML = '<option value="" selected disabled>-- 4. เลือกอาคาร --</option>';
    buildings.forEach(b => { buildingSelect.innerHTML += `<option value="${b}">${b}</option>`; });
    buildingSelect.disabled = false;
};

window.calculateEndDate = function() {
    const startDateInput = document.getElementById('parkingStartDate').value;
    if (!startDateInput) return;
    let start = new Date(startDateInput);
    start.setMonth(start.getMonth() + 1);
    start.setDate(start.getDate() - 1);
    const dd = String(start.getDate()).padStart(2, '0');
    const mm = String(start.getMonth() + 1).padStart(2, '0');
    const yyyy = start.getFullYear();
    document.getElementById('parkingEndDate').value = `${dd}/${mm}/${yyyy}`;
};

window.calculateDuration = function(startId, endId, totalId, unitType) {
    const startStr = document.getElementById(startId);
    const endStr = document.getElementById(endId);
    const totalBox = document.getElementById(totalId);
    if(startStr && endStr && startStr.value && endStr.value) {
        const start = new Date(startStr.value);
        const end = new Date(endStr.value);
        const diffTime = end - start;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if(diffDays < 0) {
            alert("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้นครับ");
            endStr.value = "";
            totalBox.value = "0";
        } else {
            if (unitType === 'nights') {
                if (diffDays === 0) {
                    alert("การจอดรถค้างคืน วันที่สิ้นสุดต้องเป็นวันถัดไปอย่างน้อย 1 คืนครับ");
                    endStr.value = "";
                    totalBox.value = "0";
                } else { totalBox.value = diffDays; }
            } else if (unitType === 'days') {
                totalBox.value = diffDays + 1;
            }
        }
    }
};

window.toggleReasonDetails = function() {
    const reasonVal = document.getElementById('overnightReason').value;
    const detailDiv = document.getElementById('divReasonDetails');
    const fileDiv = document.getElementById('divReasonFile');
    if(reasonVal) {
        detailDiv.style.display = 'block';
        if (fileDiv) fileDiv.style.display = reasonVal === "1" ? 'none' : 'block';
    } else {
        detailDiv.style.display = 'none';
    }
};

window.toggleOvernightMultipleCars = function() {
    const isChecked = document.getElementById('overnightMultipleCars')?.checked;
    const details = document.getElementById('divOvernightMultipleCars');
    if (!details) return;
    details.style.display = isChecked ? 'block' : 'none';
    if (isChecked) renderOvernightCarFields();
};

window.renderOvernightCarFields = function() {
    const container = document.getElementById('overnightCarFields');
    const count = Number(document.getElementById('overnightCarCount')?.value || 2);
    if (!container) return;
    let html = '<div class="row g-2">';
    for (let i = 1; i <= count; i++) {
        html += `
            <div class="col-md-12">
                <div class="row g-2 align-items-end">
                    <div class="col-md-2"><span class="badge bg-ci-bluegrey w-100 py-2">คันที่ ${i}</span></div>
                    <div class="col-md-3"><label class="form-label text-ci-bluegrey fw-bold small">ชื่อ <span class="req-star">*</span></label><input type="text" class="form-control border-light shadow-sm" id="overnightCarFirstName${i}"></div>
                    <div class="col-md-3"><label class="form-label text-ci-bluegrey fw-bold small">สกุล <span class="req-star">*</span></label><input type="text" class="form-control border-light shadow-sm" id="overnightCarLastName${i}"></div>
                    <div class="col-md-4"><label class="form-label text-ci-bluegrey fw-bold small">ทะเบียนรถ <span class="req-star">*</span></label><input type="text" class="form-control border-light shadow-sm" id="overnightCarPlate${i}" placeholder="เช่น 1กข2345"></div>
                </div>
            </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
};

window.toggleStampOther = function(sel) {
    const otherInput = document.getElementById('in_stamp_other');
    if(sel.value === 'อื่นๆ' || sel.value === 'อื่น ๆ') {
        otherInput.style.display = 'block';
        otherInput.focus();
    } else {
        otherInput.style.display = 'none';
        otherInput.value = '';
    }
};

window.clearPlate = function(inputId) {
    document.getElementById(inputId).value = "";
    document.getElementById(inputId).focus();
};

window.togglePlateAction = function() {
    window.renderPlateActionFields();
};

window.renderPlateActionFields = function() {
    const container = document.getElementById('plateActionFields');
    if (!container) return;

    const action = document.querySelector('input[name="plateAction"]:checked')?.value || 'เพิ่ม';
    const count = Math.min(5, Math.max(1, Number(document.getElementById('plateActionCount')?.value || 1)));
    const actionLabel = action === 'ยกเลิก' ? 'ทะเบียนที่ต้องการยกเลิก' : 'ทะเบียนที่ต้องการเพิ่ม';

    let html = '<div class="row g-3">';
    for (let i = 1; i <= count; i++) {
        if (action === 'แก้ไข') {
            html += `
                <div class="col-md-12">
                    <div class="row g-2 align-items-end">
                        <div class="col-md-2"><span class="badge bg-ci-bluegrey w-100 py-2">คันที่ ${i}</span></div>
                        <div class="col-md-5">
                            <label class="form-label text-ci-bluegrey fw-bold small">ทะเบียนเดิม <span class="req-star">*</span></label>
                            <input type="text" class="form-control border-light shadow-sm" id="plateOld${i}" placeholder="ทะเบียนเดิม">
                        </div>
                        <div class="col-md-5">
                            <label class="form-label text-ci-bluegrey fw-bold small">ทะเบียนใหม่ <span class="req-star">*</span></label>
                            <input type="text" class="form-control border-light shadow-sm" id="plateNew${i}" placeholder="ทะเบียนใหม่">
                        </div>
                    </div>
                </div>`;
        } else {
            html += `
                <div class="col-md-12">
                    <label class="form-label text-ci-bluegrey fw-bold small">${actionLabel} คันที่ ${i} <span class="req-star">*</span></label>
                    <div class="input-group shadow-sm">
                        <span class="input-group-text bg-white text-ci-bluegrey border-light fw-bold" style="width: 75px;">คันที่ ${i}</span>
                        <input type="text" class="form-control fw-bold text-ci-orange border-light" id="plate${i}" placeholder="เช่น 1กข2345 (ไม่ต้องเว้นวรรค)">
                        <button class="btn btn-outline-danger border-light" type="button" onclick="clearPlate('plate${i}')"><i class="bi bi-trash-fill"></i></button>
                    </div>
                </div>`;
        }
    }
    html += '</div>';
    container.innerHTML = html;
};

window.toggleOtherInput = function(checkboxId, inputId) {
    const checkbox = document.getElementById(checkboxId);
    const input = document.getElementById(inputId);
    if(checkbox.checked) {
        input.disabled = false;
        input.focus();
    } else {
        input.disabled = true;
        input.value = "";
    }
};

window.toggleMonthlyForOther = function() {
    const isOther = document.getElementById('monthlyForOther')?.checked;
    const divDetails = document.getElementById('divMonthlyOtherDetails');
    if (divDetails) {
        divDetails.style.display = isOther ? 'block' : 'none';
    }
};

document.getElementById('loginEmpId').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') processLogin();
});
