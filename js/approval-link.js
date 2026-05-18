(function () {
    function trim(value) {
        return String(value == null ? '' : value).trim();
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function createApprovalLinkToken() {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return window.crypto.randomUUID();
            }
        } catch (error) {
            // Fall through to the timestamp-based token below.
        }

        return `approval-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function ensureApprovalLink(ticket, currentStep) {
        const ticketId = trim(ticket?.ticketId);
        const step = trim(currentStep);

        if (!ticketId) {
            return { token: '', reused: false, step };
        }

        const activeToken = trim(ticket.approvalLinkToken);
        const activeStep = trim(ticket.approvalLinkStep);
        const usedAt = trim(ticket.approvalLinkUsedAt);

        if (activeToken && activeStep === step && !usedAt) {
            return { token: activeToken, reused: true, step };
        }

        const token = createApprovalLinkToken();
        ticket.approvalLinkToken = token;
        ticket.approvalLinkStep = step;
        ticket.approvalLinkIssuedAt = nowIso();
        delete ticket.approvalLinkUsedAt;

        return { token, reused: false, step };
    }

    function buildApprovalLinkUrl(ticket, currentStep, baseHref) {
        const ticketId = trim(ticket?.ticketId);
        if (!ticketId) return '';

        const state = ensureApprovalLink(ticket, currentStep);
        const url = new URL('approve.html', baseHref || window.location.href);
        url.searchParams.set('ticket', ticketId);

        if (state.token) {
            url.searchParams.set('approval', state.token);
        }

        return url.toString();
    }

    function readApprovalLinkContext() {
        const params = new URLSearchParams(window.location.search);
        return {
            ticketId: trim(params.get('ticket')),
            approvalToken: trim(params.get('approval'))
        };
    }

    function getApprovalLinkState(ticket, currentStep, approvalToken) {
        const ticketStep = trim(ticket?.approvalLinkStep);
        const activeToken = trim(ticket?.approvalLinkToken);
        const usedAt = trim(ticket?.approvalLinkUsedAt);
        const linkToken = trim(approvalToken);
        const step = trim(currentStep);
        const stepMatches = !ticketStep || !step || ticketStep === step;

        if (!ticket || typeof ticket !== 'object') {
            return { allowed: false, reason: 'missing-ticket', stepMatches: false, tokenMatches: false };
        }

        if (usedAt) {
            return { allowed: false, reason: 'used', stepMatches, tokenMatches: false };
        }

        if (!stepMatches) {
            return { allowed: false, reason: 'step-mismatch', stepMatches: false, tokenMatches: false };
        }

        if (activeToken) {
            if (!linkToken) {
                return { allowed: false, reason: 'token-required', stepMatches, tokenMatches: false };
            }

            if (linkToken !== activeToken) {
                return { allowed: false, reason: 'token-mismatch', stepMatches, tokenMatches: false };
            }

            return { allowed: true, reason: 'token-match', stepMatches, tokenMatches: true };
        }

        if (linkToken) {
            return { allowed: false, reason: 'token-mismatch', stepMatches, tokenMatches: false };
        }

        return { allowed: true, reason: 'legacy', stepMatches, tokenMatches: true };
    }

    function consumeApprovalLink(ticket, currentStep) {
        if (!ticket || typeof ticket !== 'object') return ticket;
        ticket.approvalLinkUsedAt = nowIso();
        if (currentStep) {
            ticket.approvalLinkStep = trim(currentStep);
        }
        return ticket;
    }

    function getApprovalLinkStateMessage(state) {
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

    window.BPUU_APPROVAL_LINKS = {
        buildApprovalLinkUrl,
        consumeApprovalLink,
        createApprovalLinkToken,
        ensureApprovalLink,
        getApprovalLinkState,
        getApprovalLinkStateMessage,
        readApprovalLinkContext
    };
})();
