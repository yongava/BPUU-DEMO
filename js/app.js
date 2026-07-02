const STAFF_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRzYO0Kyv2yxDlo40zJ06bkb3Vh70X_HZj5gowDC_wHjCF2LxoaCu4CFLkBzd6j2Q4Do_3-ntiipx3-/pub?gid=955988221&single=true&output=csv";
const STUDENT_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRzYO0Kyv2yxDlo40zJ06bkb3Vh70X_HZj5gowDC_wHjCF2LxoaCu4CFLkBzd6j2Q4Do_3-ntiipx3-/pub?gid=32041089&single=true&output=csv";
const CONTRACT_DATA_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRzYO0Kyv2yxDlo40zJ06bkb3Vh70X_HZj5gowDC_wHjCF2LxoaCu4CFLkBzd6j2Q4Do_3-ntiipx3-/pub?gid=1831450496&single=true&output=csv";
const JOTFORM_FORM_ID = "261200763585052";
const JOTFORM_SUBMIT_URL = `https://submit.jotform.com/submit/${JOTFORM_FORM_ID}`;
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
    // เรียงจากหน่วยย่อยของผู้ใช้ (Level 4) ไล่ขึ้นไปหน่วยบนสุด (Level 2): 4-3-2
    const departmentNames = getStaffDepartmentCodes(currentCode)
        .map(code => lookup.get(code))
        .filter(Boolean)
        .reverse();

    if (fallbackName && !departmentNames.includes(fallbackName)) {
        // ชื่อหน่วยของผู้ใช้เอง (Level 4) อยู่บนสุด
        departmentNames.unshift(fallbackName);
    }

    if (!departmentNames.length) return '-';

    // แสดงลำดับชั้นจากหน่วยย่อยของผู้ใช้ (Level 4) ขึ้นไปหน่วยบนสุด (Level 2)
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
    const isStaff = currentLoginType === 'staff';
    const appName = isStaff ? 'MOD LINK Pro' : 'MOD LINK';
    const userLabel = isStaff ? 'บุคลากร' : 'นักศึกษา';
    return `
        <div class="col-md-12">
            <div class="alert small mb-0 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-orange) !important;">
                <strong class="text-ci-orange"><i class="bi bi-megaphone-fill me-1"></i> แนะนำช่องทาง ${appName}</strong><br>
                สำหรับ ${userLabel} ท่านสามารถแจ้งปัญหาและติดตามสถานะได้ง่ายยิ่งขึ้น ผ่านแอปพลิเคชัน "${appName}"
            </div>
        </div>`;
}

// เบอร์มือถือ: id ของฟิลด์ที่ต้องบังคับกรอกเฉพาะตัวเลข ขึ้นต้นด้วย 0 และไม่เกิน 10 หลัก
const PHONE_FIELD_IDS = ['reqPhone', 'extPhone', 'monthlyOtherPhone'];
function sanitizePhoneInput(el) {
    let digits = el.value.replace(/\D/g, '');       // ตัวเลขเท่านั้น
    if (digits && digits[0] !== '0') digits = '0' + digits.replace(/^0+/, ''); // บังคับขึ้นต้นด้วย 0
    el.value = digits.slice(0, 10);                 // ไม่เกิน 10 หลัก
}

document.addEventListener("DOMContentLoaded", function() {
    loginModalInstance = new bootstrap.Modal(document.getElementById('loginModal'));
    modlinkModalInstance = new bootstrap.Modal(document.getElementById('modlinkModal'));
    summaryModalInstance = new bootstrap.Modal(document.getElementById('summaryModal'));
    successModalInstance = new bootstrap.Modal(document.getElementById('successModal'));
    loadDatabases();
    // consentCheck ถูก render แบบ dynamic — ใช้ event delegation จับการติ๊กเพื่อเปิด/ปิดปุ่มส่ง
    document.addEventListener('change', function(e) {
        if (e.target && e.target.id === 'consentCheck') updateSubmitState();
    });
    // เบอร์มือถือ: กรอกได้เฉพาะตัวเลข ขึ้นต้นด้วย 0 และไม่เกิน 10 หลัก (รองรับฟิลด์ที่ถูก render ทีหลังด้วย event delegation)
    document.addEventListener('input', function(e) {
        if (e.target && PHONE_FIELD_IDS.includes(e.target.id)) sanitizePhoneInput(e.target);
    });
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
    updateSubmitState(); // อัปเดตปุ่มส่งของ view ที่เพิ่งเปิด (ต้องเรียกหลังตั้ง active แล้วเท่านั้น)
}

function goHome() { 
    currentSelectedForm = "";
    currentLoginType ? switchView('homeView') : switchView('initialUserTypeView'); 
}

function logout() {
    currentLoginType = "";
    globalUserData = null;
    clearRequesterAndApproverState();
    switchView('initialUserTypeView');
}

// ล้างข้อมูลผู้ขอ/ผู้อนุมัติค้างจาก session ก่อนหน้า — กันข้อมูลคนเก่าติดไปกับ submission ถัดไป
function clearRequesterAndApproverState() {
    clearValidationMarks();
    ['appName', 'appPosition', 'reqEmpId', 'reqName', 'reqEmail', 'reqPhone', 'reqDeptCode', 'reqPosition',
     'reqInternalPhone', 'reqStatus', 'reqFaculty', 'reqMajor',
     'extFname', 'extLname', 'extCompany', 'extPhone', 'extEmail', 'extTypeOther'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const appEmail = document.getElementById('appEmail');
    if (appEmail) appEmail.innerText = '';
    ['extType1', 'extType2', 'extType3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
    });
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
        // จอดรถรายเดือน: บุคคลภายนอกเห็นได้ (รองรับผู้ปกครอง/บริษัทคู่สัญญา)
        document.getElementById('menu-edit-plate').style.display = 'none';
        document.getElementById('menu-stamp').style.display = 'none'; // บุคคลภายนอกไม่เห็นตราประทับ
    }
}

