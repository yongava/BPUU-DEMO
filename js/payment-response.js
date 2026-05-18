const PAYMENT_RESPONSE_STATE = {
    ticket: null,
    submitting: false,
    message: '',
    tone: 'success'
};

document.addEventListener('DOMContentLoaded', () => {
    void initPaymentResponsePage();
});

async function initPaymentResponsePage() {
    const app = document.getElementById('paymentApp');
    const ticketId = new URLSearchParams(window.location.search).get('ticket') || '';

    if (!ticketId) {
        renderPaymentResponseError('ไม่พบหมายเลขคำขอในลิงก์นี้');
        return;
    }

    try {
        PAYMENT_RESPONSE_STATE.ticket = await window.BPUU_WORKFLOW_API.getTicket(ticketId);
    } catch (error) {
        console.error('Failed to load ticket for payment response.', error);
        renderPaymentResponseError('ไม่สามารถโหลดข้อมูลคำขอได้ในตอนนี้');
        return;
    }

    if (!PAYMENT_RESPONSE_STATE.ticket) {
        renderPaymentResponseError(`ไม่พบคำขอหมายเลข ${ticketId}`);
        return;
    }

    renderPaymentResponsePage();
    bindPaymentResponseForm();

    if (PAYMENT_RESPONSE_STATE.ticket.paymentSlipInfo) {
        const info = PAYMENT_RESPONSE_STATE.ticket.paymentSlipInfo;
        fillFormValue('paymentTaxId', info.taxId || '');
        fillFormValue('paymentName', info.name || '');
        fillFormValue('paymentAddress', info.address || '');
        fillFormValue('paymentPhone', info.phone || '');
        fillFormValue('paymentNote', info.note || '');
    }
}

function renderPaymentResponseError(message) {
    const app = document.getElementById('paymentApp');
    if (!app) return;
    app.innerHTML = `
        <div class="alert alert-warning mb-0">
            <div class="fw-bold mb-1">${escapeHtml(message)}</div>
            <div class="small">กรุณาเปิดลิงก์จากอีเมลแจ้งยอดอีกครั้ง หรือกลับไปตรวจสอบ ticket ให้ถูกต้อง</div>
        </div>
    `;
}

