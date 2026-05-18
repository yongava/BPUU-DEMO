window.BPUU_WORKFLOW_TEST_CONFIG = {
    systemEmail: 'dev.codegym@gmail.com',
    primaryApprovalEmail: 'dev.codegym@gmail.com',
    workflowApiEndpoint: `${window.location.origin}/api/workflow-tickets`,
    allowLocalFallback: true,
    requesterEmails: {
        staff: 'n.chotthanin@gmail.com',
        student: 'n.chotthanin@gmail.com',
        external: 'n.chotthanin@gmail.com'
    },
    roleEmails: {
        bpuuHead: 'dev.codegym@gmail.com',
        bpuuStaff: 'bpuu.dev1@kmutt.ac.th',
        bpuuManager: 'bpuu.dev2@kmutt.ac.th',
        financeViceRector: 'yeongstorage@gmail.com',
        seniorViceRector: 'yeongstorage@gmail.com',
        president: 'yeongstorage@gmail.com',
        areaController: 'yeongstorage@gmail.com'
    },
    emailTransport: {
        endpoint: `${window.location.origin}/api/send-email`,
        mode: 'api'
    }
};
