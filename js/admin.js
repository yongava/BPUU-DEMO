const REQUEST_TYPES = {
    overnight: {
        label: 'ขอจอดรถค้างคืน',
        group: 'Parking Services',
        accent: '#FA4616',
        icon: 'bi-moon-stars-fill'
    },
    monthly: {
        label: 'ขอจอดรถรายเดือน',
        group: 'Parking Services',
        accent: '#7B8189',
        icon: 'bi-calendar-check-fill'
    },
    stamp: {
        label: 'ขอใช้ตราประทับ',
        group: 'Document Services',
        accent: '#FFC72C',
        icon: 'bi-postage-fill'
    },
    plate: {
        label: 'เพิ่ม/แก้ไข/ยกเลิกทะเบียน',
        group: 'Parking Services',
        accent: '#0F766E',
        icon: 'bi-car-front-fill'
    },
    temporary: {
        label: 'ขอใช้พื้นที่ชั่วคราว',
        group: 'Area Services',
        accent: '#2563EB',
        icon: 'bi-shop'
    },
    contract: {
        label: 'ขอเข้าพื้นที่คู่สัญญา',
        group: 'Area Services',
        accent: '#16A34A',
        icon: 'bi-file-earmark-person'
    },
    issue: {
        label: 'แจ้งปัญหา',
        group: 'Support',
        accent: '#0EA5E9',
        icon: 'bi-tools'
    },
    invoice: {
        label: 'ใบแจ้งหนี้หลังใช้ตราประทับ',
        group: 'Document Services',
        accent: '#1F2937',
        icon: 'bi-receipt-cutoff'
    }
};

const TYPE_GROUPS = [
    {
        label: 'Parking Services',
        keys: ['overnight', 'monthly', 'plate']
    },
    {
        label: 'Document Services',
        keys: ['stamp', 'invoice']
    },
    {
        label: 'Area Services',
        keys: ['temporary', 'contract']
    },
    {
        label: 'Support',
        keys: ['issue']
    }
];

const WORKFLOW_TEMPLATES = {
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

const BASE_TICKETS = [
    createTicket({
        ticketId: 'REQ-2026-0001',
        typeKey: 'overnight',
        requesterType: 'บุคลากร',
        requesterName: 'สมชาย ใจดี',
        contextLabel: 'หน่วยงาน',
        contextValue: 'ฝ่ายพัฒนาระบบ',
        formName: 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)',
        status: 'รอหัวหน้างานอนุมัติ',
        workflowKey: 'overnightStaff',
        stepIndex: 1,
        submittedAt: '2026-05-08T08:15:00+07:00',
        updatedAt: '2026-05-08T10:20:00+07:00',
        assignee: 'หัวหน้างานฝ่ายพัฒนาระบบ',
        priority: 'สูง',
        routeSummary: 'หัวหน้างาน → BPUU',
        note: 'เอกสารครบ เหลือรอหัวหน้างานกดอนุมัติ'
    }),
    createTicket({
        ticketId: 'REQ-2026-0002',
        typeKey: 'overnight',
        requesterType: 'บุคคลภายนอก',
        requesterName: 'ณัฐชยา พรหมชาติ',
        contextLabel: 'องค์กร',
        contextValue: 'บริษัท เอ็มพลัส เซอร์วิส จำกัด',
        formName: 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)',
        status: 'รอ BPUU พิจารณา',
        workflowKey: 'overnightExternal',
        stepIndex: 1,
        submittedAt: '2026-05-08T09:05:00+07:00',
        updatedAt: '2026-05-08T11:02:00+07:00',
        assignee: 'BPUU Staff',
        priority: 'กลาง',
        routeSummary: 'BPUU ตรวจสอบโดยตรง',
        note: 'ผู้ขอเป็นบุคคลภายนอก จึงเข้าสู่การพิจารณาของ BPUU โดยตรง'
    }),
    createTicket({
        ticketId: 'REQ-2026-0003',
        typeKey: 'monthly',
        requesterType: 'บุคลากร',
        requesterName: 'กิตติพงศ์ เรืองกิจ',
        contextLabel: 'หน่วยงาน',
        contextValue: 'สำนักวิทยบริการ',
        formName: 'แบบฟอร์มขอจอดรถรายเดือน',
        status: 'รอชำระเงิน',
        workflowKey: 'monthlyRegular',
        stepIndex: 4,
        submittedAt: '2026-05-07T15:40:00+07:00',
        updatedAt: '2026-05-08T09:48:00+07:00',
        assignee: 'ผู้ขอ',
        priority: 'สูง',
        routeSummary: 'BPUU → ส่ง QR → รอชำระเงิน',
        note: 'BPUU ส่ง QR และยอดเรียกเก็บแล้ว อยู่ระหว่างรอสลิปโอนเงิน'
    }),
    createTicket({
        ticketId: 'REQ-2026-0004',
        typeKey: 'monthly',
        requesterType: 'คู่สัญญา',
        requesterName: 'อรอนงค์ ศรีวิลัย',
        contextLabel: 'บริษัท',
        contextValue: 'บริษัท บางกอกเทคโซลูชันส์ จำกัด',
        formName: 'แบบฟอร์มขอจอดรถรายเดือน',
        status: 'รอผู้บริหารอนุมัติ',
        workflowKey: 'monthlySpecial',
        stepIndex: 3,
        submittedAt: '2026-05-07T10:25:00+07:00',
        updatedAt: '2026-05-08T12:10:00+07:00',
        assignee: 'รองอธิการบดีฝ่ายการเงินฯ',
        priority: 'สูง',
        routeSummary: 'BPUU → ผู้บริหาร',
        note: 'เป็นกรณีพิเศษ จึงต้องผ่านสายอนุมัติระดับผู้บริหารต่อ'
    }),
    createTicket({
        ticketId: 'REQ-2026-0005',
        typeKey: 'monthly',
        requesterType: 'บุคลากร',
        requesterName: 'วราภรณ์ พัฒนชัย',
        contextLabel: 'หน่วยงาน',
        contextValue: 'คณะวิศวกรรมศาสตร์',
        formName: 'แบบฟอร์มขอจอดรถรายเดือน',
        status: 'ต้องแก้ไขข้อมูล',
        workflowKey: 'monthlyBlocked',
        stepIndex: 2,
        submittedAt: '2026-05-06T13:30:00+07:00',
        updatedAt: '2026-05-08T08:30:00+07:00',
        assignee: 'ผู้ขอ',
        priority: 'กลาง',
        routeSummary: 'BPUU ตีกลับเพื่อแก้ไข',
        note: 'เอกสารแนบไม่ครบ ระบบตีกลับให้แก้ไขก่อนเดินหน้าต่อ'
    }),
    createTicket({
        ticketId: 'REQ-2026-0006',
        typeKey: 'stamp',
        requesterType: 'บุคลากร',
        requesterName: 'พิชามญชุ์ จันทร์เพ็ญ',
        contextLabel: 'ขอในนาม',
        contextValue: 'หน่วยงาน',
        formName: 'แบบฟอร์มขอใช้ตราประทับ',
        status: 'รอหัวหน้างานอนุมัติ',
        workflowKey: 'stampUnit',
        stepIndex: 1,
        submittedAt: '2026-05-08T08:55:00+07:00',
        updatedAt: '2026-05-08T09:35:00+07:00',
        assignee: 'หัวหน้างาน',
        priority: 'สูง',
        routeSummary: 'หัวหน้างาน → BPUU',
        note: 'คำขอในนามหน่วยงาน ต้องผ่านหัวหน้างานก่อน'
    }),
    createTicket({
        ticketId: 'REQ-2026-0007',
        typeKey: 'stamp',
        requesterType: 'นักศึกษา',
        requesterName: 'ธนพล รัตนวงศ์',
        contextLabel: 'ขอในนาม',
        contextValue: 'โครงการ',
        formName: 'แบบฟอร์มขอใช้ตราประทับ',
        status: 'รอรองอธิการบดีฝ่ายการเงิน Approve',
        workflowKey: 'stampProject',
        stepIndex: 3,
        submittedAt: '2026-05-08T09:20:00+07:00',
        updatedAt: '2026-05-08T11:25:00+07:00',
        assignee: 'รองอธิการบดีฝ่ายการเงิน',
        priority: 'สูง',
        routeSummary: 'BPUU → ฝ่ายการเงิน',
        note: 'เป็นคำขอในนามโครงการ จึงถูกส่งต่อเข้าสายอนุมัติทางการเงิน'
    }),
    createTicket({
        ticketId: 'REQ-2026-0008',
        typeKey: 'plate',
        requesterType: 'นักศึกษา',
        requesterName: 'มนัสวี อุดมเดชา',
        contextLabel: 'คณะ / สาขา',
        contextValue: 'คณะเทคโนโลยีสารสนเทศ',
        formName: 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์',
        status: 'ส่งต่อไป IBGM',
        workflowKey: 'plateStudent',
        stepIndex: 2,
        submittedAt: '2026-05-08T07:50:00+07:00',
        updatedAt: '2026-05-08T08:05:00+07:00',
        assignee: 'ระบบ IBGM',
        priority: 'กลาง',
        routeSummary: 'redirect ไป IBGM',
        note: 'กรณีบุคลากรจะถูก redirect ไประบบภายนอก ส่วนตัวอย่างนี้เป็นนักศึกษาจึงยังติดตามในระบบได้'
    }),
    createTicket({
        ticketId: 'REQ-2026-0009',
        typeKey: 'temporary',
        requesterType: 'บุคลากร',
        requesterName: 'พัชรินทร์ แก้วใส',
        contextLabel: 'หน่วยงาน',
        contextValue: 'สำนักงานอธิการบดี',
        formName: 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว',
        status: 'รอรองอธิการบดีฝ่ายการเงิน Approve',
        workflowKey: 'tempInternal',
        stepIndex: 4,
        submittedAt: '2026-05-07T14:10:00+07:00',
        updatedAt: '2026-05-08T10:45:00+07:00',
        assignee: 'รองอธิการบดีฝ่ายการเงิน',
        priority: 'สูง',
        routeSummary: 'หัวหน้างาน → BPUU → การเงิน',
        note: 'คำขอภายในที่มีเงื่อนไขค่าใช้จ่าย จึงอยู่ในขั้นอนุมัติด้านการเงิน'
    }),
    createTicket({
        ticketId: 'REQ-2026-0010',
        typeKey: 'temporary',
        requesterType: 'บุคคลภายนอก',
        requesterName: 'สุวิทย์ คงสุข',
        contextLabel: 'องค์กร',
        contextValue: 'บริษัท บีเคพี โปรดักชัน จำกัด',
        formName: 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว',
        status: 'รอ BPUU พิจารณา',
        workflowKey: 'tempExternal',
        stepIndex: 1,
        submittedAt: '2026-05-08T09:10:00+07:00',
        updatedAt: '2026-05-08T10:02:00+07:00',
        assignee: 'BPUU Staff',
        priority: 'กลาง',
        routeSummary: 'BPUU ตรวจสอบโดยตรง',
        note: 'ผู้ใช้ภายนอกจึงไม่ต้องผ่านหัวหน้างานของมหาวิทยาลัย'
    }),
    createTicket({
        ticketId: 'REQ-2026-0011',
        typeKey: 'contract',
        requesterType: 'คู่สัญญา',
        requesterName: 'ฐิติพร ลิ้มเจริญ',
        contextLabel: 'บริษัท',
        contextValue: 'บริษัท อินไซต์ เมเนจเมนต์ จำกัด',
        formName: 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา',
        status: 'ปิดเรื่องแล้ว',
        workflowKey: 'contractVendor',
        stepIndex: 5,
        submittedAt: '2026-05-06T11:30:00+07:00',
        updatedAt: '2026-05-08T09:15:00+07:00',
        assignee: 'ปิดงาน',
        priority: 'ต่ำ',
        routeSummary: 'BPUU → ผู้ดูแลพื้นที่ → ปิดเรื่อง',
        note: 'ผู้ดูแลพื้นที่ยืนยันวันแล้ว ระบบส่งผลกลับครบถ้วน'
    }),
    createTicket({
        ticketId: 'REQ-2026-0012',
        typeKey: 'issue',
        requesterType: 'บุคลากร',
        requesterName: 'ทิพย์อาภา วงศ์สวัสดิ์',
        contextLabel: 'หน่วยงาน',
        contextValue: 'ศูนย์บริการนักศึกษา',
        formName: 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ',
        status: 'ส่งต่อไป Modlink',
        workflowKey: 'issueInternal',
        stepIndex: 1,
        submittedAt: '2026-05-08T08:40:00+07:00',
        updatedAt: '2026-05-08T08:42:00+07:00',
        assignee: 'ผู้ขอ',
        priority: 'กลาง',
        routeSummary: 'Modlink → BPUU',
        note: 'ผู้ใช้ภายในจะถูกแนะนำให้ส่งเรื่องผ่าน Modlink ก่อน'
    }),
    createTicket({
        ticketId: 'REQ-2026-0013',
        typeKey: 'issue',
        requesterType: 'บุคคลภายนอก',
        requesterName: 'กรกฏ เจริญทรัพย์',
        contextLabel: 'ช่องทางติดต่อ',
        contextValue: 'โทร 081-234-5678',
        formName: 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ',
        status: 'กำลังแก้ไขปัญหา',
        workflowKey: 'issueExternal',
        stepIndex: 2,
        submittedAt: '2026-05-08T09:35:00+07:00',
        updatedAt: '2026-05-08T11:18:00+07:00',
        assignee: 'BPUU Staff',
        priority: 'สูง',
        routeSummary: 'รับเรื่อง → แก้ไขปัญหา',
        note: 'รายการนี้เป็นผู้ใช้ภายนอก จึงรับเรื่องตรง ไม่ต้องผ่าน Modlink'
    }),
    createTicket({
        ticketId: 'REQ-2026-0014',
        typeKey: 'invoice',
        requesterType: 'หน่วยงาน',
        requesterName: 'นฤมล จิตต์มั่น',
        contextLabel: 'หน่วยงาน',
        contextValue: 'คณะศิลปศาสตร์',
        formName: 'กระบวนการส่งใบแจ้งหนี้หลังใช้ตราประทับ',
        status: 'รอรหัสงบประมาณ',
        workflowKey: 'invoiceFollowup',
        stepIndex: 3,
        submittedAt: '2026-05-07T16:05:00+07:00',
        updatedAt: '2026-05-08T12:35:00+07:00',
        assignee: 'หน่วยงาน',
        priority: 'สูง',
        routeSummary: 'ตรวจงบประมาณ → ออกเอกสาร',
        note: 'เอกสารพร้อมแล้ว เหลือรอรหัสงบประมาณจากหน่วยงาน'
    })
];

