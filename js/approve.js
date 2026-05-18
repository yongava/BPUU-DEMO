const APPROVAL_TICKET_STORAGE_KEY = 'bpuu-workflow-tickets';
const APPROVAL_TICKET_STORAGE_PING_KEY = `${APPROVAL_TICKET_STORAGE_KEY}-updated-at`;
const APPROVAL_LEGACY_TICKET_STORAGE_KEYS = ['bpuu-admin-tickets'];
const APPROVAL_CONFIG = window.BPUU_WORKFLOW_TEST_CONFIG || {};

const APPROVAL_WORKFLOW_TEMPLATES = {
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

let approvalTickets = [];
let currentTicket = null;

bootApprovalPage();

function bootApprovalPage() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            void initApprovalPage();
        }, { once: true });
        return;
    }

    void initApprovalPage();
}

async function initApprovalPage() {
    try {
        approvalTickets = await loadApprovalTickets();
    } catch (error) {
        console.error('Failed to load approval tickets from backend.', error);
        approvalTickets = [];
    }
    const ticketId = new URLSearchParams(window.location.search).get('ticket') || '';
    currentTicket = approvalTickets.find(ticket => ticket.ticketId === ticketId) || null;
    renderApprovalPage();
}

async function loadApprovalTickets() {
    return window.BPUU_WORKFLOW_API.listTickets({ force: true });
}

async function saveApprovalTickets(tickets) {
    return window.BPUU_WORKFLOW_API.replaceTickets(tickets);
}

async function saveApprovalTicketRecord(ticket) {
    const savedTicket = await window.BPUU_WORKFLOW_API.upsertTicket(ticket);
    approvalTickets = approvalTickets.filter(item => item.ticketId !== savedTicket.ticketId);
    approvalTickets.unshift(savedTicket);
    currentTicket = savedTicket;
    return savedTicket;
}

function notifyApprovalTicketsChanged() {
    window.BPUU_WORKFLOW_API.notifyChanged();
}

function renderApprovalPage(message = '', tone = 'success') {
    const root = document.getElementById('approvalRoot');
    if (!root) return;

    if (!currentTicket) {
        root.innerHTML = `
            <div class="approval-empty">
                <i class="bi bi-search display-5 text-warning"></i>
                <div>
                    <h2 class="h4 fw-black text-dark">ไม่พบคำขอที่ต้องอนุมัติ</h2>
                    <p class="mb-0">กรุณาตรวจสอบ ticket ใน URL หรือเปิดลิงก์จากอีเมลฉบับล่าสุดอีกครั้ง</p>
                </div>
            </div>
        `;
        return;
    }

    const workflow = getWorkflowTemplate(currentTicket);
    const currentStep = getCurrentStep(currentTicket);
    const canApproveWithCost = /^overnight/i.test(currentTicket.workflowKey || '') && /BPUU Manager พิจารณา/i.test(String(currentStep || ''));
    const summaryHtml = currentTicket.summaryHtml?.trim()
        ? currentTicket.summaryHtml
        : buildFallbackSummary(currentTicket);
    const attachments = getAttachmentChips(currentTicket);

    root.innerHTML = `
        <div class="approval-ticket-head">
            <div class="approval-ticket-id">${escapeHtml(currentTicket.ticketId)}</div>
            <div>
                <h2>${escapeHtml(currentTicket.formName || 'คำขอใช้บริการ')}</h2>
                <div class="approval-ticket-meta mt-3">
                    <span class="approval-pill"><i class="bi bi-person-fill"></i>${escapeHtml(currentTicket.requesterName || '-')}</span>
                    <span class="approval-pill"><i class="bi bi-people-fill"></i>${escapeHtml(currentTicket.requesterType || '-')}</span>
                    <span class="approval-pill"><i class="bi bi-arrow-repeat"></i>${escapeHtml(currentStep)}</span>
                    <span class="approval-pill"><i class="bi bi-clock-fill"></i>${escapeHtml(formatDateTime(currentTicket.updatedAt || currentTicket.submittedAt))}</span>
                </div>
            </div>
        </div>

        <div class="approval-body">
            <section class="approval-summary">
                <div class="approval-summary-title">
                    <i class="bi bi-card-checklist text-warning"></i>
                    รายละเอียดคำขอ
                </div>
                <div class="approval-summary-content">${summaryHtml}</div>
                ${attachments}
            </section>

            <aside class="approval-side-panel">
                <div class="approval-side-title">
                    <i class="bi bi-signpost-split-fill text-warning"></i>
                    ขั้นตอนปัจจุบัน
                </div>
                <div>${renderTimeline(currentTicket, workflow)}</div>
                <div class="approval-actions">
                    <button type="button" class="approval-action-btn approve" data-approval-action="approve">
                        <i class="bi bi-check2-circle me-1"></i>Approve
                    </button>
                    ${canApproveWithCost ? `
                    <button type="button" class="approval-action-btn approve-paid" data-approval-action="approve-paid">
                        <i class="bi bi-cash-coin me-1"></i>อนุมัติ-มีค่าใช้จ่าย
                    </button>
                    ` : ''}
                    <button type="button" class="approval-action-btn reject" data-approval-action="reject">
                        <i class="bi bi-x-circle me-1"></i>Reject
                    </button>
                </div>
                ${message ? `<div class="approval-result ${tone === 'error' ? 'error' : ''}">${escapeHtml(message)}</div>` : ''}
            </aside>
        </div>
    `;

    root.querySelectorAll('[data-approval-action]').forEach(button => {
        button.addEventListener('click', async () => {
            root.querySelectorAll('[data-approval-action]').forEach(item => { item.disabled = true; });
            await handleApprovalAction(button.dataset.approvalAction);
        });
    });
}

