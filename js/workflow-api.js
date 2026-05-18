(function () {
    const DEFAULT_ENDPOINT = '/api/workflow-tickets';
    const STORAGE_KEY = 'bpuu-workflow-tickets';
    const LEGACY_KEYS = ['bpuu-admin-tickets'];
    const PING_KEY = `${STORAGE_KEY}-updated-at`;
    const CHANNEL_NAME = 'bpuu-workflow-tickets';

    const config = window.BPUU_WORKFLOW_TEST_CONFIG || {};
    const endpoint = String(config.workflowApiEndpoint || config.workflowApi?.endpoint || DEFAULT_ENDPOINT).trim();

    const state = {
        cache: [],
        loaded: false
    };

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function normalizeTicket(ticket) {
        const copy = clone(ticket) || {};
        if (copy.ticketId != null) copy.ticketId = String(copy.ticketId).trim();
        return copy;
    }

    function isSeedTicket(ticket) {
        const match = String(ticket?.ticketId || '').match(/^REQ-(\d{4})-(\d{4})$/);
        if (!match) return false;
        return Number(match[2]) <= 14;
    }

    function readLocalTickets() {
        const keys = [STORAGE_KEY, ...LEGACY_KEYS];
        for (const key of keys) {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.map(item => normalizeTicket(item));
                }
            } catch (error) {
                // Try the next fallback key.
            }
        }
        return [];
    }

    function clearLocalTickets() {
        [STORAGE_KEY, ...LEGACY_KEYS].forEach(key => {
            try {
                localStorage.removeItem(key);
            } catch (error) {
                // Ignore storage errors.
            }
        });
    }

    function saveLocalTickets(tickets) {
        const payload = Array.isArray(tickets) ? tickets.map(item => normalizeTicket(item)) : [];
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
            LEGACY_KEYS.forEach(key => {
                try {
                    localStorage.removeItem(key);
                } catch (error) {
                    // Ignore storage errors.
                }
            });
        } catch (error) {
            // LocalStorage may be unavailable in restricted environments.
        }
        replaceCache(payload);
        notifyChanged();
        return clone(state.cache);
    }

    function notifyChanged() {
        try {
            localStorage.setItem(PING_KEY, new Date().toISOString());
        } catch (error) {
            // Storage may be unavailable, but BroadcastChannel can still notify open tabs.
        }

        try {
            const channel = new BroadcastChannel(CHANNEL_NAME);
            channel.postMessage({ type: 'tickets-updated', at: new Date().toISOString() });
            channel.close();
        } catch (error) {
            // Older browsers can rely on the localStorage ping above.
        }
    }

    async function requestJson(method, payload = null, query = '') {
        const url = `${endpoint}${query}`;
        const response = await fetch(url, {
            method,
            headers: payload ? { 'Content-Type': 'application/json' } : undefined,
            body: payload ? JSON.stringify(payload) : undefined
        });

        const text = await response.text().catch(() => '');
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (error) {
                data = { raw: text };
            }
        }

        if (!response.ok) {
            const message = data?.error || data?.message || text || `HTTP ${response.status}`;
            throw new Error(message);
        }

        return data;
    }

    function replaceCache(tickets) {
        state.cache = Array.isArray(tickets) ? tickets.map(item => normalizeTicket(item)) : [];
        state.loaded = true;
        return clone(state.cache);
    }

    async function listTickets(options = {}) {
        const force = Boolean(options.force);
        const allowImport = options.allowImport !== false;

        if (!force && state.loaded) {
            return clone(state.cache);
        }

        try {
            const data = await requestJson('GET');
            const remoteTickets = Array.isArray(data?.tickets) ? data.tickets.map(item => normalizeTicket(item)) : [];
            replaceCache(remoteTickets);

            if (allowImport && !remoteTickets.length) {
                const localTickets = readLocalTickets().filter(ticket => !isSeedTicket(ticket));
                if (localTickets.length) {
                    const imported = await replaceTickets(localTickets);
                    return imported;
                }
            }

            return clone(state.cache);
        } catch (error) {
            const localTickets = readLocalTickets().filter(ticket => !isSeedTicket(ticket));
            if (localTickets.length) {
                return saveLocalTickets(localTickets);
            }
            state.loaded = true;
            state.cache = [];
            return [];
        }
    }

    async function getTicket(ticketId) {
        const id = String(ticketId || '').trim();
        if (!id) return null;
        const tickets = await listTickets();
        return tickets.find(ticket => ticket.ticketId === id) || null;
    }

    async function upsertTicket(ticket) {
        const payload = normalizeTicket(ticket);
        try {
            const data = await requestJson('POST', { ticket: payload });
            const saved = normalizeTicket(data?.ticket || payload);
            const nextCache = state.cache.filter(item => item.ticketId !== saved.ticketId);
            nextCache.unshift(saved);
            replaceCache(nextCache);
            notifyChanged();
            return clone(saved);
        } catch (error) {
            const existing = readLocalTickets();
            const nextCache = existing.filter(item => item.ticketId !== payload.ticketId);
            const saved = normalizeTicket(payload);
            nextCache.unshift(saved);
            return saveLocalTickets(nextCache).find(item => item.ticketId === saved.ticketId) || clone(saved);
        }
    }

    async function patchTicket(ticketId, patch) {
        const existing = await getTicket(ticketId);
        if (!existing) {
            throw new Error(`Ticket not found: ${ticketId}`);
        }
        return upsertTicket({ ...existing, ...(patch || {}), ticketId: existing.ticketId });
    }

    async function replaceTickets(tickets) {
        const payload = Array.isArray(tickets) ? tickets.map(item => normalizeTicket(item)) : [];
        try {
            const data = await requestJson('PUT', { tickets: payload });
            const savedTickets = Array.isArray(data?.tickets) ? data.tickets.map(item => normalizeTicket(item)) : payload;
            replaceCache(savedTickets);
            clearLocalTickets();
            notifyChanged();
            return clone(state.cache);
        } catch (error) {
            return saveLocalTickets(payload);
        }
    }

    window.BPUU_WORKFLOW_API = {
        endpoint,
        listTickets,
        getTicket,
        upsertTicket,
        patchTicket,
        replaceTickets,
        notifyChanged
    };
})();