const STAMP_COLLECTION_STORAGE_KEY = 'bpuu-admin-stamp-collections';
const LEGACY_STAMP_COLLECTION_IDS = new Set([
    'COL-2026-1001',
    'COL-2026-1002',
    'COL-2026-1003',
    'COL-2026-1004',
    'COL-2026-1005',
    'COL-2026-1006'
]);
const STAMP_COLLECTION_WORKFLOW = [
    'แจ้งยอดเรียกเก็บ',
    'รอรับชำระ',
    'รับชำระแล้ว',
    'ออกใบเสร็จ',
    'ปิดรายการ'
];

const PLATE_REGISTRY = window.BPUU_PLATE_REGISTRY || null;

const TICKET_STORAGE_KEY = 'bpuu-workflow-tickets';
const TICKET_STORAGE_PING_KEY = `${TICKET_STORAGE_KEY}-updated-at`;
const LEGACY_TICKET_STORAGE_KEYS = ['bpuu-admin-tickets'];
const EMAIL_EVENT_LABELS = {
    received: 'รับคำขอ',
    'new-submission-approval': 'คำขอใหม่',
    'approval-request': 'ขออนุมัติ',
    'payment-notification': 'แจ้งชำระเงิน',
    completed: 'แจ้งผลอนุมัติ',
    rejected: 'แจ้งผลไม่อนุมัติ',
    'more-info': 'ขอข้อมูลเพิ่มเติม'
};

let ticketData = [];
let stampCollectionData = loadStampCollections();
let plateRegistryData = loadPlateRegistry();
const state = {
    typeKey: 'all',
    status: 'all',
    requesterType: 'all',
    query: '',
    selectedTicketId: '',
    expandedSummaryTicketId: ''
};

const collectionState = {
    status: 'all',
    requesterType: 'all',
    query: '',
    selectedPaymentId: ''
};

const dom = {};

setTimeout(() => {
    void init();
}, 0);

async function init() {
    dom.typeFilters = document.getElementById('typeFilters');
    dom.ticketList = document.getElementById('ticketList');
    dom.detailPanel = document.getElementById('detailPanel');
    dom.statTotal = document.getElementById('statTotal');
    dom.statActive = document.getElementById('statActive');
    dom.statBlocked = document.getElementById('statBlocked');
    dom.statClosed = document.getElementById('statClosed');
    dom.resultCount = document.getElementById('resultCount');
    dom.searchInput = document.getElementById('searchInput');
    dom.statusFilter = document.getElementById('statusFilter');
    dom.requesterFilter = document.getElementById('requesterFilter');
    dom.reloadBtn = document.getElementById('reloadBtn');
    dom.resetFiltersBtn = document.getElementById('resetFiltersBtn');
    dom.paymentStatCards = document.getElementById('paymentStatCards');
    dom.paymentList = document.getElementById('paymentList');
    dom.paymentDetailPanel = document.getElementById('paymentDetailPanel');
    dom.paymentResultCount = document.getElementById('paymentResultCount');
    dom.paymentSearchInput = document.getElementById('paymentSearchInput');
    dom.paymentStatusFilter = document.getElementById('paymentStatusFilter');
    dom.paymentRequesterFilter = document.getElementById('paymentRequesterFilter');
    dom.paymentReloadBtn = document.getElementById('paymentReloadBtn');
    dom.paymentResetFiltersBtn = document.getElementById('paymentResetFiltersBtn');
    dom.registryList = document.getElementById('registryList');
    dom.registryCount = document.getElementById('registryCount');
    dom.registryReloadBtn = document.getElementById('registryReloadBtn');
    dom.registryClearBtn = document.getElementById('registryClearBtn');

    try {
        ticketData = await loadTickets();
    } catch (error) {
        console.error('Failed to load workflow tickets from backend.', error);
        ticketData = [];
    }
    populateFilterOptions();
    bindEvents();
    window.addEventListener('storage', handleWorkflowStorageChange);
    window.addEventListener('storage', handlePlateRegistryStorageChange);
    bindWorkflowBroadcast();
    window.addEventListener('focus', () => {
        void refreshTicketsFromStorage();
    });
    window.addEventListener('pageshow', () => {
        void refreshTicketsFromStorage();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void refreshTicketsFromStorage();
    });
    state.selectedTicketId = new URLSearchParams(window.location.search).get('ticket') || '';
    state.expandedSummaryTicketId = '';
    collectionState.selectedPaymentId = '';
    renderAll();
    setInterval(() => {
        void refreshTicketsFromStorage();
    }, 3000);
}

function createTicket(ticket) {
    return ticket;
}

function createStampCollection(collection) {
    return collection;
}

function getInitialTickets() {
    return [];
}

async function loadTickets() {
    const tickets = await window.BPUU_WORKFLOW_API.listTickets({ force: true });
    return tickets.filter(item => !isSeedTicket(item));
}

function isSeedTicket(ticket) {
    const match = String(ticket?.ticketId || '').match(/^REQ-(\d{4})-(\d{4})$/);
    if (!match) return false;
    return Number(match[2]) <= 14;
}

function bindEvents() {
    dom.searchInput.addEventListener('input', (event) => {
        state.query = event.target.value.trim();
        renderAll();
    });

    dom.statusFilter.addEventListener('change', (event) => {
        state.status = event.target.value;
        renderAll();
    });

    dom.requesterFilter.addEventListener('change', (event) => {
        state.requesterType = event.target.value;
        renderAll();
    });

    dom.reloadBtn.addEventListener('click', () => {
        resetState();
        void refreshTicketsFromStorage();
    });

    dom.resetFiltersBtn.addEventListener('click', () => {
        resetState();
        renderAll();
    });

    dom.paymentSearchInput.addEventListener('input', (event) => {
        collectionState.query = event.target.value.trim();
        renderAll();
    });

    dom.paymentStatusFilter.addEventListener('change', (event) => {
        collectionState.status = event.target.value;
        renderAll();
    });

    dom.paymentRequesterFilter.addEventListener('change', (event) => {
        collectionState.requesterType = event.target.value;
        renderAll();
    });

    dom.paymentReloadBtn.addEventListener('click', () => {
        resetStampCollections();
        resetCollectionState();
        renderAll();
    });

    dom.paymentResetFiltersBtn.addEventListener('click', () => {
        resetCollectionState();
        renderAll();
    });

    dom.registryReloadBtn?.addEventListener('click', () => {
        loadPlateRegistry();
        renderAll();
    });

    dom.registryClearBtn?.addEventListener('click', () => {
        if (!confirm('ต้องการล้างทะเบียนรถทดสอบทั้งหมดหรือไม่?')) return;
        clearPlateRegistry();
        renderAll();
    });
}

function resetState() {
    state.typeKey = 'all';
    state.status = 'all';
    state.requesterType = 'all';
    state.query = '';
    state.selectedTicketId = '';
    resetCollectionState();

    dom.searchInput.value = '';
    dom.statusFilter.value = 'all';
    dom.requesterFilter.value = 'all';
}

function resetCollectionState() {
    collectionState.status = 'all';
    collectionState.requesterType = 'all';
    collectionState.query = '';
    collectionState.selectedPaymentId = '';

    if (dom.paymentSearchInput) dom.paymentSearchInput.value = '';
    if (dom.paymentStatusFilter) dom.paymentStatusFilter.value = 'all';
    if (dom.paymentRequesterFilter) dom.paymentRequesterFilter.value = 'all';
}

function populateFilterOptions() {
    const statuses = uniqueValues(ticketData.map(ticket => ticket.status));
    const requesterTypes = uniqueValues(ticketData.map(ticket => ticket.requesterType));
    const paymentStatuses = uniqueValues(stampCollectionData.map(item => item.status));
    const paymentRequesterTypes = uniqueValues(stampCollectionData.map(item => item.requesterType));

    dom.statusFilter.innerHTML = [
        '<option value="all">ทั้งหมด</option>',
        ...statuses.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
    ].join('');

    dom.requesterFilter.innerHTML = [
        '<option value="all">ทั้งหมด</option>',
        ...requesterTypes.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    ].join('');

    dom.statusFilter.value = state.status;
    dom.requesterFilter.value = state.requesterType;

    if (dom.paymentStatusFilter) {
        dom.paymentStatusFilter.innerHTML = [
            '<option value="all">ทั้งหมด</option>',
            ...paymentStatuses.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
        ].join('');
        dom.paymentStatusFilter.value = collectionState.status;
    }

    if (dom.paymentRequesterFilter) {
        dom.paymentRequesterFilter.innerHTML = [
            '<option value="all">ทั้งหมด</option>',
            ...paymentRequesterTypes.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
        ].join('');
        dom.paymentRequesterFilter.value = collectionState.requesterType;
    }
}

function renderAll() {
    populateFilterOptions();
    const filteredTickets = getFilteredTickets();
    renderTypeFilters();
    renderStats(filteredTickets);
    renderTicketList(filteredTickets);
    renderDetailPanel(filteredTickets);
    renderRegistrySection();
    renderCollectionSection();
}

