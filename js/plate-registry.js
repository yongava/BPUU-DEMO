window.BPUU_PLATE_REGISTRY = (() => {
    const STORAGE_KEY = 'bpuu-plate-registry';
    const HISTORY_KEY = 'bpuu-plate-registry-history';
    const MAX_HISTORY_ITEMS = 100;

    function normalizePlate(value) {
        return String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
    }

    function loadJson(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function saveJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            // No-op in restricted storage environments.
        }
    }

    function loadRegistry() {
        return loadJson(STORAGE_KEY)
            .map(item => ({
                plate: normalizePlate(item.plate),
                requesterName: String(item.requesterName || '').trim(),
                requesterType: String(item.requesterType || '').trim(),
                action: String(item.action || '').trim(),
                sourceTicketId: String(item.sourceTicketId || '').trim(),
                note: String(item.note || '').trim(),
                updatedAt: String(item.updatedAt || '').trim(),
                status: String(item.status || 'active').trim() || 'active'
            }))
            .filter(item => item.plate);
    }

    function saveRegistry(registry) {
        saveJson(STORAGE_KEY, registry);
    }

    function loadHistory() {
        return loadJson(HISTORY_KEY);
    }

    function saveHistory(history) {
        saveJson(HISTORY_KEY, history.slice(0, MAX_HISTORY_ITEMS));
    }

    function addHistoryEntry(entry) {
        const history = loadHistory();
        history.unshift({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: new Date().toISOString(),
            ...entry
        });
        saveHistory(history);
    }

    function recordPlateAction(action, payload) {
        addHistoryEntry({ action, ...payload });
    }

    function upsertPlate(entry, meta = {}) {
        const plate = normalizePlate(entry?.plate);
        if (!plate) return false;

        const registry = loadRegistry();
        const updatedAt = meta.updatedAt || new Date().toISOString();
        const nextEntry = {
            plate,
            requesterName: String(entry.requesterName || meta.requesterName || '').trim(),
            requesterType: String(entry.requesterType || meta.requesterType || '').trim(),
            action: String(entry.action || meta.action || '').trim(),
            sourceTicketId: String(entry.sourceTicketId || meta.sourceTicketId || '').trim(),
            note: String(entry.note || meta.note || '').trim(),
            updatedAt,
            status: 'active'
        };
        const index = registry.findIndex(item => item.plate === plate);

        if (index === -1) {
            registry.unshift(nextEntry);
        } else {
            registry[index] = { ...registry[index], ...nextEntry };
        }

        saveRegistry(registry);
        recordPlateAction('upsert', { plate, ...nextEntry });
        return true;
    }

    function removePlate(plate, meta = {}) {
        const normalized = normalizePlate(plate);
        if (!normalized) return false;

        const registry = loadRegistry();
        const nextRegistry = registry.filter(item => item.plate !== normalized);
        if (nextRegistry.length === registry.length) return false;

        saveRegistry(nextRegistry);
        recordPlateAction('remove', {
            plate: normalized,
            requesterName: String(meta.requesterName || '').trim(),
            requesterType: String(meta.requesterType || '').trim(),
            action: String(meta.action || '').trim(),
            sourceTicketId: String(meta.sourceTicketId || '').trim(),
            note: String(meta.note || '').trim(),
            updatedAt: meta.updatedAt || new Date().toISOString()
        });
        return true;
    }

    function clearRegistry() {
        saveRegistry([]);
        saveHistory([]);
    }

    function applyTicket(ticket) {
        if (!ticket || ticket.typeKey !== 'plate') {
            return { changed: false, appliedCount: 0 };
        }

        const request = ticket.plateRequest || {};
        const action = String(request.action || ticket.plateAction || '').trim();
        const items = Array.isArray(request.items) ? request.items : [];
        let changed = false;
        let appliedCount = 0;
        const baseMeta = {
            requesterName: ticket.requesterName || '',
            requesterType: ticket.requesterType || '',
            sourceTicketId: ticket.ticketId || '',
            updatedAt: new Date().toISOString(),
            note: ticket.note || ''
        };

        if (action === 'แก้ไข') {
            items.forEach(item => {
                const oldPlate = normalizePlate(item?.oldPlate);
                const newPlate = normalizePlate(item?.newPlate);
                if (oldPlate) {
                    changed = removePlate(oldPlate, { ...baseMeta, action }) || changed;
                    appliedCount += 1;
                }
                if (newPlate) {
                    changed = upsertPlate({
                        plate: newPlate,
                        requesterName: baseMeta.requesterName,
                        requesterType: baseMeta.requesterType,
                        action,
                        sourceTicketId: baseMeta.sourceTicketId,
                        note: `แก้ไขจาก ${oldPlate || '-'}${oldPlate && newPlate ? ' → ' : ''}${newPlate}`
                    }, baseMeta) || changed;
                    appliedCount += 1;
                }
            });
        } else if (action === 'ยกเลิก') {
            items.forEach(item => {
                const plate = normalizePlate(item?.plate);
                if (!plate) return;
                changed = removePlate(plate, { ...baseMeta, action }) || changed;
                appliedCount += 1;
            });
        } else {
            items.forEach(item => {
                const plate = normalizePlate(item?.plate);
                if (!plate) return;
                changed = upsertPlate({
                    plate,
                    requesterName: baseMeta.requesterName,
                    requesterType: baseMeta.requesterType,
                    action: action || 'เพิ่ม',
                    sourceTicketId: baseMeta.sourceTicketId,
                    note: `เพิ่มทะเบียนจาก ticket ${baseMeta.sourceTicketId}`
                }, baseMeta) || changed;
                appliedCount += 1;
            });
        }

        return { changed, appliedCount };
    }

    return {
        STORAGE_KEY,
        HISTORY_KEY,
        normalizePlate,
        loadRegistry,
        saveRegistry,
        loadHistory,
        clearRegistry,
        upsertPlate,
        removePlate,
        applyTicket
    };
})();