function renderPaymentResponsePage() {
    const app = document.getElementById('paymentApp');
    const ticket = PAYMENT_RESPONSE_STATE.ticket;
    const amount = Number(ticket.paymentAmount || 0);
    const qrAttachment = ticket.paymentQrAttachment;
    const isQrImage = /^image\//i.test(qrAttachment?.type || '') || /^data:image\//i.test(qrAttachment?.dataUrl || '');
    const qrPreview = qrAttachment?.dataUrl
        ? isQrImage
            ? `
                <div class="mb-3">
                    <div class="small fw-bold text-ci-bluegrey mb-2">QR Code สำหรับชำระเงิน</div>
                    <a href="${escapeAttribute(qrAttachment.dataUrl)}" target="_blank" rel="noopener noreferrer">
                        <img class="qr-preview img-fluid" src="${escapeAttribute(qrAttachment.dataUrl)}" alt="QR Code">
                    </a>
                </div>
            `
            : `
                <div class="mb-3">
                    <div class="small fw-bold text-ci-bluegrey mb-2">QR Code สำหรับชำระเงิน</div>
                    <a class="btn btn-outline-primary fw-bold" href="${escapeAttribute(qrAttachment.dataUrl)}" target="_blank" rel="noopener noreferrer">
                        <i class="bi bi-paperclip me-1"></i>เปิดไฟล์ QR Code
                    </a>
                </div>
            `
        : `
            <div class="alert alert-light border mb-3">
                ไม่พบไฟล์ QR Code ในระบบ กรุณาชำระเงินตามข้อมูลที่แจ้งในอีเมล
            </div>
        `;

    app.innerHTML = `
        <div class="row g-4 align-items-start">
            <div class="col-12 col-lg-5">
                <div class="p-4 rounded-4 border bg-white h-100">
                    <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
                        <span class="ticket-chip"><i class="bi bi-ticket-perforated-fill"></i>${escapeHtml(ticket.ticketId)}</span>
                        <span class="badge rounded-pill bg-light text-dark border fw-bold">${escapeHtml(ticket.status || 'รอชำระเงิน')}</span>
                    </div>
                    <h2 class="h4 fw-bold mb-2">${escapeHtml(ticket.formName || 'คำขอจอดรถค้างคืน')}</h2>
                    <div class="text-muted mb-3">${escapeHtml(ticket.requesterName || '-')} · ${escapeHtml(ticket.requesterType || '-')}</div>
                    <div class="mb-3">
                        <div class="small fw-bold text-ci-bluegrey mb-1">ยอดชำระ</div>
                        <div class="h3 fw-black text-ci-orange mb-0">${formatCurrency(amount)}</div>
                    </div>
                    ${qrPreview}
                    <div class="small text-muted">
                        หลังโอนเงินแล้ว ให้แนบสลิปและกรอกข้อมูลออกใบเสร็จในแบบฟอร์มด้านขวา
                    </div>
                </div>
            </div>
            <div class="col-12 col-lg-7">
                <form id="paymentResponseForm" class="p-4 rounded-4 border bg-white">
                    <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                        <div>
                            <h3 class="h5 fw-bold mb-1">แนบสลิปและข้อมูลใบเสร็จ</h3>
                            <p class="text-muted small mb-0">ระบบจะส่งข้อมูลนี้ไปยัง BPUU Staff โดยอัตโนมัติเมื่อกด submit</p>
                        </div>
                        <span class="badge rounded-pill bg-warning text-dark fw-bold">Required</span>
                    </div>

                    <div class="row g-3">
                        <div class="col-12">
                            <label class="form-label fw-bold text-ci-bluegrey" for="paymentSlipFile">ไฟล์สลิปโอนเงิน</label>
                            <input class="form-control" type="file" id="paymentSlipFile" accept="image/*,.pdf" required>
                        </div>
                        <div class="col-12 col-md-6">
                            <label class="form-label fw-bold text-ci-bluegrey" for="paymentTaxId">เลขประจำตัวผู้เสียภาษี</label>
                            <input class="form-control" type="text" id="paymentTaxId" placeholder="กรอกเลขประจำตัวผู้เสียภาษี" required>
                        </div>
                        <div class="col-12 col-md-6">
                            <label class="form-label fw-bold text-ci-bluegrey" for="paymentName">ชื่อ นามสกุล หรือ ชื่อนิติบุคคล</label>
                            <input class="form-control" type="text" id="paymentName" placeholder="กรอกชื่อผู้รับใบเสร็จ" required>
                        </div>
                        <div class="col-12">
                            <label class="form-label fw-bold text-ci-bluegrey" for="paymentAddress">ที่อยู่</label>
                            <textarea class="form-control" id="paymentAddress" rows="3" placeholder="ที่อยู่สำหรับออกใบเสร็จ" required></textarea>
                        </div>
                        <div class="col-12 col-md-6">
                            <label class="form-label fw-bold text-ci-bluegrey" for="paymentPhone">เบอร์โทร</label>
                            <input class="form-control" type="tel" id="paymentPhone" placeholder="กรอกเบอร์โทร" required>
                        </div>
                        <div class="col-12 col-md-6">
                            <label class="form-label fw-bold text-ci-bluegrey" for="paymentNote">หมายเหตุเพิ่มเติม</label>
                            <input class="form-control" type="text" id="paymentNote" placeholder="ถ้ามี">
                        </div>
                    </div>

                    <div class="d-flex flex-wrap gap-2 mt-4">
                        <button type="submit" class="btn btn-ci-orange fw-bold" id="submitPaymentBtn">
                            <i class="bi bi-send-fill me-1"></i>ส่งข้อมูลให้ BPUU Staff
                        </button>
                        <a class="btn btn-outline-secondary fw-bold" href="index.html">กลับหน้าแรก</a>
                    </div>

                    <div id="paymentResponseMessage" class="mt-3"></div>
                </form>
            </div>
        </div>
    `;
}

function bindPaymentResponseForm() {
    const form = document.getElementById('paymentResponseForm');
    if (!form) return;
    form.addEventListener('submit', event => {
        event.preventDefault();
        void handlePaymentResponseSubmit();
    });
}