function renderTypeFilters() {
    const allCount = ticketData.length;
    dom.typeFilters.innerHTML = [
        `<div class="type-group">
            <div class="type-group-title mb-2">ทั้งหมด</div>
            <div class="d-flex flex-wrap gap-2">
                ${renderTypeChip('all', 'ทุกประเภท', allCount)}
            </div>
        </div>`,
        ...TYPE_GROUPS.map(group => `
            <div class="type-group">
                <div class="type-group-title mb-2">${escapeHtml(group.label)}</div>
                <div class="d-flex flex-wrap gap-2">
                    ${group.keys.map(key => {
                        const meta = REQUEST_TYPES[key];
                        const count = ticketData.filter(ticket => ticket.typeKey === key).length;
                        return renderTypeChip(key, meta.label, count, meta.accent, meta.icon);
                    }).join('')}
                </div>
            </div>
        `)
    ].join('');

    dom.typeFilters.querySelectorAll('[data-type-key]').forEach(button => {
        button.addEventListener('click', () => {
            state.typeKey = button.dataset.typeKey;
            renderAll();
        });
    });
}

function renderTypeChip(typeKey, label, count, accent = '#111827', icon = 'bi-layers-fill') {
    const isActive = state.typeKey === typeKey;
    const style = isActive
        ? `style="background: linear-gradient(135deg, ${accent}, rgba(15, 23, 42, 0.92)); box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14);"`
        : `style="border-left: 4px solid ${accent};"`;

    return `
        <button type="button" class="type-chip${isActive ? ' active' : ''}" data-type-key="${escapeHtml(typeKey)}" ${style}>
            <span class="d-inline-flex align-items-center gap-2">
                <i class="bi ${icon}"></i>
                <span>${escapeHtml(label)}</span>
            </span>
            <span class="chip-count">${count}</span>
        </button>
    `;
}

function renderStats(filteredTickets) {
    const activeCount = filteredTickets.filter(ticket => getStatusCategory(ticket.status) === 'active').length;
    const blockedCount = filteredTickets.filter(ticket => getStatusCategory(ticket.status) === 'blocked').length;
    const closedCount = filteredTickets.filter(ticket => getStatusCategory(ticket.status) === 'closed').length;

    dom.statTotal.textContent = filteredTickets.length;
    dom.statActive.textContent = activeCount;
    dom.statBlocked.textContent = blockedCount;
    dom.statClosed.textContent = closedCount;
    dom.resultCount.textContent = `${filteredTickets.length} รายการ`;
}

function renderTicketList(filteredTickets) {
    if (!filteredTickets.length) {
        dom.ticketList.innerHTML = `
            <div class="detail-empty text-center">
                <div class="empty-state-icon">
                    <i class="bi bi-search"></i>
                </div>
                <h3 class="h5 fw-bold text-dark mb-2">ไม่พบรายการที่ตรงกับตัวกรอง</h3>
                <p class="mb-0">
                    ลองล้างตัวกรองหรือเปลี่ยนประเภทคำขอ เพื่อดู ticket ที่เกี่ยวข้องอีกครั้ง
                </p>
            </div>
        `;
        state.selectedTicketId = '';
        return;
    }

    if (!filteredTickets.some(ticket => ticket.ticketId === state.selectedTicketId)) {
        state.selectedTicketId = filteredTickets[0].ticketId;
    }

    dom.ticketList.innerHTML = filteredTickets.map(ticket => renderTicketCard(ticket, ticket.ticketId === state.selectedTicketId)).join('');

    dom.ticketList.querySelectorAll('[data-ticket-id]').forEach(card => {
        card.addEventListener('click', () => {
            state.selectedTicketId = card.dataset.ticketId;
            renderAll();
        });
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                state.selectedTicketId = card.dataset.ticketId;
                renderAll();
            }
        });
    });

    dom.ticketList.querySelectorAll('[data-attachment-open]').forEach(button => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            openAttachmentFromButton(button);
        });
    });

    dom.ticketList.querySelectorAll('[data-summary-open]').forEach(button => {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleTicketSummaryFromButton(button);
        });
    });
}