function renderTimeline(ticket, workflow) {
    if (!workflow.length) {
        return '<div class="text-muted small fw-bold">ไม่มี workflow สำหรับ ticket นี้</div>';
    }

    return workflow.map((step, index) => {
        const stateClass = index < ticket.stepIndex ? 'done' : index === ticket.stepIndex ? 'current' : 'pending';
        const status = index < ticket.stepIndex
            ? 'ดำเนินการเสร็จแล้ว'
            : index === ticket.stepIndex
                ? 'กำลังอยู่ขั้นตอนนี้'
                : 'รอดำเนินการ';
        const email = getWorkflowStepEmail(ticket, step);
        const titleHtml = email
            ? `${escapeHtml(step)} <span class="step-email">(${escapeHtml(email)})</span>`
            : escapeHtml(step);
        return `
            <div class="approval-step ${stateClass}">
                <div class="approval-step-dot">${index < ticket.stepIndex ? '<i class="bi bi-check"></i>' : index + 1}</div>
                <div>
                    <div class="approval-step-title">${titleHtml}</div>
                    <div class="approval-step-status">${escapeHtml(status)}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function handleApprovalAction(action) {
    if (!currentTicket) return;
    const ticketIndex = approvalTickets.findIndex(ticket => ticket.ticketId === currentTicket.ticketId);
    if (ticketIndex === -1) return;

    try {
        const workflow = getWorkflowTemplate(currentTicket);
        const nowIso = new Date().toISOString();
        let emailEventType = '';

        if (action === 'approve' || action === 'approve-paid') {
            const nextStepIndex = workflow.length
                ? Math.min((currentTicket.stepIndex || 0) + 1, workflow.length - 1)
                : currentTicket.stepIndex || 0;
            currentTicket.stepIndex = nextStepIndex;
            currentTicket.status = getWorkflowStatus(currentTicket, workflow, nextStepIndex);
            currentTicket.note = action === 'approve-paid'
                ? 'อนุมัติแบบมีค่าใช้จ่าย ส่งต่อให้ BPUU Staff แจ้งยอด'
                : 'อนุมัติผ่านลิงก์อีเมลแล้ว';
            currentTicket.approvalSource = 'approve-page';
            currentTicket.approvalUpdatedAt = nowIso;
            currentTicket.paymentRequired = action === 'approve-paid';
            emailEventType = action === 'approve' ? getEmailEventTypeForStep(workflow[nextStepIndex]) : '';
            addApprovalDecision(currentTicket, 'approved');
        } else if (action === 'reject') {
            currentTicket.status = 'ไม่ผ่านการอนุมัติ';
            currentTicket.note = 'ไม่อนุมัติผ่านลิงก์อีเมล';
            currentTicket.approvalSource = 'approve-page';
            currentTicket.approvalUpdatedAt = nowIso;
            emailEventType = 'rejected';
            addApprovalDecision(currentTicket, 'rejected');
        }

        currentTicket.updatedAt = nowIso;
        currentTicket = await saveApprovalTicketRecord(currentTicket);

        if (emailEventType) {
            await sendWorkflowEmailForTicket(currentTicket, emailEventType);
            currentTicket = await saveApprovalTicketRecord(currentTicket);
        }

        const successMessage = action === 'approve-paid'
            ? 'อนุมัติแบบมีค่าใช้จ่ายและส่งต่อให้ BPUU Staff เรียบร้อยแล้ว'
            : action === 'approve'
                ? 'อนุมัติเรียบร้อยแล้ว'
                : 'บันทึกผลไม่อนุมัติเรียบร้อยแล้ว';
        renderApprovalPage(successMessage);
    } catch (error) {
        console.error('Failed to process approval action.', error);
        renderApprovalPage('เกิดข้อผิดพลาดระหว่างบันทึกผล กรุณาลองใหม่อีกครั้ง', 'error');
    }
}

function addApprovalDecision(ticket, decision) {
    ticket.approvalDecisions = Array.isArray(ticket.approvalDecisions) ? ticket.approvalDecisions : [];
    ticket.approvalDecisions.unshift({
        id: `decision-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        decision,
        step: getCurrentStep(ticket),
        createdAt: new Date().toISOString()
    });
}

