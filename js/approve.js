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
let approvalLinkContext = { ticketId: '', approvalToken: '' };
let paidApprovalModalInstance = null;
let paidApprovalModalBound = false;

setTimeout(() => {
    initPaidApprovalModal();
    void initApprovalPage();
}, 0);

function initPaidApprovalModal() {
    if (paidApprovalModalBound) return;

    const modalEl = document.getElementById('paidApprovalModal');
    const form = document.getElementById('paidApprovalForm');
    const qrInput = document.getElementById('paidApprovalQr');

    if (!modalEl || typeof bootstrap === 'undefined') return;

    paidApprovalModalInstance = bootstrap.Modal.getOrCreateInstance
        ? bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: 'static', keyboard: false })
        : new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });

    form?.addEventListener('submit', event => {
        event.preventDefault();
        void submitPaidApprovalFromModal();
    });

    qrInput?.addEventListener('change', updatePaidApprovalQrLabel);
    modalEl.addEventListener('hidden.bs.modal', resetPaidApprovalModal);
    paidApprovalModalBound = true;
}

async function initApprovalPage() {
    approvalLinkContext = readApprovalLinkContext();
    try {
        approvalTickets = await loadApprovalTickets();
    } catch (error) {
        console.error('Failed to load approval tickets from backend.', error);
        approvalTickets = [];
    }
    const ticketId = approvalLinkContext.ticketId || '';
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

function getApprovalLinkTools() {
    return window.BPUU_APPROVAL_LINKS || {};
}

function readApprovalLinkContext() {
    const tools = getApprovalLinkTools();
    if (typeof tools.readApprovalLinkContext === 'function') {
        return tools.readApprovalLinkContext();
    }

    const params = new URLSearchParams(window.location.search);
    return {
        ticketId: String(params.get('ticket') || '').trim(),
        approvalToken: String(params.get('approval') || '').trim()
    };
}

function evaluateApprovalLinkState(ticket, currentStep) {
    const tools = getApprovalLinkTools();
    if (typeof tools.getApprovalLinkState === 'function') {
        return tools.getApprovalLinkState(ticket, currentStep, approvalLinkContext.approvalToken);
    }

    const ticketToken = String(ticket?.approvalLinkToken || '').trim();
    const token = String(approvalLinkContext.approvalToken || '').trim();
    const usedAt = String(ticket?.approvalLinkUsedAt || '').trim();
    const step = String(currentStep || '').trim();
    const ticketStep = String(ticket?.approvalLinkStep || '').trim();
    const stepMatches = !ticketStep || !step || ticketStep === step;

    if (!ticket) return { allowed: false, reason: 'missing-ticket', stepMatches: false, tokenMatches: false };
    if (usedAt) return { allowed: false, reason: 'used', stepMatches, tokenMatches: false };
    if (!stepMatches) return { allowed: false, reason: 'step-mismatch', stepMatches: false, tokenMatches: false };
    if (ticketToken) {
        if (!token) return { allowed: false, reason: 'token-required', stepMatches, tokenMatches: false };
        if (token !== ticketToken) return { allowed: false, reason: 'token-mismatch', stepMatches, tokenMatches: false };
        return { allowed: true, reason: 'token-match', stepMatches, tokenMatches: true };
    }
    if (token) return { allowed: false, reason: 'token-mismatch', stepMatches, tokenMatches: false };
    return { allowed: true, reason: 'legacy', stepMatches, tokenMatches: true };
}

function markApprovalLinkUsed(ticket, currentStep) {
    const tools = getApprovalLinkTools();
    if (typeof tools.consumeApprovalLink === 'function') {
        return tools.consumeApprovalLink(ticket, currentStep);
    }

    if (ticket && typeof ticket === 'object') {
        ticket.approvalLinkUsedAt = new Date().toISOString();
        if (currentStep) {
            ticket.approvalLinkStep = String(currentStep || '').trim();
        }
    }

    return ticket;
}

function getApprovalLinkStateMessage(state) {
    const tools = getApprovalLinkTools();
    if (typeof tools.getApprovalLinkStateMessage === 'function') {
        return tools.getApprovalLinkStateMessage(state);
    }

    switch (state?.reason) {
        case 'used':
            return 'ลิงก์นี้ถูกใช้งานแล้ว และอนุมัติ/ไม่อนุมัติได้เพียงครั้งเดียว';
        case 'step-mismatch':
            return 'ลิงก์นี้เป็นของขั้นตอนเดิม กรุณาใช้ลิงก์ในอีเมลฉบับล่าสุด';
        case 'token-required':
            return 'ลิงก์นี้ต้องเปิดจากอีเมลฉบับล่าสุด';
        case 'token-mismatch':
            return 'ลิงก์นี้ไม่ตรงกับรายการที่เปิดใช้งานอยู่';
        case 'legacy':
            return 'ลิงก์รุ่นเก่า ยังอนุมัติหรือไม่อนุมัติได้เพียงครั้งเดียว';
        default:
            return 'ลิงก์นี้ไม่พร้อมสำหรับการอนุมัติ';
    }
}

function renderApprovalPage(message = '', tone = 'success') {
    const root = document.getElementById('approvalRoot');
    if (!root) return;

    if (!currentTicket) {
        root.innerHTML = `
            <div class="approval-empty">
                <i class="bi bi-search display-5 text-warning"></i>
                <div>
                    <h2 class="h4 fw-bold text-dark">ไม่พบคำขอที่ต้องอนุมัติ</h2>
                    <p class="mb-0">กรุณาตรวจสอบ ticket ใน URL หรือเปิดลิงก์จากอีเมลฉบับล่าสุดอีกครั้ง</p>
                </div>
            </div>
        `;
        return;
    }

    const workflow = getWorkflowTemplate(currentTicket);
    const currentStep = getCurrentStep(currentTicket);
    const canApproveWithCost = currentTicket.workflowKey === 'overnightStaff' && /BPUU พิจารณา/i.test(String(currentStep || ''));
    const approvalState = evaluateApprovalLinkState(currentTicket, currentStep);
    const canTakeAction = Boolean(approvalState.allowed);
    const approvalStateMessage = getApprovalLinkStateMessage(approvalState);
    const showLockBanner = !canTakeAction && !message;
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
                ${canTakeAction ? `
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
                ` : showLockBanner ? `
                <div class="approval-result error">
                    ${escapeHtml(approvalStateMessage)}
                </div>
                ` : ''}
                ${message ? `<div class="approval-result ${tone === 'error' ? 'error' : ''}">${escapeHtml(message)}</div>` : ''}
            </aside>
        </div>
    `;

    if (canTakeAction) {
        root.querySelectorAll('[data-approval-action]').forEach(button => {
            button.addEventListener('click', async () => {
                const action = button.dataset.approvalAction;
                if (action === 'approve-paid') {
                    openPaidApprovalModal();
                    return;
                }

                root.querySelectorAll('[data-approval-action]').forEach(item => { item.disabled = true; });
                await handleApprovalAction(action);
            });
        });
    }
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

async function handleApprovalAction(action, options = {}) {
    if (!currentTicket) {
        return { ok: false, message: 'ไม่พบคำขอที่ต้องอนุมัติ' };
    }

    try {
        approvalTickets = await loadApprovalTickets();
        const latestTicket = approvalTickets.find(ticket => ticket.ticketId === currentTicket.ticketId) || null;
        if (!latestTicket) {
            renderApprovalPage('ไม่พบคำขอที่ต้องอนุมัติ', 'error');
            return { ok: false, message: 'ไม่พบคำขอที่ต้องอนุมัติ' };
        }

        const ticketIndex = approvalTickets.findIndex(ticket => ticket.ticketId === latestTicket.ticketId);
        if (ticketIndex === -1) {
            return { ok: false, message: 'ไม่พบคำขอที่ต้องอนุมัติ' };
        }

        const workflow = getWorkflowTemplate(latestTicket);
        const nowIso = new Date().toISOString();
        let emailEventType = '';
        const currentStep = getCurrentStep(latestTicket);
        const approvalState = evaluateApprovalLinkState(latestTicket, currentStep);

        if (!approvalState.allowed) {
            renderApprovalPage(getApprovalLinkStateMessage(approvalState), 'error');
            return { ok: false, message: getApprovalLinkStateMessage(approvalState) };
        }

        const workingTicket = cloneTicket(latestTicket);
        const decisionStep = currentStep;

        if (action === 'approve' || action === 'approve-paid') {
            if (action === 'approve-paid') {
                const amount = Number(options.paymentAmount || 0);
                const qrFile = options.paymentQrFile || null;
                const paymentStepIndex = workflow.findIndex(step => /รอชำระเงิน/i.test(step));

                if (!amount || amount <= 0) {
                    throw new Error('กรุณาระบุจำนวนเงินก่อนบันทึกการอนุมัติแบบมีค่าใช้จ่าย');
                }
                if (!qrFile) {
                    throw new Error('กรุณาแนบไฟล์ QR Code ก่อนบันทึกการอนุมัติแบบมีค่าใช้จ่าย');
                }
                if (paymentStepIndex === -1) {
                    throw new Error('ไม่พบขั้นตอนรอชำระเงินใน workflow นี้');
                }

                workingTicket.paymentAmount = amount;
                workingTicket.paymentRequired = true;
                workingTicket.paymentNotificationNote = 'อนุมัติแบบมีค่าใช้จ่ายโดย BPUU Staff ข้าม BPUU Manager';
                workingTicket.paymentResponseUrl = `${window.location.origin}/payment-response.html?ticket=${encodeURIComponent(workingTicket.ticketId)}`;
                workingTicket.paymentQrAttachment = {
                    name: qrFile.name,
                    type: qrFile.type || 'image/png',
                    size: qrFile.size || 0,
                    dataUrl: await readApprovalFileAsDataUrl(qrFile)
                };
                workingTicket.stepIndex = paymentStepIndex;
                workingTicket.status = getWorkflowStatus(workingTicket, workflow, paymentStepIndex);
                workingTicket.note = 'อนุมัติแบบมีค่าใช้จ่ายโดย BPUU Staff และแจ้งยอดชำระเงินแล้ว';
                workingTicket.paymentNotificationAt = nowIso;
                workingTicket.approvalSource = 'approve-page';
                workingTicket.approvalUpdatedAt = nowIso;
                markApprovalLinkUsed(workingTicket, currentStep);
                emailEventType = 'payment-notification';
                addApprovalDecision(workingTicket, 'approved-with-cost', decisionStep);
            } else {
                const nextStepIndex = workflow.length
                    ? Math.min((latestTicket.stepIndex || 0) + 1, workflow.length - 1)
                    : latestTicket.stepIndex || 0;
                workingTicket.stepIndex = nextStepIndex;
                workingTicket.status = getWorkflowStatus(workingTicket, workflow, nextStepIndex);
                workingTicket.note = 'อนุมัติผ่านลิงก์อีเมลแล้ว';
                workingTicket.approvalSource = 'approve-page';
                workingTicket.approvalUpdatedAt = nowIso;
                markApprovalLinkUsed(workingTicket, currentStep);
                emailEventType = getEmailEventTypeForStep(workflow[nextStepIndex]);
                addApprovalDecision(workingTicket, 'approved', decisionStep);
            }
        } else if (action === 'reject') {
            workingTicket.status = 'ไม่ผ่านการอนุมัติ';
            workingTicket.note = 'ไม่อนุมัติผ่านลิงก์อีเมล';
            workingTicket.approvalSource = 'approve-page';
            workingTicket.approvalUpdatedAt = nowIso;
            markApprovalLinkUsed(workingTicket, currentStep);
            emailEventType = 'rejected';
            addApprovalDecision(workingTicket, 'rejected', decisionStep);
        }

        workingTicket.updatedAt = nowIso;
        currentTicket = await saveApprovalTicketRecord(workingTicket);

        if (emailEventType) {
            await sendWorkflowEmailForTicket(currentTicket, emailEventType);
            currentTicket = await saveApprovalTicketRecord(currentTicket);
        }

        const successMessage = action === 'approve-paid'
            ? 'อนุมัติแบบมีค่าใช้จ่ายและส่ง QR Code เรียบร้อยแล้ว'
            : action === 'approve'
                ? 'อนุมัติเรียบร้อยแล้ว'
                : 'บันทึกผลไม่อนุมัติเรียบร้อยแล้ว';
        renderApprovalPage(successMessage);
        return { ok: true, message: successMessage, ticket: currentTicket };
    } catch (error) {
        console.error('Failed to process approval action.', error);
        const message = error?.message || 'เกิดข้อผิดพลาดระหว่างบันทึกผล กรุณาลองใหม่อีกครั้ง';
        renderApprovalPage(message, 'error');
        return { ok: false, message };
    }
}

function addApprovalDecision(ticket, decision, step = getCurrentStep(ticket)) {
    ticket.approvalDecisions = Array.isArray(ticket.approvalDecisions) ? ticket.approvalDecisions : [];
    ticket.approvalDecisions.unshift({
        id: `decision-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        decision,
        step,
        createdAt: new Date().toISOString()
    });
}