function renderTicketCard(ticket, isActive) {
    const meta = REQUEST_TYPES[ticket.typeKey];
    const template = getWorkflowTemplate(ticket);
    const currentStep = getCurrentStep(ticket);
    const progress = getProgress(ticket);
    const statusTone = getStatusTone(ticket.status);
    const remaining = Math.max(template.length - ticket.stepIndex - 1, 0);
    const preview = getTicketCardPreview(ticket);
    const summaryNote = ticket.summaryText ? 'สรุปจากหน้าตรวจสอบก่อนยืนยัน' : 'สรุปจากข้อมูลคำขอที่บันทึกไว้';
    const isSummaryExpanded = state.expandedSummaryTicketId === ticket.ticketId;
    const summaryToggleLabel = isSummaryExpanded ? 'ย่อสรุป' : 'เปิดสรุปเต็ม';
    const summaryBodyClass = isSummaryExpanded ? 'ticket-preview-summary-body is-expanded' : 'ticket-preview-summary-body is-collapsed';
    const summaryShellClass = isSummaryExpanded ? 'ticket-preview-summary-shell is-expanded' : 'ticket-preview-summary-shell';
    const summaryBodyHtml = isSummaryExpanded ? preview.summaryHtml : buildCollapsedSummaryHtml(ticket);

    return `
        <div class="ticket-card${isActive ? ' active' : ''}" data-ticket-id="${escapeHtml(ticket.ticketId)}" role="button" tabindex="0" style="--card-accent:${meta.accent};">
            <div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
                <div class="flex-grow-1">
                    <div class="ticket-id mb-1">${escapeHtml(ticket.ticketId)}</div>
                    <div class="ticket-title mb-1">
                        <i class="bi ${meta.icon} me-2" style="color:${meta.accent};"></i>${escapeHtml(meta.label)}
                    </div>
                    <div class="ticket-meta">
                        ${escapeHtml(ticket.requesterType)} · ${escapeHtml(ticket.requesterName)}
                    </div>
                    <div class="d-flex flex-wrap gap-2 mt-3">
                        <span class="meta-pill"><i class="bi bi-signpost-2-fill"></i>${escapeHtml(ticket.routeSummary)}</span>
                        <span class="meta-pill"><i class="bi bi-arrow-repeat"></i>${escapeHtml(currentStep)}</span>
                        <span class="meta-pill"><i class="bi bi-hourglass-split"></i>เหลืออีก ${remaining} ขั้น</span>
                    </div>
                    <div class="ticket-preview mt-3">
                        <div class="ticket-preview-head d-flex flex-wrap justify-content-between align-items-start gap-2">
                            <div>
                                <div class="ticket-preview-kicker">Quick Preview</div>
                                <div class="ticket-preview-summary">${escapeHtml(ticket.formName || preview.headline)}</div>
                                <div class="ticket-preview-note">${escapeHtml(summaryNote)}</div>
                            </div>
                            <button
                                type="button"
                                class="ticket-summary-open-btn"
                                data-summary-open="${escapeHtml(ticket.ticketId)}"
                            >
                                <i class="bi bi-arrows-fullscreen me-1"></i>${escapeHtml(summaryToggleLabel)}
                            </button>
                        </div>
                        <div class="${summaryShellClass}">
                            <div class="${summaryBodyClass}">
                                ${summaryBodyHtml}
                            </div>
                        </div>
                        ${preview.attachmentEntries.length ? `
                            <div class="ticket-preview-footer">
                                <span class="ticket-preview-badge">${escapeHtml(preview.attachmentLabel)}</span>
                                ${preview.attachmentEntries.map((entry, index) => `
                                    <button
                                        type="button"
                                        class="ticket-attachment-btn${entry.dataUrl ? '' : ' is-disabled'}"
                                        data-attachment-open="${index}"
                                        ${entry.dataUrl ? '' : 'aria-disabled="true"'}
                                    >
                                        <i class="bi bi-paperclip me-1"></i>${escapeHtml(truncateText(entry.name, 18))}
                                    </button>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                </div>
                <div class="text-end">
                    <span class="status-badge status-${statusTone} mb-2">
                        <i class="bi ${getStatusIcon(ticket.status)}"></i>
                        ${escapeHtml(ticket.status)}
                    </span>
                    <div class="ticket-meta small">${formatDateTime(ticket.updatedAt)}</div>
                </div>
            </div>
            <div class="detail-progress mt-3 mb-0">
                <div class="progress">
                    <div class="progress-bar" style="width:${progress}%"></div>
                </div>
            </div>
        </div>
    `;
}

function renderDetailPanel(filteredTickets) {
    const selected = filteredTickets.find(ticket => ticket.ticketId === state.selectedTicketId) || filteredTickets[0];

    if (!selected) {
        dom.detailPanel.innerHTML = `
            <div class="detail-empty text-center">
                <div class="empty-state-icon">
                    <i class="bi bi-inbox-fill"></i>
                </div>
                <h3 class="h5 fw-bold text-dark mb-2">ยังไม่มี ticket ให้แสดง</h3>
                <p class="mb-0">
                    ระบบจะโชว์รายละเอียดเมื่อมีรายการคำขอเข้ามา หรือเมื่อเลือกตัวกรองที่ยังมีผลลัพธ์อยู่
                </p>
            </div>
        `;
        return;
    }

    state.selectedTicketId = selected.ticketId;

    const template = getWorkflowTemplate(selected);
    const currentStep = getCurrentStep(selected);
    const progress = getProgress(selected);
    const timeline = buildTimeline(selected, template);
    const isOvernightTicket = isOvernightWorkflowTicket(selected);
    const paymentResponseUrl = selected.paymentResponseUrl || `${window.location.origin}/payment-response.html?ticket=${encodeURIComponent(selected.ticketId)}`;
    const isSpecialPaymentStage = isOvernightTicket && (/BPUU Staff แจ้งยอด/i.test(currentStep) || /ตรวจสลิป/i.test(currentStep) || /รอตรวจสลิป/i.test(String(selected.status || '')));
    const paymentSection = isOvernightTicket && /BPUU Staff แจ้งยอด/i.test(currentStep)
        ? `
            <div class="border rounded-4 p-3 bg-white mt-3">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                    <div>
                        <div class="fw-bold text-ci-bluegrey">แจ้งยอดชำระเงิน</div>
                        <div class="small text-muted">แนบ QR Code และระบุยอดเงิน จากนั้นระบบจะส่งอีเมลกลับหาผู้ขอทันที</div>
                    </div>
                    <span class="badge rounded-pill bg-light text-dark border fw-bold">BPUU Staff</span>
                </div>
                <div class="row g-3">
                    <div class="col-12 col-md-4">
                        <label class="form-label small fw-bold text-ci-bluegrey" for="overnightPaymentAmount">จำนวนเงิน (บาท)</label>
                        <input type="number" min="0" step="0.01" class="form-control" id="overnightPaymentAmount" value="${escapeAttribute(selected.paymentAmount || '')}" placeholder="เช่น 120.00">
                    </div>
                    <div class="col-12 col-md-8">
                        <label class="form-label small fw-bold text-ci-bluegrey" for="overnightPaymentQr">ไฟล์ QR Code</label>
                        <input type="file" class="form-control" id="overnightPaymentQr" accept="image/*,.pdf">
                    </div>
                    <div class="col-12">
                        <label class="form-label small fw-bold text-ci-bluegrey" for="overnightPaymentNote">ข้อความประกอบอีเมล</label>
                        <textarea class="form-control" id="overnightPaymentNote" rows="3" placeholder="พิมพ์รายละเอียดหรือหมายเหตุที่ต้องการแจ้งผู้ขอ">${escapeHtml(selected.paymentNotificationNote || selected.note || '')}</textarea>
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-2 mt-3">
                    <button type="button" class="btn btn-ci-orange fw-bold" data-ticket-action="send-payment">
                        <i class="bi bi-send-fill me-1"></i>ส่งอีเมลแจ้งยอด
                    </button>
                    <a class="btn btn-outline-secondary fw-bold" href="${escapeAttribute(paymentResponseUrl)}" target="_blank" rel="noopener noreferrer">
                        <i class="bi bi-box-arrow-up-right me-1"></i>เปิดหน้ารับสลิป
                    </a>
                </div>
            </div>
        `
        : '';
    const slipInfoHtml = selected.paymentSlipInfo ? `
        <div class="border rounded-4 p-3 bg-white mt-3">
            <div class="fw-bold text-ci-bluegrey mb-2">ข้อมูลการส่งสลิปจากผู้ขอ</div>
            <div class="small text-muted mb-2">${selected.paymentSlipSubmittedAt ? `ส่งเมื่อ ${escapeHtml(formatThaiDateTime(selected.paymentSlipSubmittedAt))}` : 'รอข้อมูลจากผู้ขอ'}</div>
            <div class="row g-2 small">
                <div class="col-12 col-md-6"><span class="fw-bold">เลขประจำตัวผู้เสียภาษี:</span> ${escapeOrDash(selected.paymentSlipInfo.taxId)}</div>
                <div class="col-12 col-md-6"><span class="fw-bold">ชื่อ:</span> ${escapeOrDash(selected.paymentSlipInfo.name)}</div>
                <div class="col-12"><span class="fw-bold">ที่อยู่:</span> ${escapeOrDash(selected.paymentSlipInfo.address)}</div>
                <div class="col-12 col-md-6"><span class="fw-bold">เบอร์โทร:</span> ${escapeOrDash(selected.paymentSlipInfo.phone)}</div>
                <div class="col-12 col-md-6"><span class="fw-bold">หมายเหตุ:</span> ${escapeOrDash(selected.paymentSlipInfo.note)}</div>
            </div>
            ${selected.paymentSlipAttachment?.dataUrl ? `
                <div class="mt-3">
                    <a class="btn btn-outline-primary btn-sm fw-bold" href="${escapeAttribute(selected.paymentSlipAttachment.dataUrl)}" target="_blank" rel="noopener noreferrer">
                        <i class="bi bi-paperclip me-1"></i>เปิดสลิปที่แนบ
                    </a>
                </div>
            ` : ''}
        </div>
    ` : '';
    const receiptSection = isOvernightTicket && (/ตรวจสลิป/i.test(currentStep) || /รอตรวจสลิป/i.test(String(selected.status || '')))
        ? `
            <div class="border rounded-4 p-3 bg-white mt-3">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                    <div>
                        <div class="fw-bold text-ci-bluegrey">ออกใบเสร็จและปิดงาน</div>
                        <div class="small text-muted">กรอกเลขที่ใบเสร็จ วันที่ และแนบไฟล์ใบเสร็จเพื่อส่งกลับหาผู้ขอ</div>
                    </div>
                    <span class="badge rounded-pill bg-light text-dark border fw-bold">BPUU Receipt</span>
                </div>
                ${slipInfoHtml}
                <div class="row g-3 mt-1">
                    <div class="col-12 col-md-6">
                        <label class="form-label small fw-bold text-ci-bluegrey" for="overnightReceiptNo">เลขที่ใบเสร็จ</label>
                        <input type="text" class="form-control" id="overnightReceiptNo" value="${escapeAttribute(selected.receiptNo || '')}" placeholder="เช่น RCP-2026-001">
                    </div>
                    <div class="col-12 col-md-6">
                        <label class="form-label small fw-bold text-ci-bluegrey" for="overnightReceiptDate">วันที่ใบเสร็จ</label>
                        <input type="date" class="form-control" id="overnightReceiptDate" value="${escapeAttribute(selected.receiptDate || '')}">
                    </div>
                    <div class="col-12">
                        <label class="form-label small fw-bold text-ci-bluegrey" for="overnightReceiptFile">ไฟล์ใบเสร็จ</label>
                        <input type="file" class="form-control" id="overnightReceiptFile" accept="image/*,.pdf">
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-2 mt-3">
                    <button type="button" class="btn btn-success fw-bold" data-ticket-action="complete-receipt">
                        <i class="bi bi-receipt-cutoff me-1"></i>ส่งใบเสร็จและปิดงาน
                    </button>
                </div>
            </div>
        `
        : '';
    const hideGenericEmail = isSpecialPaymentStage;
    const emailControls = hideGenericEmail
        ? ''
        : `
            <button type="button" class="btn btn-ci-orange fw-bold" data-ticket-action="email">
                <i class="bi bi-envelope-paper-fill me-1"></i>ส่งอีเมลขั้นตอนนี้
            </button>
        `;
    const genericWorkflowButtons = isSpecialPaymentStage
        ? `
            <button type="button" class="btn btn-outline-warning fw-bold" data-ticket-action="return">
                <i class="bi bi-arrow-counterclockwise me-1"></i>ตีกลับแก้ไข
            </button>
        `
        : `
            ${emailControls}
            <button type="button" class="btn btn-success fw-bold" data-ticket-action="advance">
                <i class="bi bi-check2-circle me-1"></i>อนุมัติ / ส่งต่อขั้นถัดไป
            </button>
            <button type="button" class="btn btn-outline-warning fw-bold" data-ticket-action="return">
                <i class="bi bi-arrow-counterclockwise me-1"></i>ตีกลับแก้ไข
            </button>
            <button type="button" class="btn btn-outline-dark fw-bold" data-ticket-action="close">
                <i class="bi bi-check2-all me-1"></i>ปิดเรื่อง
            </button>
        `;
    const emailLog = renderEmailEventLog(selected);

    dom.detailPanel.innerHTML = `
        <div class="detail-head">
            <span class="detail-id">${escapeHtml(selected.ticketId)}</span>
            <div class="detail-subtitle">${escapeHtml(selected.formName)} · ${escapeHtml(selected.status)}</div>
        </div>

        <div class="detail-progress">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="small fw-bold text-ci-bluegrey">Workflow step</span>
                <span class="small fw-bold text-ci-orange">${escapeHtml(currentStep)}</span>
            </div>
            <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="small fw-bold text-ci-bluegrey">Progress</span>
                <span class="small fw-bold text-ci-orange">${progress}%</span>
            </div>
            <div class="progress">
                <div class="progress-bar" role="progressbar" style="width:${progress}%"></div>
            </div>
        </div>

        <div class="workflow-track">
            ${timeline}
        </div>

        ${paymentSection}
        ${receiptSection}

        <div class="d-flex flex-wrap gap-2 mt-3">
            ${genericWorkflowButtons}
        </div>

        ${emailLog}
    `;

    bindTicketDetailActions(selected.ticketId);
}

function buildTimeline(ticket, template) {
    return template.map((step, index) => {
        const stateClass = index < ticket.stepIndex ? 'done' : index === ticket.stepIndex ? 'current' : 'pending';
        const subtitle = index < ticket.stepIndex
            ? 'ดำเนินการเสร็จแล้ว'
            : index === ticket.stepIndex
                ? 'กำลังอยู่ขั้นตอนนี้'
                : 'รอดำเนินการ';
        const email = getWorkflowStepEmail(ticket, step);
        const titleHtml = email
            ? `${escapeHtml(step)} <span class="step-email">(${escapeHtml(email)})</span>`
            : escapeHtml(step);

        return `
            <div class="workflow-step ${stateClass}">
                <div class="step-title">${titleHtml}</div>
                <div class="step-subtitle">${subtitle}</div>
            </div>
        `;
    }).join('');
}

function getWorkflowStepEmail(ticket, step) {
    const roleEmails = window.BPUU_WORKFLOW_TEST_CONFIG?.roleEmails || {};
    const requesterEmail = ticket.requesterEmail
        || ticket.emailDetails?.requesterSubmittedEmail
        || ticket.requester?.submittedEmail
        || ticket.requester?.email
        || ticket.submissionFields?.q20_input20
        || '';
    const approverEmail = ticket.approverEmail
        || ticket.emailDetails?.approverSubmittedEmail
        || ticket.submissionFields?.q30_input30
        || '';
    const normalizedStep = String(step || '').toLowerCase();

    if (/รับคำขอ|ส่งต่อไป ibgm|ปิดเรื่อง|ปิดรายการ/i.test(step)) return '';
    if (/แจ้งผลกลับผู้ขอ|แจ้งผลผู้ยื่นคำขอ|รอข้อมูลจากผู้ขอ|รอหน่วยงานตอบกลับ|ส่ง qr code|แจ้งยอด|รอชำระเงิน|ตรวจสลิป|ออกใบเสร็จ|ส่งคู่มือ|สรุปผล|ส่ง voucher|แนะนำช่องทาง/i.test(normalizedStep)) {
        return requesterEmail;
    }
    if (/อธิการบดี/i.test(step) && !/รองอธิการบดี/i.test(step)) return roleEmails.president || roleEmails.financeViceRector || approverEmail;
    if (/รองอธิการบดีอาวุโส/i.test(step)) return roleEmails.seniorViceRector || roleEmails.financeViceRector || approverEmail;
    if (/รองอธิการบดีฝ่ายการเงิน|การเงิน/i.test(step)) return roleEmails.financeViceRector || approverEmail;
    if (/ผู้คุมพื้นที่|ผู้ดูแลพื้นที่/i.test(step)) return roleEmails.areaController || approverEmail;
    if (/หัวหน้างาน|หัวหน้าฝ่าย/i.test(step)) return roleEmails.bpuuHead || approverEmail;
    if (/manager/i.test(step)) return roleEmails.bpuuManager || roleEmails.bpuuStaff || approverEmail;
    if (/bpuu/i.test(step) || /พิจารณา|ตรวจสอบ|อนุมัติ|รับเรื่อง|แก้ไขปัญหา|อัปเดตฐานข้อมูล|บันทึกบัญชี|ออกใบแจ้งหนี้|ตรวจสลิป|แจ้งยอด|ออกใบเสร็จ/i.test(normalizedStep)) {
        return roleEmails.bpuuStaff || approverEmail;
    }
    return '';
}

function buildWorkflowEmail(ticket, eventType = 'approval-request') {
    const step = getCurrentStep(ticket);
    const recipient = eventType === 'approval-request' || eventType === 'payment-notification'
        ? getWorkflowStepEmail(ticket, step)
        : getRequesterEmail(ticket);
    const requesterName = ticket.requesterName || ticket.requester?.requesterName || '-';
    const serviceType = ticket.formName || REQUEST_TYPES[ticket.typeKey]?.label || 'คำขอใช้บริการ';
    const details = ticket.summaryText || ticket.note || '-';
    const adminLink = getTicketAdminLink(ticket);

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
                `- วันที่ส่งเรื่อง: ${formatDateTime(ticket.submittedAt || new Date().toISOString())}`,
                `- สถานะปัจจุบัน: ${ticket.status || 'รอการตรวจสอบ'}`,
                '',
                'เจ้าหน้าที่จะดำเนินการตรวจสอบข้อมูลและแจ้งผลการพิจารณาให้ท่านทราบผ่านทางอีเมลนี้',
                '',
                'ขอแสดงความนับถือ',
                'กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)'
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
                `สถานะปัจจุบัน: ${ticket.status}`,
                `ขั้นตอนปัจจุบัน: ${step || '-'}`,
                `ยอดชำระ: ${formatCurrency(ticket.paymentAmount || 0)}`,
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
                'กรุณาตรวจสอบรายละเอียดและดำเนินการตามที่แจ้งในอีเมลฉบับนี้',
                '',
                'ขอแสดงความนับถือ',
                'กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน (BPUU)'
            ].join('\n')
        };
    }

    if (eventType === 'completed') {
        const receiptAttachment = ticket.receiptAttachment ? [{
            filename: ticket.receiptAttachment.name || 'receipt.pdf',
            content: ticket.receiptAttachment.dataUrl || '',
            contentType: ticket.receiptAttachment.type || 'application/pdf'
        }] : [];
        return {
            to: recipient,
            subject: `[Completed] แจ้งผลการอนุมัติคำขอ ${serviceType} (Ref: ${ticket.ticketId})`,
            body: [
                `เรียน คุณ ${requesterName}`,
                '',
                `กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน ขอแจ้งให้ทราบว่าคำขอ "${serviceType}" เสร็จสิ้นเรียบร้อยแล้ว`,
                '',
                `หมายเลขคำขอ: ${ticket.ticketId}`,
                `สถานะปัจจุบัน: ${ticket.status}`,
                `เหตุผลประกอบการพิจารณา: ${ticket.note || 'อนุมัติและดำเนินการเรียบร้อยแล้ว'}`,
                '',
                'แนบใบเสร็จและเอกสารที่เกี่ยวข้องมาในอีเมลฉบับนี้',
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
            'หมายเหตุ: ในช่วงทดสอบ ระบบจะเปิดอีเมลฉบับนี้ผ่าน mail client เพื่อให้ตรวจสอบเนื้อหาและส่งจริงได้'
        ].join('\n')
    };
}