function getWorkflowTemplate(ticket) {
    return APPROVAL_WORKFLOW_TEMPLATES[ticket.workflowKey] || [];
}

function getCurrentStep(ticket) {
    const workflow = getWorkflowTemplate(ticket);
    if (!workflow.length) return '-';
    const safeIndex = Math.max(0, Math.min(ticket.stepIndex || 0, workflow.length - 1));
    return workflow[safeIndex];
}

function getWorkflowStatus(record, workflow, stepIndex) {
    const stepLabel = workflow[stepIndex] || '';
    if (!stepLabel) return record.status;
    if (/ปิดเรื่อง|ปิดรายการ/i.test(stepLabel)) return 'ปิดเรื่องแล้ว';
    if (/ส่งต่อ/i.test(stepLabel)) return stepLabel;
    if (/แจ้งผล/i.test(stepLabel)) return stepLabel;
    if (/รอ/i.test(stepLabel)) return stepLabel;
    return `รอ ${stepLabel}`;
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
    const step = getCurrentStep(ticket);
    const requesterName = ticket.requesterName || ticket.requester?.requesterName || '-';
    const serviceType = ticket.formName || 'คำขอใช้บริการ';
    const details = ticket.summaryText || ticket.note || '-';
    const link = getApprovalLink(ticket);
    const recipient = eventType === 'approval-request' || eventType === 'payment-notification'
        ? getWorkflowStepEmail(ticket, step)
        : getRequesterEmail(ticket);

    if (eventType === 'rejected' || eventType === 'more-info') {
        const isMoreInfo = eventType === 'more-info';
        return {
            to: recipient,
            subject: `${isMoreInfo ? '[More Info Required]' : '[Rejected]'} แจ้งผลคำขอ ${serviceType} (Ref: ${ticket.ticketId})`,
            body: [
                `เรียน คุณ ${requesterName}`,
                '',
                isMoreInfo
                    ? `กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน ขอข้อมูลหรือเอกสารเพิ่มเติมสำหรับคำขอ "${serviceType}"`
                    : `กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน ขอแจ้งให้ทราบว่าคำขอใช้บริการ "${serviceType}" ไม่ผ่านการอนุมัติ`,
                '',
                `หมายเลขคำขอ: ${ticket.ticketId}`,
                `สถานะปัจจุบัน: ${ticket.status}`,
                `เหตุผล/หมายเหตุ: ${ticket.note || '-'}`,
                '',
                'ขอแสดงความนับถือ',
                'กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)'
            ].join('\n')
        };
    }

    if (eventType === 'completed') {
        return {
            to: recipient,
            subject: `[Completed] แจ้งผลการอนุมัติคำขอ ${serviceType} (Ref: ${ticket.ticketId})`,
            body: [
                `เรียน คุณ ${requesterName}`,
                '',
                `กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน ขอแจ้งความคืบหน้าของคำขอ "${serviceType}"`,
                '',
                `หมายเลขคำขอ: ${ticket.ticketId}`,
                `สถานะปัจจุบัน: ${ticket.status}`,
                `เหตุผลประกอบการพิจารณา: ${ticket.note || 'อนุมัติและดำเนินการเรียบร้อยแล้ว'}`,
                '',
                'ขอแสดงความนับถือ',
                'กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)'
            ].join('\n')
        };
    }

    return {
        to: recipient,
        subject: `[Action Required] อนุมัติคำขอใช้บริการ ${serviceType} - คุณ ${requesterName}`,
        body: [
            'เรียน ผู้อนุมัติ',
            '',
            'มีรายการคำขอรอการอนุมัติจากท่าน กรุณาตรวจสอบรายละเอียดดังนี้:',
            '',
            `- หมายเลขคำขอ: ${ticket.ticketId}`,
            `- ผู้ขอ: ${requesterName}`,
            `- ประเภทบริการ: ${serviceType}`,
            `- ขั้นตอนปัจจุบัน: ${step || '-'}`,
            `- รายละเอียด: ${details}`,
            '',
            'กรุณาเลือกผลการพิจารณาในระบบ:',
            link,
            '',
            'ขอแสดงความนับถือ',
            'BPUU Workflow System'
        ].join('\n')
    };
}