function cloneTicket(ticket) {
    return ticket ? JSON.parse(JSON.stringify(ticket)) : null;
}

function initPaidApprovalModalFields() {
    const amountInput = document.getElementById('paidApprovalAmount');
    const qrInput = document.getElementById('paidApprovalQr');
    const messageBox = document.getElementById('paidApprovalFormMessage');

    if (amountInput) {
        amountInput.value = currentTicket?.paymentAmount ? String(currentTicket.paymentAmount) : '';
    }

    if (qrInput) {
        qrInput.value = '';
    }

    if (messageBox) {
        messageBox.innerHTML = '';
    }

    updatePaidApprovalQrLabel();
    updatePaidApprovalModalSummary();
}

function openPaidApprovalModal() {
    if (!currentTicket) return;
    initPaidApprovalModal();
    initPaidApprovalModalFields();
    paidApprovalModalInstance?.show();
    document.getElementById('paidApprovalAmount')?.focus();
}

function updatePaidApprovalModalSummary() {
    const summaryBox = document.getElementById('paidApprovalSummary');
    if (!summaryBox || !currentTicket) return;

    summaryBox.innerHTML = `
        <div class="fw-bold text-dark mb-1">${escapeHtml(currentTicket.ticketId || '-')}</div>
        <div>${escapeHtml(currentTicket.formName || 'คำขอใช้บริการ')}</div>
        <div class="small text-muted mt-1">
            ผู้ขอ: ${escapeHtml(currentTicket.requesterName || '-')} · ขั้นตอน: ${escapeHtml(getCurrentStep(currentTicket))}
        </div>
    `;
}