function getRequesterEmail(ticket) {
    return ticket.requesterEmail
        || ticket.emailDetails?.requesterSubmittedEmail
        || ticket.requester?.submittedEmail
        || ticket.requester?.email
        || ticket.submissionFields?.q20_input20
        || '';
}

function getTicketAdminLink(ticket) {
    const url = new URL('approve.html', window.location.href);
    url.searchParams.set('ticket', ticket.ticketId);
    return url.toString();
}

function getEmailEventTypeForStep(ticket, step) {
    const value = String(step || '').toLowerCase();
    if (/ปิดเรื่อง|ปิดรายการ|รับคำขอ|รับเรื่อง|ส่งต่อไป ibgm/i.test(value)) return '';
    if (/ตีกลับ|แก้ไขเอกสาร|รอข้อมูลจากผู้ขอ|รอหน่วยงานตอบกลับ/i.test(value)) return 'more-info';
    if (/ส่ง qr code|แจ้งยอด|รอชำระเงิน/i.test(value)) return 'payment-notification';
    if (/แจ้งผลกลับผู้ขอ|แจ้งผลผู้ยื่นคำขอ|ส่งคู่มือ|สรุปผล|ส่ง voucher|แนะนำช่องทาง/i.test(value)) return 'completed';
    return 'approval-request';
}

function shouldSendWorkflowEmail(ticket) {
    return getWorkflowTemplate(ticket).length > 0;
}