function getWorkflowStepEmail(ticket, step) {
    const roleEmails = APPROVAL_CONFIG.roleEmails || {};
    const requesterEmail = getRequesterEmail(ticket);
    const approverEmail = ticket.approverEmail
        || ticket.emailDetails?.approverSubmittedEmail
        || ticket.submissionFields?.q30_input30
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
    return approverEmail || APPROVAL_CONFIG.primaryApprovalEmail || '';
}

function getRequesterEmail(ticket) {
    return ticket.requesterEmail
        || ticket.emailDetails?.requesterSubmittedEmail
        || ticket.requester?.submittedEmail
        || ticket.requester?.email
        || ticket.submissionFields?.q20_input20
        || '';
}

function getApprovalLink(ticket) {
    const url = new URL('approve.html', window.location.href);
    url.searchParams.set('ticket', ticket.ticketId);
    return url.toString();
}

async function sendWorkflowEmailForTicket(ticket, eventType) {
    const email = buildWorkflowEmail(ticket, eventType);
    const result = await sendWorkflowEmailViaApi(email, ticket, eventType);
    addWorkflowEmailEvent(ticket, email, eventType, result.status, result.error || '');
    return result.ok;
}

async function sendWorkflowEmailViaApi(email, ticket, eventType) {
    if (!email?.to) return { ok: false, status: 'skipped', error: 'Missing recipient email' };
    const endpoint = String(APPROVAL_CONFIG.emailTransport?.endpoint || '/api/send-email').trim();
    if (!endpoint) return { ok: false, status: 'skipped', error: 'Missing email API endpoint' };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: APPROVAL_CONFIG.systemEmail || '',
                to: email.to,
                subject: email.subject,
                text: email.body,
                body: email.body,
                attachments: email.attachments || [],
                ticketId: ticket.ticketId,
                eventType,
                workflowKey: ticket.workflowKey,
                step: getCurrentStep(ticket)
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

function buildFallbackSummary(ticket) {
    return `
        <div class="list-group list-group-flush">
            ${[
                ['ประเภทคำขอ', ticket.formName || '-'],
                ['ผู้ขอ', ticket.requesterName || '-'],
                ['ประเภทผู้ขอ', ticket.requesterType || '-'],
                [ticket.contextLabel || 'รายละเอียด', ticket.contextValue || '-'],
                ['สถานะ', ticket.status || '-'],
                ['หมายเหตุ', ticket.note || '-']
            ].map(([label, value]) => `
                <div class="list-group-item px-0">
                    <div class="small fw-bold text-secondary">${escapeHtml(label)}</div>
                    <div class="fw-bold" style="white-space: pre-line;">${escapeHtml(value)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function getAttachmentChips(ticket) {
    const attachments = Array.isArray(ticket.selectedAttachments) ? ticket.selectedAttachments : [];
    if (!attachments.length) return '';

    return `
        <div class="approval-attachments">
            ${attachments.map(file => `
                <a class="approval-file-chip" href="${escapeAttribute(file.dataUrl || '#')}" target="_blank" rel="noopener noreferrer">
                    <i class="bi bi-paperclip"></i>${escapeHtml(file.name || 'ไฟล์แนบ')}
                </a>
            `).join('')}
        </div>
    `;
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('`', '&#96;');
}
