window.BPUU_WORKFLOW_TEST_CONFIG = {
    systemEmail: 'dev.codegym@gmail.com',
    primaryApprovalEmail: 'yeongstorage@gmail.com',
    requesterEmails: {
        staff: 'n.chotthanin@gmail.com',
        student: 'n.chotthanin@gmail.com',
        external: 'n.chotthanin@gmail.com'
    },
    roleEmails: {
        bpuuStaff: 'yeongstorage@gmail.com',
        bpuuHead: 'yeongstorage@gmail.com',
        financeViceRector: 'yeongstorage@gmail.com',
        seniorViceRector: 'yeongstorage@gmail.com',
        president: 'yeongstorage@gmail.com',
        areaController: 'yeongstorage@gmail.com'
    },
    emailTransport: {
        endpoint: '/api/send-email',
        mode: 'api'
    }
};