function selectForm(formName) {
    currentSelectedForm = formName;
    
    if (formName === 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์' && currentLoginType === 'staff') {
        fillInternalData(formName);
        // บันทึก tracking เงียบ ๆ แล้ว redirect ไป IBGM — ไม่โชว์โมดัล "ส่งสำเร็จ" (ไม่ใช่การส่งฟอร์มปกติ)
        submitToJotform({ q32_summary: 'บุคลากรถูกส่งต่อไปดำเนินการในระบบ IBGM (https://app.ibgm.cloud/)' }, { silent: true });
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
            const isStaff = currentLoginType === 'staff';
            const appName = isStaff ? 'MOD LINK Pro' : 'MOD LINK';
            const userLabel = isStaff ? 'บุคลากร' : 'นักศึกษา';
            const logoSrc = isStaff ? './AW_MODlink_pro_vertical.jpg' : './AW_MODlink_student_vertical.jpg';
            const adviceText = document.getElementById('modlinkAdviceText');
            const logoImg = document.getElementById('modlinkLogo');
            if (adviceText) adviceText.innerHTML = `สำหรับ <strong>${userLabel} มจธ.</strong> <br>ท่านสามารถแจ้งปัญหาและติดตามสถานะได้ง่ายยิ่งขึ้น ผ่านแอปพลิเคชัน <strong>"${appName}"</strong>`;
            if (logoImg) { logoImg.src = logoSrc; logoImg.alt = appName; }
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
        const approverContext = isStaff ? 'ผู้บังคับบัญชา' : 'สายงานนักศึกษา';
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
    // ล้างทั้งสอง container เสมอ — id ในเทมเพลตซ้ำกันข้ามมุมมอง (เช่น consentCheck)
    // ถ้าปล่อยค้าง getElementById จะหยิบค่าของผู้ใช้คนก่อนไปใส่ summary/consent
    clearValidationMarks();
    document.getElementById('dynamicFormSection').innerHTML = "";
    document.getElementById('dynamicExternalFormSection').innerHTML = "";
    const container = document.getElementById(targetContainerId);
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
                                    <input type="tel" inputmode="numeric" maxlength="10" pattern="0[0-9]{9}" class="form-control" id="monthlyOtherPhone" placeholder="08XXXXXXXX">
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
                                <li>เมื่อท่านกรอกรหัสนักศึกษา ทำการตรวจสอบข้อมูลจากระบบหลัก</li>
                                <li>ระยะเวลา 1 เดือน นับจากวันที่เริ่มใช้งาน เช่น 20/01/XXXX-19/02/XXXX (ระยะเวลา 1 เดือน)</li>
                                <li>ค่าบำรุงสถานที่อาคารจอดรถ สำหรับนักศึกษาอัตรา 900 บาท/เดือน สามารถจอดได้ตั้งแต่ 05.00 – 23.59 น.</li>
                                <li>การต่ออายุขอจอดรถรายเดือนในครั้งถัดไปสามารถทำได้ที่ ตู้ Kiosk ชั้น 1 อาคารจอดรถ (S2)</li>
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
                                <li>เหตุสุดวิสัย เช่น การเจ็บป่วยต้องได้รับการรักษาทันที เป็นต้น</li>
                                <li>กรณีข้อมูล (เอกสารแนบ) เป็นไปตามเงื่อนไข / ไม่เป็นไปตามเงื่อนไขของประกาศ ใช้ระยะเวลา 1 วัน (ในวันเวลาราชการ) ในการพิจารณา</li>
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
                    <div class="col-12 mt-2"><label class="form-label text-ci-bluegrey fw-bold small mb-1">ข้อมูลผู้ใช้ตราประทับ <span class="text-muted fw-normal">(รองรับสูงสุด 2 คน)</span></label></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">ชื่อ-สกุล <span class="text-muted fw-normal">(คนที่ 1)</span> <span class="req-star">*</span></label><input type="text" class="form-control border-light shadow-sm" id="stampUserName1" placeholder="ชื่อ-สกุล ผู้ใช้ตราประทับ"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">อีเมล <span class="text-muted fw-normal">(คนที่ 1)</span> <span class="req-star">*</span></label><input type="email" class="form-control border-light shadow-sm" id="stampUserEmail1" placeholder="email@kmutt.ac.th"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">ชื่อ-สกุล <span class="text-muted fw-normal">(คนที่ 2 — ถ้ามี)</span></label><input type="text" class="form-control border-light shadow-sm" id="stampUserName2" placeholder="ชื่อ-สกุล ผู้ใช้ตราประทับ"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">อีเมล <span class="text-muted fw-normal">(คนที่ 2 — ถ้ามี)</span></label><input type="email" class="form-control border-light shadow-sm" id="stampUserEmail2" placeholder="email@kmutt.ac.th"></div>
                    <div class="col-md-12"><label class="form-label text-ci-bluegrey fw-bold small">แนบรายละเอียดเอกสาร <span class="req-star">*</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>
                    
                    <div class="col-12 mt-4">
                        <div class="alert small mb-2 border-0 rounded bg-light" style="border-left: 4px solid var(--ci-yellow) !important;">
                            <strong class="text-ci-orange"><i class="bi bi-info-circle-fill me-1 text-ci-yellow"></i> เงื่อนไข การขอใช้ตราประทับ:</strong><br>
                            <span class="text-muted">(ตามประกาศมหาวิทยาลัยฯ เรื่อง อัตราค่าบริหารจัดการและระเบียบสถานที่จอดรถภายในมหาวิทยาลัย พ.ศ. 2562)</span>
                            <ol class="mb-0 mt-2 ps-3 text-dark">
                                <li>กรณีข้อมูล (เอกสารแนบ) เป็นไปตามเงื่อนไข / ไม่เป็นไปตามเงื่อนไขของประกาศ ใช้ระยะเวลา 1 วัน (ในวันเวลาราชการ) ในการพิจารณา</li>
                                <li>กรณีเป็นไปตามเงื่อนไข กลุ่มงานจัดการผลประโยชน์และทรัพย์สิน จะส่งคู่มือการใช้งานกลับไปยังอีเมล์ที่ผู้ขอใช้ตราประทับ</li>
                                <li>หน่วยงานที่ขอใช้ตราประทับเป็นผู้รับผิดชอบค่าบำรุงสถานที่จอดรถ อัตรา 20 บาท/คัน/วัน ตามประกาศฯ</li>
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
                                <li>อาคารจอดรถ (S2) เปิดให้บริการตั้งแต่ 05.00 น. ถึง 24.00 น. กรณีนำรถขึ้นอาคารจอดรถ/จอดเกินเวลา 24.00 น. มีค่าบริการค้างคืน 400 บาท/คัน/วัน</li>
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
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">วันที่สิ้นสุด <span class="req-star">*</span></label><input type="date" class="form-control border-light shadow-sm" id="areaEndDate"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">เวลาเริ่มต้น <span class="req-star">*</span></label><input type="time" class="form-control border-light shadow-sm" id="areaStartTime" step="60"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">เวลาสิ้นสุด <span class="req-star">*</span></label><input type="time" class="form-control border-light shadow-sm" id="areaEndTime" step="60"></div>
                    <div class="col-md-6"><label class="form-label text-ci-bluegrey fw-bold small">จำนวนบูธ <span class="req-star">*</span></label><input type="number" min="1" step="1" class="form-control border-light shadow-sm" id="areaBoothCount" value="1"></div>
                    <div class="col-md-12 mt-4"><label class="form-label text-ci-bluegrey fw-bold small">วัตถุประสงค์ <span class="req-star">*</span></label><div class="form-check mb-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="obj1" value="ประชาสัมพันธ์"><label class="form-check-label" for="obj1">ประชาสัมพันธ์</label></div><div class="form-check mb-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="obj2" value="แจกผลิตภัณฑ์"><label class="form-check-label" for="obj2">แจกผลิตภัณฑ์</label></div><div class="form-check d-flex align-items-center gap-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="obj3" value="อื่นๆ" onchange="toggleOtherInput('obj3', 'objOtherText')"><label class="form-check-label text-nowrap" for="obj3">อื่น ๆ</label><input type="text" class="form-control form-control-sm w-50 border-light shadow-sm" id="objOtherText" placeholder="โปรดระบุ" disabled></div></div>
                    <div class="col-md-12 mt-4"><label class="form-label text-ci-bluegrey fw-bold small">สถานที่ <span class="req-star">*</span></label><div class="form-check mb-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="loc1" value="อาคารจอดรถ 1 (S2)"><label class="form-check-label" for="loc1">อาคารจอดรถ 1 (S2)</label></div><div class="form-check mb-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="loc2" value="โรงอาหาร (S14)"><label class="form-check-label" for="loc2">โรงอาหาร (S14)</label></div><div class="form-check d-flex align-items-center gap-2"><input class="form-check-input border-ci-bluegrey" type="checkbox" id="loc3" value="อื่นๆ" onchange="toggleOtherInput('loc3', 'locOtherText')"><label class="form-check-label text-nowrap" for="loc3">อื่น ๆ</label><input type="text" class="form-control form-control-sm w-50 border-light shadow-sm" id="locOtherText" placeholder="โปรดระบุสถานที่" disabled></div></div>
                    
                    <div class="col-md-12 mt-4"><label class="form-label text-ci-bluegrey fw-bold small">แนบรายละเอียดกิจกรรม <span class="req-star">*</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>
                    <div class="col-md-12 mt-2"><label class="form-label text-ci-bluegrey fw-bold small">แนบไฟล์เพิ่มเติม <span class="text-muted fw-normal">(ถ้ามี)</span></label><input type="file" class="form-control border-light shadow-sm" accept=".pdf, .jpg, .png"></div>
                    <div class="col-md-12 mt-2"><label class="form-label text-ci-bluegrey fw-bold small">ข้อความเสนอพิจารณา</label><textarea class="form-control border-light shadow-sm" rows="3" id="areaProposalNote" placeholder="ระบุรายละเอียดเพิ่มเติม..."></textarea></div>
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

                    <div class="col-md-12 mt-4"><label class="form-label text-ci-bluegrey fw-bold small">ข้อความเสนอพิจารณา</label><textarea class="form-control border-light shadow-sm" rows="3" id="contractProposalNote" placeholder="ระบุรายละเอียด หรือเหตุผลการเข้าพื้นที่..."></textarea></div>
                    
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
                    <div class="col-12 mt-4">
                        <div class="form-check">
                            <input class="form-check-input border-ci-bluegrey" type="checkbox" id="consentCheck">
                            <label class="form-check-label fw-bold text-dark" for="consentCheck">รับทราบและตกลงให้ความยินยอม (Consent)</label>
                        </div>
                    </div>
                </div>`;
            break;
    }
    container.innerHTML = formHTML;
    // กันเลือกวันที่ย้อนหลังตั้งแต่ตัวปฏิทิน (ตรวจซ้ำอีกชั้นใน validateCurrentForm)
    // ยกเว้นจอดค้างคืน — รองรับการขอย้อนหลัง (กรณีขอหลังเกิดเหตุ) จึงไม่ล็อก min
    container.querySelectorAll('input[type="date"]').forEach(input => {
        if (input.id === 'overnightStartDate' || input.id === 'overnightEndDate') return;
        input.min = getLocalTodayISO();
    });
    if (formName === 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์') {
        window.renderPlateActionFields();
    }
    // หมายเหตุ: การ gate ปุ่มส่งทำใน switchView (เรียกหลัง render เสมอ) เพื่อให้อ่าน active view ถูกตัว
}

// ปิดปุ่ม "ตรวจสอบและบันทึกคำขอ" จนกว่าจะติ๊กยินยอม (Consent) ในหน้าที่กำลังแสดง
function updateSubmitState() {
    const activeView = document.querySelector('.view-section.active');
    if (!activeView) return;
    const submitBtn = activeView.querySelector('.form-submit-btn');
    if (!submitBtn) return;
    const consent = activeView.querySelector('#consentCheck');
    // ฟอร์มไหนไม่มี consent ก็ปล่อยให้กดได้ตามปกติ
    submitBtn.disabled = consent ? !consent.checked : false;
}

// =========================================================
// Validation ฝั่งเว็บ — ตรวจทุกฟิลด์ก่อนเปิดหน้าสรุป
// =========================================================
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// ทะเบียนรถ: ตัวเลขและตัวอักษร (ไทย/อังกฤษ) เท่านั้น ห้ามเว้นวรรคหรืออักขระพิเศษ
const PLATE_PATTERN = /^[0-9A-Za-zก-๙]+$/;

function getLocalTodayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function clearValidationMarks() {
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    document.querySelectorAll('.bpuu-error-msg').forEach(el => el.remove());
}

function getDynamicFormContainer() {
    const inner = document.getElementById('dynamicFormSection');
    return inner && inner.innerHTML.trim() ? inner : document.getElementById('dynamicExternalFormSection');
}

function validateCurrentForm() {
    clearValidationMarks();
    const errors = [];
    const byId = id => document.getElementById(id);
    const val = id => (byId(id)?.value || '').trim();
    const fail = (target, msg) => {
        const el = typeof target === 'string' ? byId(target) : target;
        if (el) errors.push({ el, msg });
    };
    const need = (id, label) => { if (byId(id) && !val(id)) fail(id, `กรุณากรอก${label}`); };
    const needPick = (id, label) => { if (byId(id) && !val(id)) fail(id, `กรุณาเลือก${label}`); };
    const needEmail = (id, label, required) => {
        if (!byId(id)) return;
        const v = val(id);
        if (!v) { if (required) fail(id, `กรุณากรอก${label}`); return; }
        if (!EMAIL_PATTERN.test(v)) fail(id, `รูปแบบ${label}ไม่ถูกต้อง`);
    };
    const needPhone = (id, label, required) => {
        if (!byId(id)) return;
        const digits = val(id).replace(/\D/g, '');
        if (!digits) { if (required) fail(id, `กรุณากรอก${label}`); return; }
        if (!/^0\d{8,9}$/.test(digits)) fail(id, `${label}ต้องเป็นเบอร์โทรไทย 9-10 หลัก ขึ้นต้นด้วย 0`);
    };
    const needPlate = (id, label, required) => {
        if (!byId(id)) return;
        const v = val(id);
        if (!v) { if (required) fail(id, `กรุณากรอก${label}`); return; }
        if (!PLATE_PATTERN.test(v)) fail(id, `${label}ต้องมีเฉพาะตัวเลขและตัวอักษร (ห้ามเว้นวรรคหรืออักขระพิเศษ)`);
    };
    const needFile = (input, label) => {
        if (input && (!input.files || input.files.length === 0)) fail(input, `กรุณาแนบ${label}`);
    };
    const needFutureDate = (id, label) => {
        const v = val(id);
        if (v && v < getLocalTodayISO()) fail(id, `${label}ต้องไม่เป็นวันที่ย้อนหลัง`);
    };
    const needDateOrder = (startId, endId) => {
        const s = val(startId), e = val(endId);
        if (s && e && e < s) fail(endId, 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น');
    };
    const needTimeOrder = (dateStartId, dateEndId, timeStartId, timeEndId) => {
        const sameDay = !dateEndId || (val(dateStartId) && val(dateStartId) === val(dateEndId));
        if (sameDay && val(timeStartId) && val(timeEndId) && val(timeEndId) <= val(timeStartId)) {
            fail(timeEndId, 'เวลาสิ้นสุดต้องหลังเวลาเริ่มต้น');
        }
    };

    // ---------- ข้อมูลผู้ติดต่อ ----------
    if (currentLoginType === 'external') {
        need('extFname', 'ชื่อ');
        need('extLname', 'นามสกุล');
        need('extCompany', 'หน่วยงาน/บริษัท');
        needPhone('extPhone', 'เบอร์โทรศัพท์', true);
        needEmail('extEmail', 'อีเมล', true);
        const typeSection = byId('divExtType');
        if (typeSection && typeSection.style.display !== 'none') {
            const picked = byId('extType1')?.checked || byId('extType2')?.checked || byId('extType3')?.checked;
            if (!picked) fail(typeSection, 'กรุณาเลือกประเภทผู้ขอ');
            if (byId('extType3')?.checked && !val('extTypeOther')) fail('extTypeOther', 'กรุณาระบุประเภทผู้ขอ');
        }
    } else if (currentLoginType) {
        needPhone('reqPhone', 'เบอร์โทรติดต่อ', true);
        needEmail('reqEmail', 'อีเมล', true);
    }

    // ---------- รายละเอียดคำขอรายฟอร์ม ----------
    const dyn = getDynamicFormContainer();
    const files = dyn ? [...dyn.querySelectorAll('input[type="file"]')] : [];

    switch (currentSelectedForm) {
        case 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)': {
            needPlate('in_overnight_plate', 'ข้อมูลรถ', true);
            if (byId('overnightMultipleCars')?.checked) {
                const carCount = Number(val('overnightCarCount') || 0);
                for (let i = 1; i <= carCount; i++) {
                    need(`overnightCarFirstName${i}`, `ชื่อ (คันที่ ${i})`);
                    need(`overnightCarLastName${i}`, `สกุล (คันที่ ${i})`);
                    needPlate(`overnightCarPlate${i}`, `ทะเบียนรถ (คันที่ ${i})`, true);
                }
            }
            need('overnightStartDate', 'วันที่เริ่มต้น');
            need('overnightEndDate', 'วันที่สิ้นสุด');
            // จอดค้างคืนขอย้อนหลังได้ — ไม่บังคับว่าต้องเป็นวันที่ในอนาคต
            needDateOrder('overnightStartDate', 'overnightEndDate');
            needPick('overnightReason', 'เหตุผลการขอจอด');
            if (val('overnightReason')) {
                need('in_overnight_detail', 'รายละเอียดเพิ่มเติม');
                const fileDiv = byId('divReasonFile');
                if (fileDiv && fileDiv.style.display !== 'none') {
                    needFile(fileDiv.querySelector('input[type="file"]'), 'เอกสารประกอบการพิจารณา');
                }
            }
            break;
        }
        case 'แบบฟอร์มขอจอดรถรายเดือน': {
            if (byId('monthlyForOther')?.checked) {
                need('monthlyOtherName', 'ชื่อ-สกุล ผู้ใช้บริการจริง');
                needPhone('monthlyOtherPhone', 'เบอร์โทรผู้ใช้บริการจริง', true);
                needEmail('monthlyOtherEmail', 'อีเมลผู้ใช้บริการจริง', true);
            }
            needPlate('in_monthly_plate', 'ข้อมูลรถ', true);
            need('parkingStartDate', 'วันที่เริ่มต้น');
            needFutureDate('parkingStartDate', 'วันที่เริ่มต้น');
            needFile(byId('monthlyContractFile'), 'สัญญาจ้าง');
            break;
        }
        case 'แบบฟอร์มขอใช้ตราประทับ': {
            need('stampProjectUnitName', 'ชื่อโครงการ/หน่วยงาน');
            needPick('in_stamp_type', 'ประเภทผู้ใช้ตราประทับ');
            if (val('in_stamp_type') === 'อื่นๆ') need('in_stamp_other', 'ประเภทผู้ใช้ตราประทับ');
            need('stampStartDate', 'วันที่เริ่มต้น');
            need('stampEndDate', 'วันที่สิ้นสุด');
            needFutureDate('stampStartDate', 'วันที่เริ่มต้น');
            needDateOrder('stampStartDate', 'stampEndDate');
            need('stampUserName1', 'ชื่อ-สกุล ผู้ใช้ตราประทับ (คนที่ 1)');
            needEmail('stampUserEmail1', 'Email ผู้ใช้ตราประทับ (คนที่ 1)', true);
            // คนที่ 2 ไม่บังคับ แต่ถ้ากรอกช่องใดช่องหนึ่ง ต้องกรอกให้ครบทั้งคู่
            if (val('stampUserName2') || val('stampUserEmail2')) {
                need('stampUserName2', 'ชื่อ-สกุล ผู้ใช้ตราประทับ (คนที่ 2)');
                needEmail('stampUserEmail2', 'Email ผู้ใช้ตราประทับ (คนที่ 2)', true);
            }
            needFile(files[0], 'รายละเอียดเอกสาร');
            break;
        }
        case 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์': {
            if (!byId('plateActionCount')) break;
            const action = document.querySelector('input[name="plateAction"]:checked')?.value || '';
            const plateCount = Math.min(5, Math.max(1, Number(val('plateActionCount') || 1)));
            for (let i = 1; i <= plateCount; i++) {
                if (action === 'แก้ไข') {
                    needPlate(`plateOld${i}`, `ทะเบียนเดิม (คันที่ ${i})`, true);
                    needPlate(`plateNew${i}`, `ทะเบียนใหม่ (คันที่ ${i})`, true);
                } else {
                    needPlate(`plate${i}`, `ทะเบียนรถ (คันที่ ${i})`, true);
                }
            }
            break;
        }
        case 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว': {
            need('in_area_event', 'ชื่อกิจกรรม');
            needPlate('in_area_plate', 'ทะเบียนรถ', false); // ไม่บังคับ แต่ถ้ากรอกต้องถูกรูปแบบ
            need('areaStartDate', 'วันที่เริ่มต้น');
            need('areaEndDate', 'วันที่สิ้นสุด');
            need('areaStartTime', 'เวลาเริ่มต้น');
            need('areaEndTime', 'เวลาสิ้นสุด');
            const boothCount = Number(val('areaBoothCount') || 0);
            if (byId('areaBoothCount') && (!boothCount || boothCount < 1)) fail('areaBoothCount', 'กรุณาระบุจำนวนบูธอย่างน้อย 1 บูธ');
            needFutureDate('areaStartDate', 'วันที่เริ่มต้น');
            needDateOrder('areaStartDate', 'areaEndDate');
            needTimeOrder('areaStartDate', 'areaEndDate', 'areaStartTime', 'areaEndTime');
            const objPicked = byId('obj1')?.checked || byId('obj2')?.checked || byId('obj3')?.checked;
            if (!objPicked) fail(byId('obj1')?.closest('.col-md-12'), 'กรุณาเลือกวัตถุประสงค์อย่างน้อย 1 ข้อ');
            if (byId('obj3')?.checked) need('objOtherText', 'วัตถุประสงค์ (อื่น ๆ)');
            const locPicked = byId('loc1')?.checked || byId('loc2')?.checked || byId('loc3')?.checked;
            if (!locPicked) fail(byId('loc1')?.closest('.col-md-12'), 'กรุณาเลือกสถานที่อย่างน้อย 1 ข้อ');
            if (byId('loc3')?.checked) need('locOtherText', 'สถานที่ (อื่น ๆ)');
            needFile(files[0], 'รายละเอียดกิจกรรม');
            break;
        }
        case 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา': {
            needPlate('in_contract_plate', 'ทะเบียนรถ', false); // ไม่บังคับ แต่ถ้ากรอกต้องถูกรูปแบบ
            need('in_contract_date', 'วันที่เข้าพื้นที่');
            needFutureDate('in_contract_date', 'วันที่เข้าพื้นที่');
            need('in_contract_time_start', 'เวลาเริ่มต้น');
            need('in_contract_time_end', 'เวลาสิ้นสุด');
            // ไม่บังคับเวลาสิ้นสุด > เริ่มต้น: งานคู่สัญญาอาจคร่อมเที่ยงคืน (เช่น 22:00–04:00) แต่ฟอร์มมีวันที่เดียว
            needPick('contractCompany', 'ชื่อบริษัท');
            needPick('contractBusinessType', 'ประเภทธุรกิจ');
            needPick('contractCampus', 'พื้นที่การศึกษา');
            needPick('contractBuilding', 'อาคาร');
            needFile(files[0], 'เอกสารแนบ');
            break;
        }
        case 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ': {
            needPick('issueCategory', 'กลุ่มของปัญหา');
            need('issueDetail', 'รายละเอียดปัญหา');
            break;
        }
    }

    const consent = byId('consentCheck');
    if (consent && consent.type === 'checkbox' && !consent.checked) {
        fail(consent.closest('.form-check') || consent, 'กรุณาทำเครื่องหมายรับทราบและตกลงให้ความยินยอม');
    }

    if (!errors.length) return true;

    errors.forEach(({ el, msg }) => {
        el.classList.add('is-invalid');
        const note = document.createElement('div');
        note.className = 'bpuu-error-msg text-danger small fw-bold mt-1';
        note.textContent = msg;
        // วางท้ายแถว flex (.form-check) หรือ .input-group เพื่อให้ข้อความตกบรรทัดใหม่เสมอ
        (el.closest('.input-group') || el.closest('.form-check') || el).insertAdjacentElement('afterend', note);
    });
    const first = errors[0].el;
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof first.focus === 'function') setTimeout(() => first.focus({ preventScroll: true }), 350);
    return false;
}

// =========================================================
// Flow การ Submit ข้อมูล (Preview & Confirm)
// =========================================================
function showSummaryModal() {
    if (!validateCurrentForm()) return;

    let html = `<ul class="list-group list-group-flush small mb-3">`;
    const addRow = (label, value, valueClass = 'text-dark fw-bold') => {
        if(value && value !== '-- กรุณาระบุเหตุผล --' && value !== '-- กรุณาระบุประเภท --') {
            // หัวข้อกับข้อมูลอยู่บรรทัดเดียวกัน (label : value) เพื่อให้ q32_summary ในอีเมลอ่านง่าย
            html += `<li class="list-group-item px-0 bg-transparent border-light"><span class="fw-bold text-ci-bluegrey" style="font-size:0.8rem;">${label} : </span><span class="${valueClass}" style="white-space: pre-line;">${value}</span></li>`;
        }
    };

    html += `<h6 class="fw-bold text-ci-orange border-bottom border-ci-orange pb-2 mt-2">• ข้อมูลผู้ติดต่อ •</h6>`;
    if (currentLoginType === 'staff') {
        addRow('ประเภท', 'บุคลากร');
        addRow('ชื่อ-สกุล', document.getElementById('reqName').value, 'text-dark');
        addRow('ตำแหน่ง', document.getElementById('reqPosition').value);
        addRow('หน่วยงาน', document.getElementById('reqDeptCode').value.replace(/\s*\n\s*/g, ' '), 'text-dark');
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

    html += `</ul><p class="m-0"></p><h6 class="fw-bold text-ci-orange border-bottom border-ci-orange pb-2 mt-4">• รายละเอียดคำขอ •</h6><ul class="list-group list-group-flush small">`;
    
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
        const su1n = document.getElementById('stampUserName1')?.value;
        const su1e = document.getElementById('stampUserEmail1')?.value;
        if (su1n || su1e) addRow('ผู้ใช้ตราประทับ คนที่ 1', su1n && su1e ? `${su1n} (${su1e})` : (su1n || su1e));
        const su2n = document.getElementById('stampUserName2')?.value;
        const su2e = document.getElementById('stampUserEmail2')?.value;
        if (su2n || su2e) addRow('ผู้ใช้ตราประทับ คนที่ 2', su2n && su2e ? `${su2n} (${su2e})` : (su2n || su2e));
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
        addRow('จำนวนบูธ', document.getElementById('areaBoothCount')?.value);
        addRow('ข้อความเสนอพิจารณา', document.getElementById('areaProposalNote')?.value);
    }
    else if (currentSelectedForm === 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา') {
        addRow('ทะเบียนรถ', document.getElementById('in_contract_plate')?.value);
        addRow('วันที่เข้าพื้นที่', document.getElementById('in_contract_date')?.value);
        addRow('เวลา', (document.getElementById('in_contract_time_start')?.value || '') + " - " + (document.getElementById('in_contract_time_end')?.value || ''));
        addRow('บริษัท', document.getElementById('contractCompany')?.value);
        addRow('ประเภทธุรกิจ', document.getElementById('contractBusinessType')?.value);
        addRow('พื้นที่การศึกษา', document.getElementById('contractCampus')?.value);
        addRow('อาคาร', document.getElementById('contractBuilding')?.value);
        addRow('ข้อความเสนอพิจารณา', document.getElementById('contractProposalNote')?.value);
    }
    else if (currentSelectedForm === 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ') {
        let sel = document.getElementById('issueCategory');
        addRow('กลุ่มปัญหา', sel ? sel.options[sel.selectedIndex]?.text : "");
        addRow('รายละเอียด', document.getElementById('issueDetail')?.value);
    }

    html += `</ul>`;

    // โชว์ผู้อนุมัติสำหรับบุคลากร และกรณีนักศึกษาขอใช้ตราประทับ
    if (currentSelectedForm !== 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ' && (currentLoginType === 'staff' || (currentLoginType === 'student' && currentSelectedForm === 'แบบฟอร์มขอใช้ตราประทับ'))) {
        html += `<p class="m-0"></p><h6 class="fw-bold text-ci-orange border-bottom border-ci-orange pb-2 mt-4">• ผู้บังคับบัญชา •</h6><ul class="list-group list-group-flush small">`;
        html += `<li class="list-group-item px-0 bg-transparent border-light"><span class="text-dark fw-bold" style="white-space: pre-line;">${document.getElementById('appName').value}</span></li>`;
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

// แปลงค่า <input type="date"> (YYYY-MM-DD) เป็น sub-field ของ JotForm datetime
function dateFieldParts(qkey, isoDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((isoDate || '').trim());
    if (!m) return {};
    return { [`${qkey}[year]`]: m[1], [`${qkey}[month]`]: m[2], [`${qkey}[day]`]: m[3] };
}

// แปลงวันที่รูปแบบ DD/MM/YYYY (เช่น parkingEndDate ที่คำนวณอัตโนมัติ)
function dateFieldPartsFromDMY(qkey, dmyDate) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((dmyDate || '').trim());
    if (!m) return {};
    return { [`${qkey}[year]`]: m[3], [`${qkey}[month]`]: m[2].padStart(2, '0'), [`${qkey}[day]`]: m[1].padStart(2, '0') };
}

// รายละเอียดคำขอรายฟอร์ม → ฟิลด์โครงสร้าง q35–q66 (ค่า array = ส่งซ้ำหลายค่า เช่น checkbox)
function buildRequestDetailFields() {
    const f = {};

    if (currentLoginType === 'external' && document.getElementById('extType3')?.checked) {
        f.q35_externalTypeOther = getInputValue('extTypeOther');
    }

    switch (currentSelectedForm) {
        case 'แบบฟอร์มขอจอดรถรายเดือน': {
            f.q41_vehiclePlate = getInputValue('in_monthly_plate');
            Object.assign(f, dateFieldParts('q36_startDate', getInputValue('parkingStartDate')));
            Object.assign(f, dateFieldPartsFromDMY('q37_endDate', getInputValue('parkingEndDate')));
            if (currentLoginType === 'staff') {
                const isOther = document.getElementById('monthlyForOther')?.checked;
                f.q47_monthlyForWho = isOther ? 'ผู้อื่น' : 'ตนเอง';
                if (isOther) {
                    f.q48_actualUserName = getInputValue('monthlyOtherName');
                    f.q49_actualUserPhone = getInputValue('monthlyOtherPhone');
                    f.q50_actualUserEmail = getInputValue('monthlyOtherEmail');
                }
            }
            break;
        }
        case 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)': {
            f.q41_vehiclePlate = getInputValue('in_overnight_plate');
            Object.assign(f, dateFieldParts('q36_startDate', getInputValue('overnightStartDate')));
            Object.assign(f, dateFieldParts('q37_endDate', getInputValue('overnightEndDate')));
            f.q40_totalDays = getInputValue('overnightTotalDays');
            const reasonSel = document.getElementById('overnightReason');
            f.q44_requestReason = reasonSel && reasonSel.value ? reasonSel.options[reasonSel.selectedIndex].text : '';
            f.q45_requestDetail = getInputValue('in_overnight_detail');
            // ยอดประเมินกรณีไม่เข้าเงื่อนไขยกเว้น: 400 บาท/คัน/คืน (ตามประกาศฯ พ.ศ. 2562)
            const feeNights = Number(getInputValue('overnightTotalDays')) || 0;
            const feeCars = document.getElementById('overnightMultipleCars')?.checked
                ? (Number(getInputValue('overnightCarCount')) || 1) : 1;
            if (feeNights > 0) f.q67_estimatedFee = String(400 * feeCars * feeNights);
            if (document.getElementById('overnightMultipleCars')?.checked) {
                const carCount = Number(document.getElementById('overnightCarCount')?.value || 0);
                f.q43_vehicleCount = carCount ? String(carCount) : '';
                const carLines = [];
                for (let i = 1; i <= carCount; i++) {
                    const line = `${getInputValue('overnightCarFirstName' + i)} ${getInputValue('overnightCarLastName' + i)} ${getInputValue('overnightCarPlate' + i)}`.trim();
                    if (line) carLines.push(`คันที่ ${i}: ${line}`);
                }
                f.q42_vehicleList = carLines.join('\n');
            } else {
                f.q43_vehicleCount = '1';
            }
            break;
        }
        case 'แบบฟอร์มขอใช้ตราประทับ': {
            f.q51_stampRequestFor = document.getElementById('stampForUnit')?.checked ? 'หน่วยงาน' : (document.getElementById('stampForProject') ? 'โครงการ' : '');
            f.q52_stampProjectName = getInputValue('stampProjectUnitName');
            f.q53_stampUserType = document.getElementById('in_stamp_type')?.value || '';
            if (f.q53_stampUserType === 'อื่นๆ') {
                f.q54_stampUserTypeOther = getInputValue('in_stamp_other');
            }
            Object.assign(f, dateFieldParts('q36_startDate', getInputValue('stampStartDate')));
            Object.assign(f, dateFieldParts('q37_endDate', getInputValue('stampEndDate')));
            f.q40_totalDays = getInputValue('stampTotalDays');
            // ข้อมูลผู้ใช้ตราประทับ (ชื่อ-สกุล/อีเมล สูงสุด 2 คน) เก็บในรายละเอียดรวม q32_summary เท่านั้น
            // (สร้างผ่าน showSummaryModal) — ไม่สร้าง q-field ใหม่ใน JotForm เพื่อเลี่ยงปัญหา workflow แบบ q69
            break;
        }
        case 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์': {
            // path บุคลากร→IBGM ไม่ render ฟอร์มนี้ — ไม่มี element ก็ไม่ส่งฟิลด์
            if (!document.getElementById('plateActionCount')) break;
            const action = document.querySelector('input[name="plateAction"]:checked')?.value || '';
            const plateCount = Math.min(5, Math.max(1, Number(document.getElementById('plateActionCount')?.value || 1)));
            f.q55_plateAction = action;
            f.q43_vehicleCount = String(plateCount);
            const plateLines = [];
            for (let i = 1; i <= plateCount; i++) {
                if (action === 'แก้ไข') {
                    const oldPlate = getInputValue('plateOld' + i);
                    const newPlate = getInputValue('plateNew' + i);
                    if (oldPlate || newPlate) plateLines.push(`คันที่ ${i}: เดิม ${oldPlate || '-'} → ใหม่ ${newPlate || '-'}`);
                } else {
                    const plate = getInputValue('plate' + i);
                    if (plate) plateLines.push(`คันที่ ${i}: ${plate}`);
                }
            }
            f.q42_vehicleList = plateLines.join('\n');
            if (plateLines.length === 1 && action !== 'แก้ไข') {
                f.q41_vehiclePlate = getInputValue('plate1');
            }
            break;
        }
        case 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว': {
            f.q56_eventName = getInputValue('in_area_event');
            f.q41_vehiclePlate = getInputValue('in_area_plate');
            Object.assign(f, dateFieldParts('q36_startDate', getInputValue('areaStartDate')));
            Object.assign(f, dateFieldParts('q37_endDate', getInputValue('areaEndDate')));
            f.q38_startTime = getInputValue('areaStartTime');
            f.q39_endTime = getInputValue('areaEndTime');
            const boothCount = Number(getInputValue('areaBoothCount')) || 0;
            if (boothCount > 0) {
                f.q69_boothCount = String(boothCount);
                // ค่าบริการพื้นที่ชั่วคราว: บูธละ 1,000 บาท (ระบบคำนวณให้)
                f.q67_estimatedFee = String(1000 * boothCount);
            }
            const objs = [];
            if (document.getElementById('obj1')?.checked) objs.push('ประชาสัมพันธ์');
            if (document.getElementById('obj2')?.checked) objs.push('แจกผลิตภัณฑ์');
            if (document.getElementById('obj3')?.checked) {
                objs.push('อื่นๆ');
                f.q58_eventObjectiveOther = getInputValue('objOtherText');
            }
            if (objs.length) f['q57_eventObjectives[]'] = objs;
            const locs = [];
            if (document.getElementById('loc1')?.checked) locs.push('อาคารจอดรถ 1 (S2)');
            if (document.getElementById('loc2')?.checked) locs.push('โรงอาหาร (S14)');
            if (document.getElementById('loc3')?.checked) {
                locs.push('อื่นๆ');
                f.q60_eventLocationOther = getInputValue('locOtherText');
            }
            if (locs.length) f['q59_eventLocations[]'] = locs;
            f.q46_considerationNote = getInputValue('areaProposalNote');
            break;
        }
        case 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา': {
            f.q41_vehiclePlate = getInputValue('in_contract_plate');
            Object.assign(f, dateFieldParts('q36_startDate', getInputValue('in_contract_date')));
            f.q38_startTime = getInputValue('in_contract_time_start');
            f.q39_endTime = getInputValue('in_contract_time_end');
            f.q61_contractCompany = getInputValue('contractCompany');
            f.q62_contractBusinessType = getInputValue('contractBusinessType');
            f.q63_contractCampus = getInputValue('contractCampus');
            f.q64_contractBuilding = getInputValue('contractBuilding');
            f.q46_considerationNote = getInputValue('contractProposalNote');
            break;
        }
        case 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ': {
            f.q65_issueCategory = document.getElementById('issueCategory')?.value || '';
            f.q66_issueDetail = getInputValue('issueDetail');
            break;
        }
    }

    return f;
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
        q32_summary: summaryText,
        q68_opStatus: 'รอพิจารณา',
        ...buildRequestDetailFields()
    };
}

function appendSelectedFiles(form) {
    const fileInputs = [...document.querySelectorAll('.view-section.active input[type="file"]')]
        .filter(input => input.files && input.files.length > 0 && input.offsetParent !== null);

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

function submitToJotform(fieldOverrides = {}, options = {}) {
    if (!navigator.onLine) {
        alert('ไม่สามารถส่งคำขอได้เนื่องจากไม่ได้เชื่อมต่ออินเทอร์เน็ต กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง');
        return false;
    }
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

    Object.entries({ ...buildJotformSubmissionFields(), ...fieldOverrides }).forEach(([name, value]) => {
        if (Array.isArray(value)) {
            value.forEach(item => appendHiddenField(form, name, item));
        } else {
            appendHiddenField(form, name, value);
        }
    });
    appendSelectedFiles(form);

    let successShown = false;
    const completeSubmit = () => {
        if (successShown) return;
        successShown = true;
        if (!options.silent) showSubmitSuccess();
    };
    iframe.addEventListener('load', completeSubmit);
    document.body.appendChild(form);
    form.submit();
    setTimeout(completeSubmit, 4000);
    return true;
}

let isSubmittingRequest = false;
async function confirmSubmitForm() {
    if (isSubmittingRequest) return;
    isSubmittingRequest = true;
    if (submitToJotform() === false) {
        // ส่งไม่สำเร็จ (เช่น ออฟไลน์) — ปลดล็อกทันทีและคง modal ไว้ให้ลองใหม่
        isSubmittingRequest = false;
        return;
    }
    setTimeout(() => { isSubmittingRequest = false; }, 6000);
    summaryModalInstance.hide();
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
        if (fileDiv) {
            const hideFile = reasonVal === "1";
            fileDiv.style.display = hideFile ? 'none' : 'block';
            if (hideFile) {
                // เคลียร์ไฟล์ค้าง ไม่งั้นไฟล์ที่แนบไว้ก่อนสลับเหตุผลจะถูกอัปโหลดทั้งที่ช่องถูกซ่อน
                const staleFile = fileDiv.querySelector('input[type="file"]');
                if (staleFile) staleFile.value = '';
            }
        }
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

// =========================================================
// [DEMO ONLY] ปุ่ม Prefill — เติมข้อมูลตัวอย่างในฟิลด์ที่ยังว่าง
// เพื่อลดขั้นตอนการพิมพ์ระหว่างเดโม (ไฟล์แนบยังต้องเลือกเองตามจริง)
// ลบทั้งบล็อกนี้ + ปุ่มใน index.html เมื่อเลิกใช้ได้เลย
// =========================================================
window.prefillCurrentForm = function(evt) {
    const DEMO_PHONE = '0812345678';
    const byId = id => document.getElementById(id);

    const pfDateISO = offsetDays => {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    // เติมเฉพาะช่องที่ยังว่าง — ไม่ทับค่าที่ผู้ใช้กรอกไว้แล้ว
    const pfText = (id, value) => { const el = byId(id); if (el && !el.value) el.value = value; };
    const pfDate = (id, offsetDays) => {
        const el = byId(id);
        if (el && !el.value) { el.value = pfDateISO(offsetDays); el.dispatchEvent(new Event('change')); }
    };
    const pfTime = (id, value) => {
        const el = byId(id);
        if (el && !el.value) { el.value = value; el.dispatchEvent(new Event('change')); }
    };
    const pfCheck = id => { const el = byId(id); if (el && !el.checked) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); } };
    const pfRadioIfNone = (ids, pickId) => {
        if (!ids.some(id => byId(id)?.checked)) pfCheck(pickId);
    };
    const pfPickSelect = (id, handler) => {
        const sel = byId(id);
        if (!sel || sel.disabled || sel.value) return;
        const opt = [...sel.options].find(o => o.value && !o.disabled);
        if (!opt) return;
        sel.value = opt.value;
        if (handler) handler(); else sel.dispatchEvent(new Event('change'));
    };

    // สร้างไฟล์ตัวอย่างในหน่วยความจำ (รูป PNG วาดด้วย canvas) — ไม่ต้องเปิด file picker
    // จึงไม่เผยเอกสารในเครื่องระหว่างเดโม; ใช้ DataTransfer ยัดเข้า input เหมือนตอน submit
    const makeDemoImageFile = (label) => {
        const c = document.createElement('canvas');
        c.width = 800; c.height = 565;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#E87722'; ctx.fillRect(0, 0, c.width, 96);
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px sans-serif';
        ctx.fillText('เอกสารตัวอย่าง • DEMO DOCUMENT', 40, 60);
        ctx.fillStyle = '#333333'; ctx.font = '26px sans-serif';
        ctx.fillText(String(label || ''), 40, 180);
        ctx.fillText('สร้างอัตโนมัติสำหรับการสาธิตระบบ BPUU', 40, 230);
        ctx.strokeStyle = '#cccccc'; ctx.strokeRect(40, 280, 720, 240);
        const dataurl = c.toDataURL('image/png');
        const bstr = atob(dataurl.split(',')[1]);
        const u8 = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
        return new File([u8], 'เอกสารตัวอย่าง-เดโม.png', { type: 'image/png' });
    };
    const pfFile = (input, label) => {
        if (!input || (input.files && input.files.length)) return; // มีไฟล์อยู่แล้ว ไม่ทับ
        try {
            const dt = new DataTransfer();
            dt.items.add(makeDemoImageFile(label));
            input.files = dt.files;
            input.dispatchEvent(new Event('change'));
        } catch (e) { /* เบราว์เซอร์ไม่รองรับการตั้ง .files — ปล่อยให้แนบเอง */ }
    };

    // ---------- ส่วนที่ 1: ผู้ติดต่อ ----------
    if (currentLoginType === 'external') {
        pfText('extFname', 'สมชาย');
        pfText('extLname', 'ใจดี');
        pfText('extCompany', 'บริษัท เดโม จำกัด');
        pfText('extPhone', DEMO_PHONE);
        pfText('extEmail', 'demo.guest@example.com');
        if (byId('divExtType') && byId('divExtType').style.display !== 'none') {
            pfRadioIfNone(['extType1', 'extType2', 'extType3'], 'extType1');
        }
    } else if (currentLoginType) {
        pfText('reqPhone', DEMO_PHONE);
        pfText('reqEmail', 'demo.user@kmutt.ac.th'); // ปกติดึงอัตโนมัติแล้ว เผื่อกรณีว่าง
    }

    // ---------- ส่วนรายละเอียดคำขอ ----------
    switch (currentSelectedForm) {
        case 'แบบฟอร์มขอจอดรถค้างคืน (อาคารจอดรถ S2)':
            pfText('in_overnight_plate', '1กข2345');
            pfDate('overnightStartDate', 1);
            pfDate('overnightEndDate', 2);
            pfPickSelect('overnightReason'); // staff/student = "ไปราชการ" (ไม่ต้องแนบไฟล์), external = "เหตุสุดวิสัย"
            pfText('in_overnight_detail', 'รายละเอียดเหตุผลสำหรับการเดโม');
            break;

        case 'แบบฟอร์มขอจอดรถรายเดือน':
            pfText('in_monthly_plate', '1กข2345');
            pfDate('parkingStartDate', 3); // dispatch change → คำนวณวันสิ้นสุดอัตโนมัติ
            break;

        case 'แบบฟอร์มขอใช้ตราประทับ':
            pfText('stampProjectUnitName', 'โครงการตัวอย่างสำหรับเดโม');
            pfPickSelect('in_stamp_type');
            pfDate('stampStartDate', 3);
            pfDate('stampEndDate', 5);
            pfText('stampUserName1', 'สมชาย ใจดี');
            pfText('stampUserEmail1', 'demo.stamp@kmutt.ac.th');
            break;

        case 'แบบฟอร์มขอเพิ่ม/แก้ไข/ยกเลิกทะเบียนรถยนต์': {
            const action = document.querySelector('input[name="plateAction"]:checked')?.value || 'เพิ่ม';
            const count = Math.min(5, Math.max(1, Number(byId('plateActionCount')?.value || 1)));
            for (let i = 1; i <= count; i++) {
                if (action === 'แก้ไข') {
                    pfText(`plateOld${i}`, `1กข${1000 + i}`);
                    pfText(`plateNew${i}`, `2ขค${2000 + i}`);
                } else {
                    pfText(`plate${i}`, `1กข${1000 + i}`);
                }
            }
            break;
        }

        case 'แบบฟอร์มขอใช้พื้นที่ชั่วคราว':
            pfText('in_area_event', 'กิจกรรมประชาสัมพันธ์ (เดโม)');
            pfDate('areaStartDate', 3);
            pfDate('areaEndDate', 3);
            pfTime('areaStartTime', '09:00');
            pfTime('areaEndTime', '16:00');
            pfText('areaBoothCount', '1');
            pfCheck('obj1');
            pfCheck('loc1');
            break;

        case 'แบบฟอร์มขอเข้าพื้นที่คู่สัญญา': {
            pfDate('in_contract_date', 3);
            pfTime('in_contract_time_start', '09:00');
            pfTime('in_contract_time_end', '16:00');
            // dropdown แบบลูกโซ่ (บริษัท→ประเภท→พื้นที่→อาคาร) — เลือกจาก "แถวที่มีครบทั้ง 4 ชั้น"
            // ไม่งั้นการไล่ option แรกแต่ละชั้นอาจตันที่ชั้นอาคาร (บางสายไม่มีอาคารต่อ)
            const companySel = byId('contractCompany');
            if (companySel && !companySel.value) {
                if (![...companySel.options].some(o => o.value)) window.initContractDropdowns?.();
                const row = contractDatabase.find(r => r && r[7] && r[5] && r[1] && r[3]
                    && r[7] !== 'ชื่อบริษัท' && r[7] !== 'CompanyName');
                if (row) {
                    companySel.value = row[7]; window.onCompanyChange();
                    byId('contractBusinessType').value = row[5]; window.onBusinessTypeChange();
                    byId('contractCampus').value = row[1]; window.onCampusChange();
                    byId('contractBuilding').value = row[3];
                } else {
                    pfPickSelect('contractCompany', window.onCompanyChange);
                    pfPickSelect('contractBusinessType', window.onBusinessTypeChange);
                    pfPickSelect('contractCampus', window.onCampusChange);
                    pfPickSelect('contractBuilding');
                }
            } else if (companySel) {
                // ผู้ใช้เลือกบริษัทไว้แล้ว — เติมชั้นที่เหลือแบบ best-effort
                pfPickSelect('contractBusinessType', window.onBusinessTypeChange);
                pfPickSelect('contractCampus', window.onCampusChange);
                pfPickSelect('contractBuilding');
            }
            break;
        }

        case 'แจ้งปัญหาการใช้งานพื้นที่/ที่จอดรถ':
            pfPickSelect('issueCategory');
            pfText('issueDetail', 'รายละเอียดปัญหาสำหรับการเดโม');
            break;
    }

    // เติมไฟล์ตัวอย่างให้ทุกช่องแนบไฟล์ที่ "มองเห็น" และ "ยังว่าง" ในหน้าปัจจุบัน
    // (ทั้งช่องบังคับและไม่บังคับ) เพื่อไม่ต้องกด Choose File เองเลยระหว่างเดโม
    [...document.querySelectorAll('.view-section.active input[type="file"]')]
        .filter(inp => inp.offsetParent !== null && !(inp.files && inp.files.length))
        .forEach(inp => pfFile(inp, currentSelectedForm));

    pfCheck('consentCheck');
    clearValidationMarks(); // ล้างกรอบแดงจากการ submit ที่ค้างไว้ก่อนหน้า

    // feedback สั้น ๆ ที่ปุ่ม
    const btn = evt?.currentTarget;
    if (btn) {
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>เติมแล้ว';
        btn.classList.add('btn-success');
        btn.classList.remove('btn-warning');
        setTimeout(() => { btn.innerHTML = original; btn.classList.add('btn-warning'); btn.classList.remove('btn-success'); }, 1200);
    }
};