function getEmailTransportEndpoint() {
    return String(window.BPUU_WORKFLOW_TEST_CONFIG?.emailTransport?.endpoint || '/api/send-email').trim();
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
                from: window.BPUU_WORKFLOW_TEST_CONFIG?.systemEmail || '',
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

function isOvernightWorkflowTicket(ticket) {
    return /^overnight/i.test(String(ticket?.workflowKey || ''));
}

function readAdminFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function escapeOrDash(value) {
    return escapeHtml(String(value || '-'));
}

async function sendWorkflowEmailForTicket(ticket, eventType) {
    if (!shouldSendWorkflowEmail(ticket)) return false;
    const email = buildWorkflowEmail(ticket, eventType);
    const result = await sendWorkflowEmailViaApi(email, ticket, eventType);
    addWorkflowEmailEvent(ticket, email, eventType, result.status, result.error || '');
    return result.ok;
}

function getWorkflowTemplate(ticket) {
    return WORKFLOW_TEMPLATES[ticket.workflowKey] || [];
}

function getCurrentStep(ticket) {
    const steps = getWorkflowTemplate(ticket);
    if (!steps.length) return '-';
    const safeIndex = Math.max(0, Math.min(ticket.stepIndex, steps.length - 1));
    return steps[safeIndex];
}

function getProgress(ticket) {
    const steps = getWorkflowTemplate(ticket);
    if (!steps.length) return 0;
    const completed = Math.max(1, Math.min(ticket.stepIndex + 1, steps.length));
    return Math.round((completed / steps.length) * 100);
}

function getFilteredTickets() {
    const query = state.query.toLowerCase();

    return [...ticketData]
        .filter(ticket => {
            const typeMatch = state.typeKey === 'all' || ticket.typeKey === state.typeKey;
            const statusMatch = state.status === 'all' || ticket.status === state.status;
            const requesterMatch = state.requesterType === 'all' || ticket.requesterType === state.requesterType;
            const searchTarget = [
                ticket.ticketId,
                ticket.requesterName,
                ticket.requesterType,
                ticket.contextLabel,
                ticket.contextValue,
                ticket.formName,
                ticket.status,
                ticket.routeSummary,
                ticket.note,
                REQUEST_TYPES[ticket.typeKey]?.label || ''
            ].join(' ').toLowerCase();
            const queryMatch = !query || searchTarget.includes(query);

            return typeMatch && statusMatch && requesterMatch && queryMatch;
        })
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getStatusCategory(status) {
    const value = (status || '').toLowerCase();
    if (value.includes('ปิด') || value.includes('เสร็จ') || value.includes('สำเร็จ')) return 'closed';
    if (value.includes('ส่งต่อ')) return 'redirected';
    if (value.includes('แก้ไข') || value.includes('ไม่ผ่าน') || value.includes('ตีกลับ') || value.includes('ปัญหา')) return 'blocked';
    if (value.includes('รอ') || value.includes('กำลัง') || value.includes('ตรวจ') || value.includes('อนุมัติ') || value.includes('พิจารณา')) return 'active';
    return 'other';
}

function getStatusTone(status) {
    const category = getStatusCategory(status);
    if (category === 'closed') return 'success';
    if (category === 'blocked') return 'danger';
    if (category === 'redirected') return 'neutral';
    return 'warning';
}

function getStatusIcon(status) {
    const category = getStatusCategory(status);
    if (category === 'closed') return 'bi-check-circle-fill';
    if (category === 'blocked') return 'bi-exclamation-triangle-fill';
    if (category === 'redirected') return 'bi-box-arrow-up-right';
    return 'bi-hourglass-split';
}

function bindTicketDetailActions(ticketId) {
    const detailPanel = dom.detailPanel;
    if (!detailPanel) return;

    detailPanel.querySelectorAll('[data-ticket-action]').forEach(button => {
        button.addEventListener('click', async () => {
            const buttons = [...detailPanel.querySelectorAll('[data-ticket-action]')];
            buttons.forEach(item => { item.disabled = true; });
            await handleTicketAction(button.dataset.ticketAction, ticketId);
        });
    });
}

function renderEmailEventLog(ticket) {
    const events = Array.isArray(ticket.emailEvents) ? ticket.emailEvents.slice(0, 5) : [];
    if (!events.length) {
        return `
            <div class="email-log empty mt-3">
                <div class="email-log-title"><i class="bi bi-envelope me-1"></i>Email activity</div>
                <div class="email-log-empty">ยังไม่มีประวัติการส่งอีเมลสำหรับ ticket นี้</div>
            </div>
        `;
    }

    return `
        <div class="email-log mt-3">
            <div class="email-log-title"><i class="bi bi-envelope-check-fill me-1"></i>Email activity</div>
            ${events.map(event => `
                <div class="email-log-item">
                    <div class="email-log-main">
                        <span>${escapeHtml(EMAIL_EVENT_LABELS[event.eventType] || event.eventType || 'อีเมล')}</span>
                        <span class="email-log-status">${escapeHtml(event.status || '-')}</span>
                    </div>
                    <div class="email-log-subject">${escapeHtml(event.subject || '-')}</div>
                    <div class="email-log-meta">${escapeHtml(event.to || '-')} · ${escapeHtml(formatDateTime(event.createdAt))}</div>
                    ${event.errorMessage ? `<div class="email-log-error">${escapeHtml(event.errorMessage)}</div>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function getPlainSummaryText(ticket) {
    const raw = ticket.summaryText || '';
    if (!raw) return '-';
    const container = document.createElement('div');
    container.innerHTML = raw;
    const text = (container.textContent || container.innerText || '').trim();
    return text || '-';
}

function getTicketCardPreview(ticket) {
    return {
        summaryHtml: ticket.summaryHtml?.trim()
            || ticket.summaryText?.trim()
            || buildTicketSummaryFallbackHtml(ticket),
        attachmentEntries: getAttachmentEntries(ticket),
        attachmentLabel: getAttachmentLabel(ticket)
    };
}

function getAttachmentLabel(ticket) {
    const files = Array.isArray(ticket.selectedFiles) ? ticket.selectedFiles.filter(Boolean) : [];
    if (!files.length) return '';
    return files.length === 1 ? `ไฟล์แนบ 1 รายการ` : `ไฟล์แนบ ${files.length} รายการ`;
}

function getAttachmentEntries(ticket) {
    if (Array.isArray(ticket.selectedAttachments) && ticket.selectedAttachments.length) {
        return ticket.selectedAttachments.map(item => ({
            name: item.name || 'ไฟล์แนบ',
            dataUrl: item.dataUrl || '',
            type: item.type || ''
        }));
    }

    const files = Array.isArray(ticket.selectedFiles) ? ticket.selectedFiles.filter(Boolean) : [];
    return files.map(name => ({ name, dataUrl: '', type: '' }));
}

function openAttachmentFromButton(button) {
    const card = button.closest('[data-ticket-id]');
    if (!card) return;
    const ticket = ticketData.find(item => item.ticketId === card.dataset.ticketId);
    if (!ticket) return;

    const entries = getAttachmentEntries(ticket);
    const index = Number(button.dataset.attachmentOpen || 0);
    const entry = entries[index];
    if (!entry) return;

    if (!entry.dataUrl) {
        alert('รายการนี้มีแค่ชื่อไฟล์ในระบบทดสอบ ยังไม่มีข้อมูลไฟล์จริงให้เปิด');
        return;
    }

    const opened = window.open(entry.dataUrl, '_blank', 'noopener,noreferrer');
    if (!opened) {
        alert('เบราว์เซอร์บล็อกการเปิดไฟล์แนบ กรุณาอนุญาต popup แล้วลองอีกครั้ง');
    }
}

function toggleTicketSummaryFromButton(button) {
    const ticketId = button.dataset.summaryOpen || '';
    if (!ticketId) return;
    toggleTicketSummary(ticketId);
}

function toggleTicketSummary(ticketId) {
    state.expandedSummaryTicketId = state.expandedSummaryTicketId === ticketId ? '' : ticketId;
    renderAll();
}

function truncateText(text, maxLength) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= maxLength) return clean;
    return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildTicketSummaryFallbackHtml(ticket) {
    if (ticket.summaryText?.trim()) {
        return `
            <div class="ticket-summary-fallback-text">${escapeHtml(ticket.summaryText).replace(/\n/g, '<br>')}</div>
        `;
    }

    const requesterEmail = ticket.emailDetails?.requesterSubmittedEmail
        || ticket.requesterEmail
        || ticket.requester?.submittedEmail
        || ticket.requester?.email
        || ticket.submissionFields?.q20_input20
        || '-';
    const approverEmail = ticket.emailDetails?.approverSubmittedEmail
        || ticket.approverSubmittedEmail
        || ticket.approverEmail
        || ticket.submissionFields?.q30_input30
        || '-';
    const sections = [
        {
            title: 'ข้อมูลผู้ติดต่อ',
            rows: [
                ['ประเภท', ticket.requesterType || '-'],
                ['ชื่อ-สกุล', ticket.requesterName || '-'],
                [ticket.contextLabel || 'รายละเอียด', ticket.contextValue || '-'],
                ['อีเมลผู้ขอ', requesterEmail]
            ]
        },
        {
            title: 'รายละเอียดคำขอ',
            rows: [
                ['แบบฟอร์ม', ticket.formName || '-'],
                ['สถานะ', ticket.status || '-'],
                ['ผู้รับผิดชอบ', ticket.assignee || '-'],
                ['หมายเหตุ', ticket.note || '-']
            ]
        }
    ];

    if (approverEmail && approverEmail !== '-') {
        sections.push({
            title: 'ผู้มีอำนาจอนุมัติ',
            rows: [['อีเมลผู้อนุมัติ', approverEmail]]
        });
    }

    return sections.map(section => `
        <h6 class="fw-bold text-ci-orange border-bottom border-ci-orange pb-2 mt-2">${escapeHtml(section.title)}</h6>
        <ul class="list-group list-group-flush small mb-3">
            ${section.rows.map(([label, value]) => `
                <li class="list-group-item d-flex justify-content-between align-items-start px-0 bg-transparent border-light">
                    <div class="ms-2 me-auto">
                        <div class="fw-bold text-ci-bluegrey" style="font-size:0.75rem;">${escapeHtml(label)}</div>
                        <span class="text-dark fw-bold" style="white-space: pre-line;">${escapeHtml(value)}</span>
                    </div>
                </li>
            `).join('')}
        </ul>
    `).join('');
}

function buildCollapsedSummaryHtml(ticket) {
    const fallbackHeadline = ticket.formName || ticket.requesterName || 'รายละเอียดคำขอ';
    const summaryLine = ticket.summaryText?.trim()
        ? ticket.summaryText.trim()
        : 'แตะปุ่มเพื่อดูสรุปรายละเอียดฉบับเต็ม';
    return `
        <div class="ticket-preview-collapsed-summary">
            <div class="ticket-preview-collapsed-title">${escapeHtml(fallbackHeadline)}</div>
            <div class="ticket-preview-collapsed-note">${escapeHtml(summaryLine)}</div>
        </div>
    `;
}

async function handleTicketAction(action, ticketId) {
    const recordIndex = ticketData.findIndex(item => item.ticketId === ticketId);
    if (recordIndex === -1) return;

    const record = { ...ticketData[recordIndex] };
    const workflow = getWorkflowTemplate(record);
    const nowIso = new Date().toISOString();
    let emailEventType = '';

    if (action === 'email') {
        emailEventType = getEmailEventTypeForStep(record, getCurrentStep(record));
        if (emailEventType) {
            await sendWorkflowEmailForTicket(record, emailEventType);
        }
        record.updatedAt = nowIso;
        ticketData[recordIndex] = await window.BPUU_WORKFLOW_API.upsertTicket(record);
        renderAll();
        return;
    }

    if (action === 'advance') {
        if (!workflow.length || record.stepIndex >= workflow.length - 1) return;
        const nextStepIndex = Math.min(record.stepIndex + 1, workflow.length - 1);
        record.stepIndex = nextStepIndex;
        record.status = getWorkflowStatus(record, workflow, nextStepIndex);
        record.note = record.note || 'อนุมัติและส่งต่อไปขั้นถัดไป';
        emailEventType = getEmailEventTypeForStep(record, workflow[nextStepIndex]);
        applyPlateRegistryMutation(record, nextStepIndex);
    } else if (action === 'send-payment') {
        if (!isOvernightWorkflowTicket(record)) return;
        const amountInput = document.getElementById('overnightPaymentAmount');
        const noteInput = document.getElementById('overnightPaymentNote');
        const qrInput = document.getElementById('overnightPaymentQr');
        const amount = Number(amountInput?.value || 0);
        const note = String(noteInput?.value || '').trim();
        const qrFile = qrInput?.files?.[0] || null;

        if (!amount || amount <= 0) {
            alert('กรุณาระบุจำนวนเงินก่อนส่งอีเมลแจ้งยอด');
            return;
        }
        if (!qrFile) {
            alert('กรุณาแนบไฟล์ QR Code ก่อนส่งอีเมลแจ้งยอด');
            return;
        }

        record.paymentAmount = amount;
        record.paymentRequired = true;
        record.paymentNotificationNote = note;
        record.paymentResponseUrl = `${window.location.origin}/payment-response.html?ticket=${encodeURIComponent(record.ticketId)}`;
        record.paymentQrAttachment = {
            name: qrFile.name,
            type: qrFile.type || 'image/png',
            size: qrFile.size || 0,
            dataUrl: await readAdminFileAsDataUrl(qrFile)
        };

        const paymentStepIndex = workflow.findIndex(step => /รอชำระเงิน/i.test(step));
        record.stepIndex = paymentStepIndex >= 0 ? paymentStepIndex : Math.min(record.stepIndex + 1, workflow.length - 1);
        record.status = getWorkflowStatus(record, workflow, record.stepIndex);
        record.note = note || 'แจ้งยอดชำระเงินให้ผู้ขอเรียบร้อยแล้ว';
        record.paymentNotificationAt = nowIso;
        emailEventType = 'payment-notification';
    } else if (action === 'complete-receipt') {
        if (!isOvernightWorkflowTicket(record)) return;
        const receiptNoInput = document.getElementById('overnightReceiptNo');
        const receiptDateInput = document.getElementById('overnightReceiptDate');
        const receiptFileInput = document.getElementById('overnightReceiptFile');
        const receiptNo = String(receiptNoInput?.value || '').trim();
        const receiptDate = String(receiptDateInput?.value || '').trim();
        const receiptFile = receiptFileInput?.files?.[0] || null;

        if (!receiptNo) {
            alert('กรุณากรอกเลขที่ใบเสร็จก่อนส่งใบเสร็จ');
            return;
        }
        if (!receiptDate) {
            alert('กรุณาระบุวันที่ใบเสร็จก่อนส่งใบเสร็จ');
            return;
        }
        if (!receiptFile) {
            alert('กรุณาแนบไฟล์ใบเสร็จก่อนส่งใบเสร็จ');
            return;
        }

        record.receiptNo = receiptNo;
        record.receiptDate = receiptDate;
        record.receiptAttachment = {
            name: receiptFile.name,
            type: receiptFile.type || 'application/pdf',
            size: receiptFile.size || 0,
            dataUrl: await readAdminFileAsDataUrl(receiptFile)
        };
        record.receiptIssuedAt = nowIso;
        record.paymentCompletedAt = nowIso;
        record.stepIndex = workflow.length - 1;
        record.status = 'ปิดเรื่องแล้ว';
        record.note = `ออกใบเสร็จเลขที่ ${receiptNo} วันที่ ${receiptDate}`;
        emailEventType = 'completed';
    } else if (action === 'return') {
        const blockedStepIndex = findBlockedStepIndex(workflow, record.stepIndex);
        record.stepIndex = blockedStepIndex;
        record.status = getBlockedStatus(record, workflow, blockedStepIndex);
        record.note = 'ตีกลับให้ผู้ขอแก้ไขข้อมูลก่อนดำเนินการต่อ';
        emailEventType = 'more-info';
    } else if (action === 'close') {
        record.stepIndex = Math.max(0, workflow.length - 1);
        record.status = record.status.includes('แล้ว') ? record.status : 'ปิดเรื่องแล้ว';
        record.note = 'ปิดเรื่องผ่านการดำเนินการบนเว็บแล้ว';
        emailEventType = 'completed';
        applyPlateRegistryMutation(record, record.stepIndex, true);
    }

    if (emailEventType) {
        await sendWorkflowEmailForTicket(record, emailEventType);
    }

    record.updatedAt = nowIso;
    ticketData[recordIndex] = await window.BPUU_WORKFLOW_API.upsertTicket(record);
    renderAll();
}

function applyPlateRegistryMutation(record, stepIndex, force = false) {
    if (!PLATE_REGISTRY || record.typeKey !== 'plate' || record.workflowKey !== 'plateStudent') return;
    if (record.plateRegistryAppliedAt) return;

    const workflow = getWorkflowTemplate(record);
    const targetStep = workflow[stepIndex] || '';
    const shouldApply = force || /อัปเดตฐานข้อมูล Carpark/i.test(targetStep);
    if (!shouldApply) return;

    const result = PLATE_REGISTRY.applyTicket(record);
    if (!result.changed && !result.appliedCount) return;

    record.plateRegistryAppliedAt = new Date().toISOString();
    record.plateRegistryApplied = true;
    loadPlateRegistry();
}

function handleWorkflowStorageChange(event) {
    if (event.key !== TICKET_STORAGE_KEY && event.key !== TICKET_STORAGE_PING_KEY && !LEGACY_TICKET_STORAGE_KEYS.includes(event.key)) return;
    void refreshTicketsFromStorage();
}

async function refreshTicketsFromStorage() {
    ticketData = await loadTickets();
    renderAll();
}

function bindWorkflowBroadcast() {
    try {
        const channel = new BroadcastChannel('bpuu-workflow-tickets');
        channel.addEventListener('message', (event) => {
            if (event.data?.type !== 'tickets-updated') return;
            void refreshTicketsFromStorage();
        });
    } catch (error) {
        // The storage ping still keeps older browsers in sync.
    }
}

function loadPlateRegistry() {
    plateRegistryData = PLATE_REGISTRY ? PLATE_REGISTRY.loadRegistry() : [];
    return plateRegistryData;
}

function clearPlateRegistry() {
    if (!PLATE_REGISTRY) return;
    PLATE_REGISTRY.clearRegistry();
    plateRegistryData = [];
}

function handlePlateRegistryStorageChange(event) {
    if (!PLATE_REGISTRY) return;
    if (event.key !== PLATE_REGISTRY.STORAGE_KEY && event.key !== PLATE_REGISTRY.HISTORY_KEY) return;
    loadPlateRegistry();
    renderAll();
}

function renderRegistrySection() {
    if (!dom.registryList || !dom.registryCount || !PLATE_REGISTRY) return;

    const registry = loadPlateRegistry().slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    dom.registryCount.textContent = `${registry.length} รายการ`;

    if (!registry.length) {
        dom.registryList.innerHTML = `
            <div class="col-12">
                <div class="detail-empty text-center">
                    <div class="empty-state-icon">
                        <i class="bi bi-database-fill"></i>
                    </div>
                    <h3 class="h5 fw-bold text-dark mb-2">ยังไม่มีทะเบียนรถในระบบ</h3>
                    <p class="mb-0">เมื่อมี ticket ประเภททะเบียนรถผ่านขั้นตอนอัปเดต Carpark รายการจะถูกเก็บไว้ในระบบหลังบ้านและแสดงตรงนี้</p>
                </div>
            </div>
        `;
        return;
    }

    dom.registryList.innerHTML = registry.map(item => `
        <div class="col-12 col-md-6 col-xl-4">
            <div class="registry-card h-100">
                <div class="d-flex justify-content-between align-items-start gap-3">
                    <div>
                        <div class="registry-plate">${escapeHtml(item.plate)}</div>
                        <div class="registry-meta">${escapeHtml(item.requesterName || 'ไม่ระบุผู้ขอ')}</div>
                    </div>
                    <span class="badge rounded-pill bg-success-subtle text-success-emphasis fw-bold">active</span>
                </div>
                <div class="registry-details mt-3">
                    <div><span class="registry-label">ประเภท</span>${escapeHtml(item.requesterType || '-')}</div>
                    <div><span class="registry-label">คำขอ</span>${escapeHtml(item.action || '-')}</div>
                    <div><span class="registry-label">Ticket</span>${escapeHtml(item.sourceTicketId || '-')}</div>
                    <div><span class="registry-label">อัปเดต</span>${escapeHtml(formatDateTime(item.updatedAt))}</div>
                </div>
                ${item.note ? `<div class="registry-note mt-3">${escapeHtml(item.note)}</div>` : ''}
            </div>
        </div>
    `).join('');
}

function findBlockedStepIndex(workflow, currentStepIndex) {
    if (!workflow.length) return currentStepIndex;

    const blockedIndex = workflow.findIndex(step => /ตีกลับ|แก้ไข|ปัญหา/i.test(step));
    if (blockedIndex !== -1) return blockedIndex;

    return Math.max(0, Math.min(currentStepIndex, workflow.length - 1));
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

function getBlockedStatus(record, workflow, stepIndex) {
    const stepLabel = workflow[stepIndex] || '';
    if (/แก้ไข|ตีกลับ/i.test(stepLabel)) return stepLabel;
    return 'ต้องแก้ไขข้อมูล';
}

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
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

// =========================================================
// Stamp Fee Collection Workspace
// =========================================================
function renderCollectionSection() {
    const filteredPayments = getFilteredStampCollections();
    renderPaymentStats(filteredPayments);
    renderPaymentList(filteredPayments);
    renderPaymentDetailPanel(filteredPayments);
}

function getInitialStampCollections() {
    return [];
}

function loadStampCollections() {
    try {
        const raw = localStorage.getItem(STAMP_COLLECTION_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) return [];
        const filtered = parsed
            .filter(item => !LEGACY_STAMP_COLLECTION_IDS.has(item?.collectionId))
            .map(item => ({ ...item }));

        if (filtered.length !== parsed.length) {
            localStorage.setItem(STAMP_COLLECTION_STORAGE_KEY, JSON.stringify(filtered));
        }

        return filtered;
    } catch (error) {
        return [];
    }
}

function saveStampCollections() {
    try {
        localStorage.setItem(STAMP_COLLECTION_STORAGE_KEY, JSON.stringify(stampCollectionData));
    } catch (error) {
        // No-op in file mode or restricted storage environments.
    }
}

function resetStampCollections() {
    stampCollectionData = getInitialStampCollections();
    saveStampCollections();
}

function createStampCollectionMessage(record) {
    return [
        `แจ้งยอดเก็บเงินคำขอ ${record.sourceTicketId}`,
        `ผู้ขอ: ${record.requesterName} (${record.requesterType})`,
        `ยอดเรียกเก็บ: ${formatCurrency(record.amount)}`,
        `กำหนดชำระ: ${formatShortDate(record.dueDate)}`,
        `เลขอ้างอิง: ${record.referenceNo || '-'}`,
        `ช่องทางชำระ: ${record.paymentMethod || '-'}`,
    ].join('\n');
}

function formatCurrency(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        maximumFractionDigits: 0
    }).format(number);
}

function formatShortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('th-TH', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    }).format(date);
}

function getStampCollectionWorkflow() {
    return STAMP_COLLECTION_WORKFLOW;
}

function getStampCollectionStepIndex(record) {
    const steps = getStampCollectionWorkflow();
    if (!steps.length) return 0;
    return Math.max(0, Math.min(Number(record.stepIndex || 0), steps.length - 1));
}

function getStampCollectionCurrentStep(record) {
    return getStampCollectionWorkflow()[getStampCollectionStepIndex(record)] || '-';
}

function getStampCollectionProgress(record) {
    const steps = getStampCollectionWorkflow();
    if (!steps.length) return 0;
    const completed = Math.min(getStampCollectionStepIndex(record) + 1, steps.length);
    return Math.round((completed / steps.length) * 100);
}

function getStampCollectionStatusTone(status) {
    const normalized = (status || '').toLowerCase();
    if (normalized.includes('เกินกำหนด')) return 'danger';
    if (normalized.includes('รับชำระ')) return 'success';
    if (normalized.includes('ออกใบเสร็จ')) return 'info';
    if (normalized.includes('ปิดรายการ')) return 'neutral';
    return 'warning';
}

function getStampCollectionStatusIcon(status) {
    const tone = getStampCollectionStatusTone(status);
    if (tone === 'danger') return 'bi-exclamation-triangle-fill';
    if (tone === 'success') return 'bi-check-circle-fill';
    if (tone === 'info') return 'bi-receipt-cutoff';
    if (tone === 'neutral') return 'bi-archive-fill';
    return 'bi-hourglass-split';
}

function getStampCollectionAccent(status) {
    const tone = getStampCollectionStatusTone(status);
    if (tone === 'danger') return '#dc2626';
    if (tone === 'success') return '#16a34a';
    if (tone === 'info') return '#0ea5e9';
    if (tone === 'neutral') return '#475569';
    return '#f59e0b';
}

function getFilteredStampCollections() {
    const query = collectionState.query.toLowerCase();
    return [...stampCollectionData]
        .filter(item => {
            const statusMatch = collectionState.status === 'all' || item.status === collectionState.status;
            const requesterMatch = collectionState.requesterType === 'all' || item.requesterType === collectionState.requesterType;
            const searchTarget = [
                item.collectionId,
                item.sourceTicketId,
                item.requesterType,
                item.requesterName,
                item.contextValue,
                item.status,
                item.paymentMethod,
                item.referenceNo,
                item.receiptNo,
                item.note,
                formatCurrency(item.amount)
            ].join(' ').toLowerCase();
            const queryMatch = !query || searchTarget.includes(query);
            return statusMatch && requesterMatch && queryMatch;
        })
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function renderPaymentStats(filteredPayments) {
    const pendingPayments = filteredPayments.filter(item => !['รับชำระแล้ว', 'ออกใบเสร็จแล้ว', 'ปิดรายการ'].includes(item.status));
    const pendingCount = pendingPayments.length;
    const pendingAmount = pendingPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const receivedCount = filteredPayments.filter(item => item.status === 'รับชำระแล้ว').length;
    const overdueCount = filteredPayments.filter(item => item.status === 'เกินกำหนด').length;

    if (dom.paymentStatCards) {
        dom.paymentStatCards.innerHTML = `
            <div class="col-12 col-md-6 col-xl-3">
                <div class="stat-card payment-stat-card stat-total">
                    <div class="stat-label">รอเก็บเงิน</div>
                    <div class="stat-value">${pendingCount}</div>
                    <div class="stat-foot">รายการที่ยังไม่ปิด</div>
                </div>
            </div>
            <div class="col-12 col-md-6 col-xl-3">
                <div class="stat-card payment-stat-card stat-active">
                    <div class="stat-label">ยอดค้างรับรวม</div>
                    <div class="stat-value">${formatCurrency(pendingAmount)}</div>
                    <div class="stat-foot">เฉพาะรายการที่ยังเปิดอยู่</div>
                </div>
            </div>
            <div class="col-12 col-md-6 col-xl-3">
                <div class="stat-card payment-stat-card stat-closed">
                    <div class="stat-label">รับชำระแล้ว</div>
                    <div class="stat-value">${receivedCount}</div>
                    <div class="stat-foot">รอออกใบเสร็จหรือปิดรายการ</div>
                </div>
            </div>
            <div class="col-12 col-md-6 col-xl-3">
                <div class="stat-card payment-stat-card stat-blocked">
                    <div class="stat-label">เกินกำหนด</div>
                    <div class="stat-value">${overdueCount}</div>
                    <div class="stat-foot">ต้องติดตามเป็นพิเศษ</div>
                </div>
            </div>
        `;
    }

    if (dom.paymentResultCount) {
        dom.paymentResultCount.textContent = `${filteredPayments.length} รายการ`;
    }
}

function renderPaymentList(filteredPayments) {
    if (!dom.paymentList) return;

    if (!filteredPayments.length) {
        dom.paymentList.innerHTML = `
            <div class="detail-empty text-center">
                <div class="empty-state-icon">
                    <i class="bi bi-search"></i>
                </div>
                <h3 class="h5 fw-bold text-dark mb-2">ไม่พบรายการเก็บเงินที่ตรงกับตัวกรอง</h3>
                <p class="mb-0">
                    ลองล้างตัวกรองหรือเปลี่ยนสถานะ เพื่อดูรายการที่ยังต้องติดตามต่อ
                </p>
            </div>
        `;
        collectionState.selectedPaymentId = '';
        return;
    }

    if (!filteredPayments.some(item => item.collectionId === collectionState.selectedPaymentId)) {
        collectionState.selectedPaymentId = filteredPayments[0].collectionId;
    }

    dom.paymentList.innerHTML = filteredPayments.map(item => renderPaymentCard(item, item.collectionId === collectionState.selectedPaymentId)).join('');

    dom.paymentList.querySelectorAll('[data-payment-id]').forEach(button => {
        button.addEventListener('click', () => {
            collectionState.selectedPaymentId = button.dataset.paymentId;
            renderAll();
        });
    });
}

function renderPaymentCard(item, isActive) {
    const tone = getStampCollectionStatusTone(item.status);
    const accent = getStampCollectionAccent(item.status);
    const dueLabel = getDueLabel(item.dueDate);
    const progress = getStampCollectionProgress(item);

    return `
        <button type="button" class="ticket-card payment-card${isActive ? ' active' : ''}" data-payment-id="${escapeHtml(item.collectionId)}" style="--card-accent:${accent};">
            <div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
                <div class="flex-grow-1">
                    <div class="ticket-id mb-1">${escapeHtml(item.collectionId)}</div>
                    <div class="ticket-title mb-1">
                        <i class="bi bi-cash-coin me-2" style="color:${accent};"></i>${escapeHtml(item.requesterName)}
                    </div>
                    <div class="ticket-meta">
                        ${escapeHtml(item.requesterType)} · ${escapeHtml(item.contextValue)}
                    </div>
                    <div class="d-flex flex-wrap gap-2 mt-3">
                        <span class="meta-pill"><i class="bi bi-link-45deg"></i>${escapeHtml(item.sourceTicketId)}</span>
                        <span class="meta-pill"><i class="bi bi-calendar-event-fill"></i>${escapeHtml(dueLabel)}</span>
                        <span class="meta-pill"><i class="bi bi-wallet2"></i>${escapeHtml(item.paymentMethod || '-')}</span>
                    </div>
                </div>
                <div class="text-end">
                    <span class="status-badge status-${tone} mb-2">
                        <i class="bi ${getStampCollectionStatusIcon(item.status)}"></i>
                        ${escapeHtml(item.status)}
                    </span>
                    <div class="payment-amount">${formatCurrency(item.amount)}</div>
                    <div class="payment-subnote">${formatShortDate(item.updatedAt)}</div>
                </div>
            </div>
            <div class="detail-progress mt-3 mb-0">
                <div class="progress">
                    <div class="progress-bar" style="width:${progress}%"></div>
                </div>
            </div>
        </button>
    `;
}

function renderPaymentDetailPanel(filteredPayments) {
    if (!dom.paymentDetailPanel) return;

    const selected = filteredPayments.find(item => item.collectionId === collectionState.selectedPaymentId) || filteredPayments[0];
    if (!selected) {
        dom.paymentDetailPanel.innerHTML = `
            <div class="detail-empty text-center">
                <div class="empty-state-icon">
                    <i class="bi bi-receipt-cutoff"></i>
                </div>
                <h3 class="h5 fw-bold text-dark mb-2">ยังไม่มีรายการเก็บเงิน</h3>
                <p class="mb-0">
                    เมื่อมีรายการตราประทับเข้ามา ระบบจะแสดงข้อมูลยอดและสถานะให้อัตโนมัติ
                </p>
            </div>
        `;
        return;
    }

    collectionState.selectedPaymentId = selected.collectionId;

    const tone = getStampCollectionStatusTone(selected.status);
    const accent = getStampCollectionAccent(selected.status);
    const workflow = getStampCollectionWorkflow();
    const currentStep = getStampCollectionCurrentStep(selected);
    const totalAmount = Number(selected.amount || 0);
    const breakdownAmount = Number(selected.baseFee || 0) + Number(selected.serviceFee || 0) + Number(selected.lateFee || 0);
    const paymentMessage = createStampCollectionMessage(selected);
    const dueLabel = getDueLabel(selected.dueDate);
    const selectedData = {
        amount: totalAmount,
        dueDate: selected.dueDate,
        paymentMethod: selected.paymentMethod || '',
        referenceNo: selected.referenceNo || '',
        receiptNo: selected.receiptNo || '',
        note: selected.note || ''
    };

    dom.paymentDetailPanel.innerHTML = `
        <div class="detail-head">
            <span class="detail-id">${escapeHtml(selected.collectionId)}</span>
            <div class="d-flex flex-wrap gap-2 align-items-center">
                <span class="badge rounded-pill px-3 py-2" style="background:${accent}; color:#fff;">
                    <i class="bi bi-cash-coin me-1"></i>เก็บเงินตราประทับ
                </span>
                <span class="status-badge status-${tone}">
                    <i class="bi ${getStampCollectionStatusIcon(selected.status)}"></i>${escapeHtml(selected.status)}
                </span>
            </div>
            <div>
                <h3 class="detail-title mb-2">${escapeHtml(selected.requesterName)}</h3>
                <div class="detail-subtitle">
                    ${escapeHtml(selected.requesterType)} · ${escapeHtml(selected.contextValue)}<br>
                    Ticket ต้นทาง: <span class="fw-bold text-dark">${escapeHtml(selected.sourceTicketId)}</span>
                </div>
            </div>
        </div>

        <div class="payment-amount-box mb-3">
            <div class="amount-label">ยอดเรียกเก็บปัจจุบัน</div>
            <div class="amount-value">${formatCurrency(totalAmount)}</div>
            <div class="amount-note">
                ค่าตราประทับ ${formatCurrency(selected.baseFee || 0)} +
                ค่าดำเนินการ ${formatCurrency(selected.serviceFee || 0)} +
                ค่าปรับ ${formatCurrency(selected.lateFee || 0)}
            </div>
        </div>

        <div class="payment-detail-grid">
            <div class="detail-box">
                <span class="detail-box-label">กำหนดชำระ</span>
                <div class="detail-box-value">${escapeHtml(dueLabel)}</div>
            </div>
            <div class="detail-box">
                <span class="detail-box-label">ช่องทางชำระ</span>
                <div class="detail-box-value">${escapeHtml(selected.paymentMethod || '-')}</div>
            </div>
            <div class="detail-box">
                <span class="detail-box-label">เลขอ้างอิง</span>
                <div class="detail-box-value">${escapeHtml(selected.referenceNo || '-')}</div>
            </div>
            <div class="detail-box">
                <span class="detail-box-label">เลขที่ใบเสร็จ</span>
                <div class="detail-box-value">${escapeHtml(selected.receiptNo || '-')}</div>
            </div>
        </div>

        <div class="payment-summary-list">
            <div class="payment-summary-row">
                <span class="summary-label">ขั้นตอนปัจจุบัน</span>
                <span class="summary-value">${escapeHtml(currentStep)}</span>
            </div>
            <div class="payment-summary-row">
                <span class="summary-label">ผู้รับผิดชอบ</span>
                <span class="summary-value">${escapeHtml(selected.assignee || '-')}</span>
            </div>
            <div class="payment-summary-row">
                <span class="summary-label">อัปเดตล่าสุด</span>
                <span class="summary-value">${formatDateTime(selected.updatedAt)}</span>
            </div>
            <div class="payment-summary-row">
                <span class="summary-label">ยอดตามรายละเอียด</span>
                <span class="summary-value">${formatCurrency(breakdownAmount)}</span>
            </div>
        </div>

        <div class="payment-form-grid">
            <div>
                <label class="form-label text-ci-bluegrey fw-bold small mb-2" for="paymentAmountInput">ยอดเรียกเก็บ</label>
                <input type="number" min="0" step="1" class="form-control filter-control" id="paymentAmountInput" value="${escapeHtml(String(selectedData.amount))}">
            </div>
            <div>
                <label class="form-label text-ci-bluegrey fw-bold small mb-2" for="paymentDueDateInput">กำหนดชำระ</label>
                <input type="date" class="form-control filter-control" id="paymentDueDateInput" value="${escapeHtml(selectedData.dueDate)}">
            </div>
            <div>
                <label class="form-label text-ci-bluegrey fw-bold small mb-2" for="paymentMethodInput">ช่องทางชำระ</label>
                <select class="form-select filter-control" id="paymentMethodInput">
                    ${renderPaymentMethodOptions(selectedData.paymentMethod)}
                </select>
            </div>
            <div>
                <label class="form-label text-ci-bluegrey fw-bold small mb-2" for="paymentReferenceInput">เลขอ้างอิง</label>
                <input type="text" class="form-control filter-control" id="paymentReferenceInput" value="${escapeHtml(selectedData.referenceNo)}" placeholder="เช่น ST-1001">
            </div>
            <div>
                <label class="form-label text-ci-bluegrey fw-bold small mb-2" for="paymentReceiptInput">เลขที่ใบเสร็จ</label>
                <input type="text" class="form-control filter-control" id="paymentReceiptInput" value="${escapeHtml(selectedData.receiptNo)}" placeholder="ถ้ายังไม่มีให้เว้นว่างไว้">
            </div>
            <div>
                <label class="form-label text-ci-bluegrey fw-bold small mb-2" for="paymentNoteInput">หมายเหตุ</label>
                <input type="text" class="form-control filter-control" id="paymentNoteInput" value="${escapeHtml(selectedData.note)}" placeholder="เช่น รอผู้ขอยืนยันยอด">
            </div>
        </div>

        <div class="payment-action-row">
            <button type="button" class="btn btn-ci-bluegrey fw-bold" data-payment-action="save">
                <i class="bi bi-save2-fill me-1"></i>บันทึกข้อมูล
            </button>
            <button type="button" class="btn btn-outline-warning fw-bold" data-payment-action="dispatch">
                <i class="bi bi-send-fill me-1"></i>แจ้งยอดให้ผู้ขอ
            </button>
            <button type="button" class="btn btn-outline-success fw-bold" data-payment-action="mark-paid">
                <i class="bi bi-cash-coin me-1"></i>บันทึกว่ารับชำระแล้ว
            </button>
            <button type="button" class="btn btn-outline-primary fw-bold" data-payment-action="issue-receipt">
                <i class="bi bi-receipt-cutoff me-1"></i>ออกใบเสร็จ
            </button>
            <button type="button" class="btn btn-outline-dark fw-bold" data-payment-action="close">
                <i class="bi bi-check2-circle me-1"></i>ปิดรายการ
            </button>
        </div>

        <div class="payment-note-box">
            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                <div class="fw-bold"><i class="bi bi-chat-left-text-fill me-1"></i>ข้อความแจ้งยอดที่พร้อมส่ง</div>
                <button type="button" class="btn btn-outline-success btn-sm fw-bold" data-payment-action="copy-message">
                    คัดลอกข้อความแจ้งยอด
                </button>
            </div>
            <div class="small text-dark" style="white-space: pre-line;" id="paymentMessagePreview">${escapeHtml(paymentMessage)}</div>
        </div>

        <div class="workflow-track">
            ${buildPaymentTimeline(selected, workflow)}
        </div>
    `;

    bindPaymentDetailActions(selected.collectionId);
}

function renderPaymentMethodOptions(selectedValue) {
    const options = ['โอนเงิน', 'QR Code', 'เงินสด', 'พร้อมเพย์'];
    return options.map(option => {
        const selected = option === selectedValue ? 'selected' : '';
        return `<option value="${escapeHtml(option)}" ${selected}>${escapeHtml(option)}</option>`;
    }).join('');
}

function bindPaymentDetailActions(collectionId) {
    const detailPanel = dom.paymentDetailPanel;
    if (!detailPanel) return;

    detailPanel.querySelectorAll('[data-payment-action]').forEach(button => {
        button.addEventListener('click', async () => {
            const action = button.dataset.paymentAction;
            if (action === 'copy-message') {
                const record = stampCollectionData.find(item => item.collectionId === collectionId);
                if (record) {
                    const message = createStampCollectionMessage(record);
                    try {
                        await navigator.clipboard.writeText(message);
                        button.innerHTML = '<i class="bi bi-check2 me-1"></i>คัดลอกแล้ว';
                        setTimeout(() => renderAll(), 900);
                    } catch (error) {
                        alert('คัดลอกข้อความแจ้งยอดไม่สำเร็จ แต่คุณสามารถเลือกคัดลอกจากกล่องข้อความได้');
                    }
                }
                return;
            }

            handlePaymentAction(action, collectionId);
        });
    });
}

function handlePaymentAction(action, collectionId) {
    const recordIndex = stampCollectionData.findIndex(item => item.collectionId === collectionId);
    if (recordIndex === -1) return;

    const record = { ...stampCollectionData[recordIndex] };
    const nowIso = new Date().toISOString();

    if (action === 'save') {
        const amount = Number(document.getElementById('paymentAmountInput')?.value || record.amount || 0);
        const dueDate = document.getElementById('paymentDueDateInput')?.value || record.dueDate;
        const paymentMethod = document.getElementById('paymentMethodInput')?.value || record.paymentMethod;
        const referenceNo = document.getElementById('paymentReferenceInput')?.value.trim() || record.referenceNo;
        const receiptNo = document.getElementById('paymentReceiptInput')?.value.trim() || record.receiptNo;
        const note = document.getElementById('paymentNoteInput')?.value.trim() || record.note;

        stampCollectionData[recordIndex] = {
            ...record,
            amount,
            dueDate,
            paymentMethod,
            referenceNo,
            receiptNo,
            note,
            updatedAt: nowIso
        };
        saveStampCollections();
        renderAll();
        return;
    }

    if (action === 'dispatch') {
        record.status = 'รอชำระเงิน';
        record.stepIndex = 1;
        record.updatedAt = nowIso;
        record.note = record.note || 'แจ้งยอดให้ผู้ขอแล้ว';
    } else if (action === 'mark-paid') {
        record.status = 'รับชำระแล้ว';
        record.stepIndex = 2;
        record.updatedAt = nowIso;
        if (!record.receiptNo) {
            record.receiptNo = `RCPT-${record.collectionId.replace('COL-', '')}`;
        }
        record.note = 'รับชำระแล้ว รอออกใบเสร็จ';
    } else if (action === 'issue-receipt') {
        record.status = 'ออกใบเสร็จแล้ว';
        record.stepIndex = 3;
        record.updatedAt = nowIso;
        if (!record.receiptNo) {
            record.receiptNo = `RCPT-${record.collectionId.replace('COL-', '')}`;
        }
        record.note = 'ออกใบเสร็จแล้วและส่งให้ผู้ขอเรียบร้อย';
    } else if (action === 'close') {
        record.status = 'ปิดรายการ';
        record.stepIndex = 4;
        record.updatedAt = nowIso;
        record.note = 'ปิดรายการและเก็บเอกสารครบถ้วน';
    }

    stampCollectionData[recordIndex] = record;
    saveStampCollections();
    renderAll();
}

function buildPaymentTimeline(record, workflow) {
    const currentIndex = getStampCollectionStepIndex(record);
    return workflow.map((step, index) => {
        const stateClass = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending';
        const subtitle = index < currentIndex
            ? 'ทำเสร็จแล้ว'
            : index === currentIndex
                ? 'กำลังดำเนินการ'
                : 'รอดำเนินการ';

        return `
            <div class="workflow-step ${stateClass}">
                <div class="step-title">${escapeHtml(step)}</div>
                <div class="step-subtitle">${subtitle}</div>
            </div>
        `;
    }).join('');
}

function getDueLabel(dueDate) {
    const due = new Date(`${dueDate}T00:00:00`);
    if (Number.isNaN(due.getTime())) return '-';
    const now = new Date();
    const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    const dateLabel = formatShortDate(dueDate);
    if (diffDays < 0) return `${dateLabel} (เกินกำหนด ${Math.abs(diffDays)} วัน)`;
    if (diffDays === 0) return `${dateLabel} (ครบกำหนดวันนี้)`;
    return `${dateLabel} (อีก ${diffDays} วัน)`;
}