function resetPaidApprovalModal() {
    const confirmBtn = document.getElementById('paidApprovalConfirmBtn');
    const messageBox = document.getElementById('paidApprovalFormMessage');
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="bi bi-send-check me-1"></i>อนุมัติและส่ง QR';
    }
    if (messageBox) {
        messageBox.innerHTML = '';
    }
}

function updatePaidApprovalQrLabel() {
    const qrInput = document.getElementById('paidApprovalQr');
    const qrLabel = document.getElementById('paidApprovalQrLabel');
    if (!qrInput || !qrLabel) return;
    const file = qrInput.files?.[0] || null;
    qrLabel.textContent = file ? `เลือกไฟล์แล้ว: ${file.name}` : 'ยังไม่ได้เลือกไฟล์';
}

function setPaidApprovalModalMessage(message, tone = 'danger') {
    const messageBox = document.getElementById('paidApprovalFormMessage');
    if (!messageBox) return;
    if (!message) {
        messageBox.innerHTML = '';
        return;
    }

    const alertClass = tone === 'success'
        ? 'alert-success'
        : tone === 'warning'
            ? 'alert-warning'
            : tone === 'info'
                ? 'alert-info'
                : 'alert-danger';

    messageBox.innerHTML = `
        <div class="alert ${alertClass} py-2 px-3 mb-0 small fw-bold" role="alert">
            ${escapeHtml(message)}
        </div>
    `;
}