async function handlePaymentResponseSubmit() {
    if (PAYMENT_RESPONSE_STATE.submitting) return;
    PAYMENT_RESPONSE_STATE.submitting = true;
    renderPaymentResponseMessage('กำลังส่งข้อมูล...', 'info');

    try {
        const ticket = PAYMENT_RESPONSE_STATE.ticket;
        const slipFile = document.getElementById('paymentSlipFile')?.files?.[0] || null;
        const taxId = String(document.getElementById('paymentTaxId')?.value || '').trim();
        const name = String(document.getElementById('paymentName')?.value || '').trim();
        const address = String(document.getElementById('paymentAddress')?.value || '').trim();
        const phone = String(document.getElementById('paymentPhone')?.value || '').trim();
        const note = String(document.getElementById('paymentNote')?.value || '').trim();

        if (!slipFile) {
            throw new Error('กรุณาแนบไฟล์สลิปก่อนส่งข้อมูล');
        }
        if (!taxId || !name || !address || !phone) {
            throw new Error('กรุณากรอกข้อมูลออกใบเสร็จให้ครบ');
        }

        const slipAttachment = {
            name: slipFile.name,
            type: slipFile.type || 'application/octet-stream',
            size: slipFile.size || 0,
            dataUrl: await readFileAsDataUrl(slipFile)
        };

        const updatedTicket = {
            ...ticket,
            status: 'รอตรวจสลิป',
            stepIndex: 6,
            paymentSlipInfo: {
                taxId,
                name,
                address,
                phone,
                note
            },
            paymentSlipAttachment: slipAttachment,
            paymentSlipSubmittedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            note: note || 'ผู้ขอแนบสลิปและข้อมูลออกใบเสร็จแล้ว'
        };

        PAYMENT_RESPONSE_STATE.ticket = await window.BPUU_WORKFLOW_API.upsertTicket(updatedTicket);
        await sendPaymentSlipEmail(PAYMENT_RESPONSE_STATE.ticket, slipAttachment);

        renderPaymentResponseMessage('ส่งสลิปและข้อมูลเรียบร้อยแล้ว BPUU Staff จะตรวจสอบต่อทันที', 'success');
        form.querySelectorAll('input, textarea, button').forEach(item => {
            if (item instanceof HTMLButtonElement || item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement) {
                item.disabled = true;
            }
        });
    } catch (error) {
        console.error('Failed to submit payment response.', error);
        renderPaymentResponseMessage(error?.message || 'ส่งข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง', 'danger');
    } finally {
        PAYMENT_RESPONSE_STATE.submitting = false;
    }
}

function renderPaymentResponseMessage(message, tone = 'success') {
    const target = document.getElementById('paymentResponseMessage');
    if (!target) return;
    if (!message) {
        target.innerHTML = '';
        return;
    }
    const classes = tone === 'danger'
        ? 'alert alert-danger'
        : tone === 'info'
            ? 'alert alert-info'
            : 'alert alert-success';
    target.innerHTML = `<div class="${classes} mb-0 fw-bold">${escapeHtml(message)}</div>`;
}

function fillFormValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
}

function formatCurrency(value) {
    const amount = Number(value || 0);
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 2
    }).format(Number.isFinite(amount) ? amount : 0);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

async function sendPaymentSlipEmail(ticket, slipAttachment) {
    const endpoint = String(window.BPUU_WORKFLOW_TEST_CONFIG?.emailTransport?.endpoint || '/api/send-email').trim();
    if (!endpoint) return;

    const to = window.BPUU_WORKFLOW_TEST_CONFIG?.roleEmails?.bpuuStaff || 'bpuu.dev1@kmutt.ac.th';
    const info = ticket.paymentSlipInfo || {};
    const adminLink = new URL('admin.html', window.location.href).toString();

    const body = [
        'เรียน BPUU Staff',
        '',
        `มีผู้ขอชำระเงินส่งสลิปเข้าระบบแล้วสำหรับคำขอ ${ticket.ticketId}`,
        '',
        `ชื่อคำขอ: ${ticket.formName || '-'}`,
        `ผู้ขอ: ${ticket.requesterName || '-'}`,
        `เลขประจำตัวผู้เสียภาษี: ${info.taxId || '-'}`,
        `ชื่อ: ${info.name || '-'}`,
        `ที่อยู่: ${info.address || '-'}`,
        `เบอร์โทร: ${info.phone || '-'}`,
        `หมายเหตุ: ${info.note || '-'}`,
        '',
        'เปิดรายการตรวจสอบในระบบ:',
        adminLink,
        '',
        'ขอแสดงความนับถือ',
        'BPUU Workflow System'
    ].join('\n');

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: window.BPUU_WORKFLOW_TEST_CONFIG?.systemEmail || '',
            to,
            subject: `[Payment Slip Submitted] ${ticket.formName || 'คำขอจอดรถค้างคืน'} (Ref: ${ticket.ticketId})`,
            text: body,
            body,
            attachments: [slipAttachment]
        })
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || `HTTP ${response.status}`);
    }
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