function setPaidApprovalModalBusy(isBusy) {
    const confirmBtn = document.getElementById('paidApprovalConfirmBtn');
    if (!confirmBtn) return;
    confirmBtn.disabled = Boolean(isBusy);
    confirmBtn.innerHTML = isBusy
        ? '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>กำลังบันทึก'
        : '<i class="bi bi-send-check me-1"></i>อนุมัติและส่ง QR';
}

async function submitPaidApprovalFromModal() {
    if (!currentTicket) return;

    const amount = Number(document.getElementById('paidApprovalAmount')?.value || 0);
    const qrFile = document.getElementById('paidApprovalQr')?.files?.[0] || null;

    if (!amount || amount <= 0) {
        setPaidApprovalModalMessage('กรุณาระบุจำนวนเงินก่อนดำเนินการ', 'danger');
        return;
    }

    if (!qrFile) {
        setPaidApprovalModalMessage('กรุณาแนบไฟล์ QR Code ก่อนดำเนินการ', 'danger');
        return;
    }

    setPaidApprovalModalMessage('');
    setPaidApprovalModalBusy(true);

    try {
        const result = await handleApprovalAction('approve-paid', {
            paymentAmount: amount,
            paymentQrFile: qrFile
        });

        if (result?.ok) {
            paidApprovalModalInstance?.hide();
            return;
        }

        setPaidApprovalModalMessage(result?.message || 'ไม่สามารถบันทึกการอนุมัติแบบมีค่าใช้จ่ายได้', 'danger');
    } finally {
        setPaidApprovalModalBusy(false);
    }
}

function readApprovalFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read QR file'));
        reader.readAsDataURL(file);
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

    const link = getApprovalLink(ticket);
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
            'หมายเหตุ: ลิงก์นี้ใช้อนุมัติหรือไม่อนุมัติได้เพียงครั้งเดียวเท่านั้น',
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
    const tools = window.BPUU_APPROVAL_LINKS || {};
    if (typeof tools.buildApprovalLinkUrl === 'function') {
        return tools.buildApprovalLinkUrl(ticket, getCurrentStep(ticket), window.location.href);
    }

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
