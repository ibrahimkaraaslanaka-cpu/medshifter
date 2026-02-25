/**
 * Med Shifter - Vardiya Planlama Uygulaması
 * ==========================================
 * Full wizard integration with 5-step flow
 */

// ============================================
// Supabase Client (initialized in config.js or here as fallback)
// ============================================
const supabaseClient = window.supabaseClient || window.supabase?.createClient(
    window.AppConfig?.SUPABASE_URL,
    window.AppConfig?.SUPABASE_ANON_KEY
);

// (Auth check is handled in init() via Supabase session detection)

// ============================================
// State Management
// ============================================
const state = {
    // Wizard state
    currentStep: 1,

    // Date selection
    selectedMonth: new Date().getMonth(),
    selectedYear: new Date().getFullYear(),

    // Schedule title
    scheduleTitle: '',

    // People
    people: [],

    // Shift delays (Step 3) - date string -> array of people
    shiftDelays: {},
    selectedPerson: null, // For drag-and-drop in Step 3

    // Schedule data
    schedule: [],
    workAreas: [
        { id: 1, name: 'Çalışma Alanı 1' },
        { id: 2, name: 'Çalışma Alanı 2' },
        { id: 3, name: 'Çalışma Alanı 3' }
    ],
    nextWorkAreaId: 4,
    showNobetErtesi: true,
    includeWeekends: false,

    // Conditions (legacy text-based)
    aiConditions: '',

    // New structured constraints (v2)
    constraints: {
        personAreaRules: [],  // { person, allowed, preferred, blocked }
        dayOffRules: [],      // { person, dates, weekdays }
        pairRules: []         // { person1, person2, type }
    },
    apiKey: '',

    // Versions
    calendarVersions: [],
    activeVersionIndex: -1, // -1 = current/unsaved
    hasUnsavedChanges: false,

    // Calendar metadata for future user accounts
    calendarId: null,
    createdAt: null,
    updatedAt: null,
};

// ============================================
// API Client & Auth State
// ============================================
// API URL from centralized config (auto-detects environment)
const API_URL = window.AppConfig?.API_URL || 'http://localhost:3001/api';

const AuthState = {
    token: null,
    user: null,
    usage: null,

    isLoggedIn() {
        return !!this.token;
    },

    setAuth(token, user, usage) {
        this.token = token;
        this.user = user;
        this.usage = usage;
    },

    clear() {
        this.token = null;
        this.user = null;
        this.usage = null;
        if (supabaseClient) {
            supabaseClient.auth.signOut();
        }
    },

    updateUsage(usage) {
        this.usage = usage;
    },

    // Initialize from Supabase session
    async initFromSession() {
        if (!supabaseClient) return;
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            this.token = session.access_token;
            // user/usage will be loaded from /auth/me
        }
    }
};

const ApiClient = {
    async getAccessToken() {
        if (!supabaseClient) return AuthState.token;
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            AuthState.token = session.access_token;
            return session.access_token;
        }
        return null;
    },

    async request(endpoint, options = {}) {
        const token = await this.getAccessToken();

        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await fetch(`${API_URL}${endpoint}`, {
                ...options,
                headers
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) {
                    AuthState.clear();
                    window.location.href = '/login?message=auth_required';
                }
                throw new Error(data.error || 'İstek başarısız');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    async getMe() {
        return this.request('/auth/me');
    },

    async getUsage() {
        return this.request('/user/usage');
    },

    async getCalendars() {
        return this.request('/calendars');
    },

    async getCalendar(id) {
        return this.request(`/calendars/${id}`);
    },

    async createCalendar(data) {
        return this.request('/calendars', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateCalendar(id, data, { skipCounter = false } = {}) {
        const qs = skipCounter ? '?skipCounter=true' : '';
        return this.request(`/calendars/${id}${qs}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteCalendar(id) {
        return this.request(`/calendars/${id}`, {
            method: 'DELETE'
        });
    },

    async trackExport(id) {
        return this.request(`/calendars/${id}/export`, {
            method: 'POST'
        });
    }
};

// Check if user has limits available
function checkUserLimits(action = 'create') {
    if (!AuthState.isLoggedIn() || !AuthState.usage) return true;

    const { usage, remaining, limits } = AuthState.usage;

    switch (action) {
        case 'create':
            if (remaining.calendars <= 0) {
                const planName = AuthState.usage.plan === 'FREE' ? 'Ücretsiz' : AuthState.usage.plan;
                Toast.error(`Takvim oluşturma limitinize ulaştınız! ${planName} planda ${limits.calendarsPerMonth} takvim hakkınız var. Planınızı yükseltin.`);
                return false;
            }
            break;
        case 'save':
        case 'version':
            if (remaining.versions <= 0) {
                const planName = AuthState.usage.plan === 'FREE' ? 'Ücretsiz' : AuthState.usage.plan;
                Toast.error(`Versiyon kaydetme limitinize ulaştınız! ${planName} planda ${limits.versionsPerMonth} versiyon hakkınız var.`);
                return false;
            }
            break;
        case 'export':
            // Exports currently not limited
            break;
    }
    return true;
}

// Turkish constants
const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const shortDayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const monthNames = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];


// Helper function to get month name from index
function getMonthName(monthIndex) {
    return monthNames[monthIndex] || '';
}

// ============================================
// Modal System
// ============================================
const Modal = {
    overlay: null,
    resolveCallback: null,

    init() {
        this.overlay = document.getElementById('modalOverlay');
        if (!this.overlay) return;

        document.getElementById('modalConfirm').onclick = () => this.close(true);
        document.getElementById('modalCancel').onclick = () => this.close(false);

        this.overlay.onclick = (e) => {
            if (e.target === this.overlay) this.close(false);
        };

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.overlay.style.display !== 'none') {
                this.close(false);
            }
            if (e.key === 'Enter' && this.overlay.style.display !== 'none') {
                this.close(true);
            }
        });
    },

    show({ type = 'alert', title = 'Bilgi', message = '', icon = 'ℹ️', placeholder = '' }) {
        return new Promise((resolve) => {
            this.resolveCallback = resolve;

            document.getElementById('modalIcon').textContent = icon;
            document.getElementById('modalTitle').textContent = title;
            document.getElementById('modalMessage').textContent = message;

            const input = document.getElementById('modalInput');
            const cancelBtn = document.getElementById('modalCancel');

            if (type === 'prompt') {
                input.style.display = 'block';
                input.value = '';
                input.placeholder = placeholder;
                cancelBtn.style.display = 'inline-block';
                setTimeout(() => input.focus(), 100);
            } else if (type === 'confirm') {
                input.style.display = 'none';
                cancelBtn.style.display = 'inline-block';
            } else {
                input.style.display = 'none';
                cancelBtn.style.display = 'none';
            }

            this.overlay.style.display = 'flex';
        });
    },

    close(confirmed) {
        const input = document.getElementById('modalInput');
        let result;

        if (input.style.display !== 'none') {
            result = confirmed ? input.value : null;
        } else {
            result = confirmed;
        }

        this.overlay.style.display = 'none';

        if (this.resolveCallback) {
            this.resolveCallback(result);
            this.resolveCallback = null;
        }
    },

    alert(message, icon = '✅') {
        return this.show({ type: 'alert', title: 'Bilgi', message, icon });
    },

    confirm(message, icon = '⚠️') {
        return this.show({ type: 'confirm', title: 'Onay', message, icon });
    },

    prompt(message, placeholder = '', icon = '✏️') {
        return this.show({ type: 'prompt', title: 'Giriş', message, icon, placeholder });
    },

    success(message) {
        return this.show({ type: 'alert', title: 'Başarılı', message, icon: '✅' });
    },

    error(message) {
        return this.show({ type: 'alert', title: 'Hata', message, icon: '❌' });
    },

    warning(message) {
        return this.show({ type: 'alert', title: 'Uyarı', message, icon: '⚠️' });
    }
};

// ============================================
// Toast System
// ============================================
const Toast = {
    container: null,

    init() {
        this.container = document.getElementById('toastContainer');
    },

    show(message, type = 'info', duration = 3000) {
        if (!this.container) this.init();
        if (!this.container) return;

        const colors = {
            success: 'var(--success)',
            error: 'var(--danger)',
            warning: 'var(--warning)',
            info: 'var(--primary)'
        };

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderLeft = `4px solid ${colors[type]}`;
        toast.textContent = message;
        this.container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);

        return toast;
    },

    success(msg, dur = 3000) { return this.show(msg, 'success', dur); },
    error(msg, dur = 4000) { return this.show(msg, 'error', dur); },
    warning(msg, dur = 4000) { return this.show(msg, 'warning', dur); },
    info(msg, dur = 3000) { return this.show(msg, 'info', dur); }
};

// ============================================
// Constraint System - Koşul Motoru
// ============================================
const ConstraintEngine = {
    // Parsed constraints storage
    constraints: {
        positiveAssignments: [],
        negativeAssignments: [],
        leaveConstraints: [],
        pairConstraints: [],
        areaRestrictions: [],
        neverEmptyAreas: [],
        preferences: [],
        emptyAreaDays: []      // NEW: areas that should be empty on specific days
    },

    // Day name mappings
    dayNameMap: {
        'pazartesi': 1, 'salı': 2, 'çarşamba': 3, 'perşembe': 4, 'cuma': 5,
        'cumartesi': 6, 'pazar': 0
    },

    /**
     * Get week number for a date within the month
     */
    getWeekNumber(date) {
        const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
        const dayOfMonth = date.getDate();
        const firstDayOfWeek = firstDay.getDay();
        return Math.ceil((dayOfMonth + firstDayOfWeek - 1) / 7);
    },

    /**
     * Main parse function - calls Gemini AI API to parse constraints
     * Falls back to local regex if API fails
     */
    async parseConstraints(conditionsText) {
        // Reset constraints
        this.constraints = {
            positiveAssignments: [],
            negativeAssignments: [],
            leaveConstraints: [],
            pairConstraints: [],
            areaRestrictions: [],
            neverEmptyAreas: [],
            preferences: [],
            emptyAreaDays: []
        };

        if (!conditionsText || !conditionsText.trim()) {
            return this.constraints;
        }

        try {
            // Try AI-powered parsing via backend
            const token = await ApiClient.getAccessToken();
            if (!token) {
                console.warn('No auth token, falling back to local parse');
                return this._localParse(conditionsText);
            }

            const scheduleDates = state.schedule.map(d => d.date.toISOString());

            const response = await fetch(`${API_URL}/ai/parse-conditions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    conditionsText,
                    people: state.people,
                    workAreas: state.workAreas,
                    scheduleDates
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                if (errorData.fallback) {
                    console.warn('AI service unavailable, falling back to local parse');
                    return this._localParse(conditionsText);
                }
                throw new Error(errorData.error || 'AI parse failed');
            }

            const data = await response.json();
            console.log('🤖 Gemini parsed constraints:', data);

            // Convert Gemini response to internal format
            this._convertGeminiConstraints(data.constraints || []);

            // Store AI summary for display
            this._aiSummary = data.summary || '';

            return this.constraints;

        } catch (error) {
            console.error('AI parsing failed, falling back to local:', error);
            Toast.warning('AI koşul analizi başarısız oldu, yerel analiz kullanılıyor.');
            return this._localParse(conditionsText);
        }
    },

    /**
     * Convert Gemini AI constraint format to internal ConstraintEngine format
     */
    _convertGeminiConstraints(geminiConstraints) {
        for (const c of geminiConstraints) {
            switch (c.type) {
                case 'block_person_from_area':
                    this.constraints.negativeAssignments.push({
                        type: 'never',
                        person: c.person,
                        workAreaId: c.areaId,
                        original: c.original || `${c.person} alan ${c.areaId}'de çalışmasın`
                    });
                    break;

                case 'prefer_person_in_area':
                    this.constraints.preferences.push({
                        person: c.person,
                        workAreaId: c.areaId,
                        original: c.original || `${c.person} mümkünse alan ${c.areaId}'de`
                    });
                    break;

                case 'force_person_to_area':
                    // Force = positive assignment for ALL days
                    this.constraints.positiveAssignments.push({
                        type: 'always',
                        person: c.person,
                        workAreaId: c.areaId,
                        original: c.original || `${c.person} her zaman alan ${c.areaId}'de`
                    });
                    break;

                case 'force_person_to_area_on_days':
                    for (const dow of (c.daysOfWeek || [])) {
                        this.constraints.positiveAssignments.push({
                            type: 'day',
                            person: c.person,
                            workAreaId: c.areaId,
                            dayOfWeek: dow,
                            original: c.original || `${c.person} belirli günlerde alan ${c.areaId}'de`
                        });
                    }
                    break;

                case 'person_day_off':
                    // Convert day-based off to leave constraints with actual dates
                    const daysOff = c.daysOfWeek || [];
                    const offDates = [];
                    state.schedule.forEach(day => {
                        if (daysOff.includes(day.date.getDay())) {
                            offDates.push(new Date(day.date));
                        }
                    });
                    if (offDates.length > 0) {
                        this.constraints.leaveConstraints.push({
                            person: c.person,
                            dates: offDates,
                            original: c.original || `${c.person} belirli günlerde çalışmasın`
                        });
                    }
                    break;

                case 'person_date_off':
                    const parsedDates = (c.dates || []).map(d => new Date(d)).filter(d => !isNaN(d));
                    if (parsedDates.length > 0) {
                        this.constraints.leaveConstraints.push({
                            person: c.person,
                            dates: parsedDates,
                            original: c.original || `${c.person} belirli tarihlerde çalışmasın`
                        });
                    }
                    break;

                case 'person_date_range_off':
                    const start = new Date(c.startDate);
                    const end = new Date(c.endDate);
                    if (!isNaN(start) && !isNaN(end)) {
                        const rangeDates = [];
                        const cur = new Date(start);
                        while (cur <= end) {
                            rangeDates.push(new Date(cur));
                            cur.setDate(cur.getDate() + 1);
                        }
                        this.constraints.leaveConstraints.push({
                            person: c.person,
                            dates: rangeDates,
                            original: c.original || `${c.person} tarih aralığında izinli`
                        });
                    }
                    break;

                case 'empty_area_on_days':
                    this.constraints.emptyAreaDays.push({
                        areaId: c.areaId,
                        daysOfWeek: c.daysOfWeek || [],
                        original: c.original || `Alan ${c.areaId} belirli günlerde boş`
                    });
                    break;

                case 'pair_not_same_day':
                    this.constraints.pairConstraints.push({
                        person1: c.person1,
                        person2: c.person2,
                        original: c.original || `${c.person1} ve ${c.person2} aynı gün çalışmasın`
                    });
                    break;

                case 'area_never_empty':
                    this.constraints.neverEmptyAreas.push({
                        areaId: c.areaId,
                        original: c.original || `Alan ${c.areaId} asla boş kalmasın`
                    });
                    break;

                case 'person_only_areas':
                    this.constraints.areaRestrictions.push({
                        person: c.person,
                        allowedAreaIds: c.allowedAreaIds || [],
                        original: c.original || `${c.person} sadece belirli alanlarda`
                    });
                    break;

                case 'unknown':
                    console.warn(`⚠️ Anlaşılamayan koşul: "${c.original}" - Sebep: ${c.reason}`);
                    break;

                default:
                    console.warn(`Unknown constraint type: ${c.type}`);
            }
        }
    },

    /**
     * Fallback: Local regex-based parsing (robust version)
     */
    _localParse(conditionsText) {
        console.log('🔍 _localParse called with:', JSON.stringify(conditionsText));
        // Normalize ALL apostrophe variants to standard ASCII apostrophe
        const normalizedText = conditionsText.replace(/[\u2018\u2019\u201A\u201B\u2032\u02BC\u02B9`\u00B4]/g, "'");
        console.log('🔍 Normalized text:', JSON.stringify(normalizedText));
        const lines = normalizedText.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
        console.log('🔍 Lines to parse:', lines.length, lines);

        const findPerson = (name) => {
            const normalized = name.toLocaleLowerCase('tr-TR').trim();
            return state.people.find(p => p.toLocaleLowerCase('tr-TR') === normalized);
        };
        const findArea = (areaText) => {
            const normalized = areaText.toLocaleLowerCase('tr-TR').replace(/'/g, '').trim();
            // First try exact name match
            let found = state.workAreas.find(area =>
                area.name.toLocaleLowerCase('tr-TR') === normalized
            );
            if (found) return found;
            // Then try partial/contains match
            found = state.workAreas.find(area =>
                area.name.toLocaleLowerCase('tr-TR').includes(normalized) ||
                normalized.includes(area.name.toLocaleLowerCase('tr-TR'))
            );
            return found || null;
        };

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            let matched = false;
            console.log(`🔍 [Line ${lineIdx}] Parsing: "${line}"`);

            // 1. "X sadece Y'de çalışsın" → force to that single area
            const onlyArea = line.match(/(\S+)\s+(?:sadece|yalnızca|yalnız)\s+(.+?)'[td][ea]\s+(?:çalışsın|olsun|çalışmalı)/i);
            if (onlyArea) {
                console.log(`🔍 [Line ${lineIdx}] Pattern 1 matched: person='${onlyArea[1]}', area='${onlyArea[2]}'`);
                const person = findPerson(onlyArea[1]);
                const area = findArea(onlyArea[2].replace(/'/g, '').trim());
                console.log(`🔍 [Line ${lineIdx}] findPerson='${person}', findArea=`, area);
                if (person && area) {
                    this.constraints.positiveAssignments.push({
                        type: 'always', person, workAreaId: area.id, original: line
                    });
                    matched = true;
                }
            }

            // 2. "X sadece Y ve Z'de çalışabilir" → restrict to specific areas
            if (!matched) {
                const onlyAreas = line.match(/(\S+)\s+(?:sadece|yalnızca)\s+(.+?)\s+(?:çalışabilir|çalışabilsin)/i);
                if (onlyAreas) {
                    const person = findPerson(onlyAreas[1]);
                    if (person) {
                        const areaParts = onlyAreas[2].split(/\s+ve\s+|\s*,\s*/i);
                        const areaIds = areaParts.map(p => findArea(p.replace(/'[td][ea]/g, '').replace(/'/g, '').trim())).filter(Boolean).map(a => a.id);
                        if (areaIds.length > 0) {
                            this.constraints.areaRestrictions.push({
                                person, allowedAreaIds: areaIds, original: line
                            });
                            matched = true;
                        }
                    }
                }
            }

            // 3. "X hep/her zaman Y'de çalışsın" → force to area
            if (!matched) {
                const forceArea = line.match(/(\S+)\s+(?:hep|her\s*zaman|daima|sürekli)\s+(.+?)'[td][ea]\s+(?:çalışsın|olsun|çalışmalı)/i);
                if (forceArea) {
                    const person = findPerson(forceArea[1]);
                    const area = findArea(forceArea[2].replace(/'/g, '').trim());
                    if (person && area) {
                        this.constraints.positiveAssignments.push({
                            type: 'always', person, workAreaId: area.id, original: line
                        });
                        matched = true;
                    }
                }
            }

            // 4. "X Y'de çalışsın" (simple force) → force to area
            if (!matched) {
                const simpleForce = line.match(/(\S+)\s+(.+?)'[td][ea]\s+(?:çalışsın|çalışmalı)\s*$/i);
                if (simpleForce) {
                    const person = findPerson(simpleForce[1]);
                    const area = findArea(simpleForce[2].replace(/'/g, '').trim());
                    if (person && area) {
                        this.constraints.positiveAssignments.push({
                            type: 'always', person, workAreaId: area.id, original: line
                        });
                        matched = true;
                    }
                }
            }

            // 5. Preference: "X mümkünse Y'de çalışsın"
            if (!matched) {
                const preference = line.match(/(\S+)\s+(?:mümkünse|tercihen)\s+(?:hep\s+)?(.+?)'[td][ea]\s+(?:çalışsın|olsun)/i);
                if (preference) {
                    const person = findPerson(preference[1]);
                    const area = findArea(preference[2].replace(/'/g, '').trim());
                    if (person && area) {
                        this.constraints.preferences.push({ person, workAreaId: area.id, original: line });
                        matched = true;
                    }
                }
            }

            // 6. Block from area: "X Y'de çalışmasın" / "X hiç Y'de çalışmasın"
            if (!matched) {
                const block = line.match(/(\S+)\s+(?:hiç\s+)?(.+?)'[td][ea]\s+(?:hiç\s+)?(?:çalışmasın|çalışmamalı|olmasın)/i);
                console.log(`🔍 [Line ${lineIdx}] Pattern 6 (block) test:`, block ? `matched person='${block[1]}', area='${block[2]}'` : 'no match');
                if (block) {
                    const person = findPerson(block[1]);
                    const area = findArea(block[2].replace(/'/g, '').replace(/hiç\s*/i, '').trim());
                    console.log(`🔍 [Line ${lineIdx}] findPerson='${person}', findArea=`, area);
                    if (person && area) {
                        this.constraints.negativeAssignments.push({
                            type: 'never', person, workAreaId: area.id, original: line
                        });
                        matched = true;
                    }
                }
            }

            // 7. Day-based leave: "X Cuma günleri çalışmasın"
            if (!matched) {
                const dayOff = line.match(/(\S+)\s+(pazartesi|salı|çarşamba|perşembe|cuma|cumartesi|pazar)\s+(?:günleri?\s+)?(?:çalışmasın|çalışmamalı|izinli)/i);
                if (dayOff) {
                    const person = findPerson(dayOff[1]);
                    const dayOfWeek = this.dayNameMap[dayOff[2].toLocaleLowerCase('tr-TR')];
                    if (person && dayOfWeek !== undefined) {
                        const dates = [];
                        state.schedule.forEach(day => {
                            if (day.date.getDay() === dayOfWeek) dates.push(new Date(day.date));
                        });
                        this.constraints.leaveConstraints.push({ person, dates, original: line });
                        matched = true;
                    }
                }
            }

            // 8. Pair constraint: "X ve Y aynı gün çalışmasın"
            if (!matched) {
                const pair = line.match(/(\S+)\s+(?:ve|ile)\s+(\S+)\s+aynı\s+gün\s+(?:çalışmasın|çalışmamalı)/i);
                if (pair) {
                    const person1 = findPerson(pair[1]);
                    const person2 = findPerson(pair[2]);
                    if (person1 && person2) {
                        this.constraints.pairConstraints.push({
                            person1, person2, original: line
                        });
                        matched = true;
                    }
                }
            }

            if (!matched) {
                console.warn(`⚠️ Local parser could not understand: "${line}"`);
            }
        }

        console.log('📋 Local fallback parsed constraints:', JSON.stringify(this.constraints, null, 2));
        return this.constraints;
    },

    /**
     * Check if a person is available for a specific day and work area
     */
    isAvailable(person, day, workAreaId) {
        const dayOfWeek = day.date.getDay();
        const weekNum = this.getWeekNumber(day.date);
        const dateKey = day.date.toDateString();

        // Check leave constraints
        for (const leave of this.constraints.leaveConstraints) {
            if (leave.person === person) {
                for (const leaveDate of leave.dates) {
                    if (leaveDate.toDateString() === dateKey) {
                        return false;
                    }
                }
            }
        }

        // Check negative constraints
        for (const neg of this.constraints.negativeAssignments) {
            if (neg.person !== person || neg.workAreaId !== workAreaId) continue;

            switch (neg.type) {
                case 'never':
                    return false;
                case 'dayNegative':
                    if (dayOfWeek === neg.dayOfWeek) return false;
                    break;
                case 'weekNegative':
                    if (weekNum === neg.week) return false;
                    break;
            }
        }

        // Check area restrictions (person can only work in specific areas)
        for (const restriction of this.constraints.areaRestrictions) {
            if (restriction.person === person) {
                if (!restriction.allowedAreaIds.includes(workAreaId)) {
                    return false;
                }
            }
        }

        return true;
    },

    /**
     * Check if an area should be empty on a given day
     */
    isAreaEmptyDay(day, workAreaId) {
        const dayOfWeek = day.date.getDay();
        for (const rule of this.constraints.emptyAreaDays) {
            if (rule.areaId === workAreaId && rule.daysOfWeek.includes(dayOfWeek)) {
                return true;
            }
        }
        return false;
    },

    /**
     * Get mandatory assignments for a specific day
     */
    getMandatoryAssignment(day, workAreaId) {
        const dayOfWeek = day.date.getDay();
        const weekNum = this.getWeekNumber(day.date);
        const dateKey = day.date.toDateString();

        for (const pos of this.constraints.positiveAssignments) {
            if (pos.workAreaId !== workAreaId) continue;

            switch (pos.type) {
                case 'always':
                    return pos.person;
                case 'date':
                    if (pos.date.toDateString() === dateKey) return pos.person;
                    break;
                case 'day':
                    if (dayOfWeek === pos.dayOfWeek) return pos.person;
                    break;
                case 'week':
                    if (weekNum === pos.week) return pos.person;
                    break;
            }
        }

        return null;
    },

    /**
     * Check pair constraints - returns true if assignment is valid
     */
    checkPairConstraints(day, personToAssign, usedToday) {
        for (const pair of this.constraints.pairConstraints) {
            if (pair.person1 === personToAssign && usedToday.has(pair.person2)) {
                return false;
            }
            if (pair.person2 === personToAssign && usedToday.has(pair.person1)) {
                return false;
            }
        }
        return true;
    },

    /**
     * Get summary of parsed constraints for UI display
     */
    getSummary() {
        const total = this.constraints.positiveAssignments.length +
            this.constraints.negativeAssignments.length +
            this.constraints.leaveConstraints.length +
            this.constraints.pairConstraints.length +
            this.constraints.areaRestrictions.length +
            this.constraints.neverEmptyAreas.length +
            this.constraints.preferences.length +
            this.constraints.emptyAreaDays.length;

        return {
            total,
            positive: this.constraints.positiveAssignments.length,
            negative: this.constraints.negativeAssignments.length,
            leaves: this.constraints.leaveConstraints.length,
            pairs: this.constraints.pairConstraints.length,
            areaRestrictions: this.constraints.areaRestrictions.length,
            neverEmpty: this.constraints.neverEmptyAreas.length,
            preferences: this.constraints.preferences.length,
            emptyAreaDays: this.constraints.emptyAreaDays.length,
            aiSummary: this._aiSummary || ''
        };
    }
};

// ============================================
// Initialization
// ============================================
async function init() {
    Modal.init();
    Toast.init();
    populateDateSelectors();
    loadFromLocalStorage();
    updatePeopleList();
    updateWorkAreaListStep2();
    updatePreviewTable();
    updateStep2Button();
    syncNobetErtesiCheckbox();

    // Initialize Supabase auth session (picks up OAuth redirect tokens from URL hash)
    if (supabaseClient) {
        try {
            // This will detect tokens in URL hash from OAuth redirect
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session) {
                AuthState.token = session.access_token;
                // Load user profile and usage from backend
                try {
                    const meData = await ApiClient.getMe();
                    AuthState.user = meData.user;
                    AuthState.usage = meData.usage;
                } catch (e) {
                    console.error('Failed to load user data:', e);
                }
            }

            // Listen for auth state changes (token refresh, sign out, etc.)
            supabaseClient.auth.onAuthStateChange((event, session) => {
                console.log('[Auth] State change:', event);
                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                    if (session) {
                        AuthState.token = session.access_token;
                        // Reload user data
                        ApiClient.getMe().then(meData => {
                            AuthState.user = meData.user;
                            AuthState.usage = meData.usage;
                            updateUserUI();
                        }).catch(e => console.error('Auth state change - getMe failed:', e));
                    }
                } else if (event === 'SIGNED_OUT') {
                    AuthState.clear();
                    updateUserUI();
                }
            });
        } catch (e) {
            console.error('Supabase session init error:', e);
        }
    }

    updateUserUI();

    // Check if coming from profile page with a calendar to load
    const calendarToLoad = localStorage.getItem('medshifter_load_calendar');
    if (calendarToLoad) {
        localStorage.removeItem('medshifter_load_calendar');
        loadFromCloud(calendarToLoad).then(() => {
            updatePeopleList();
            updateWorkAreaListStep2();
            updatePreviewTable();
        });
    }
}

function populateDateSelectors() {
    const monthSelect = document.getElementById('monthSelect');
    const yearSelect = document.getElementById('yearSelect');

    if (!monthSelect || !yearSelect) return;

    // Clear existing options
    monthSelect.innerHTML = '';
    yearSelect.innerHTML = '';

    // Populate months
    monthNames.forEach((name, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = name;
        if (index === state.selectedMonth) option.selected = true;
        monthSelect.appendChild(option);
    });

    // Populate years
    const currentYear = new Date().getFullYear();
    for (let year = currentYear - 1; year <= currentYear + 2; year++) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === state.selectedYear) option.selected = true;
        yearSelect.appendChild(option);
    }

    // Event listeners
    monthSelect.addEventListener('change', (e) => {
        state.selectedMonth = parseInt(e.target.value);
        saveToLocalStorage();
    });

    yearSelect.addEventListener('change', (e) => {
        state.selectedYear = parseInt(e.target.value);
        saveToLocalStorage();
    });
}

// ============================================
// Wizard Navigation
// ============================================
function goToStep(step) {
    // Validation before moving forward
    if (step > state.currentStep) {
        if (state.currentStep === 2 && state.people.length === 0) {
            Toast.warning('Lütfen en az bir kişi ekleyin!');
            return;
        }
    }

    // Update step content visibility
    document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
    const stepEl = document.getElementById('step' + step);
    if (stepEl) stepEl.classList.add('active');

    // Update step circles
    document.querySelectorAll('.step-circle').forEach(circle => {
        const circleStep = parseInt(circle.dataset.step);
        circle.classList.remove('active', 'completed');
        if (circleStep < step) {
            circle.classList.add('completed');
            circle.innerHTML = '✓';
        } else if (circleStep === step) {
            circle.classList.add('active');
            circle.innerHTML = circleStep;
        } else {
            circle.innerHTML = circleStep;
        }
    });

    // Update step lines
    document.querySelectorAll('.step-line').forEach(line => {
        const lineNum = parseInt(line.dataset.line);
        if (lineNum < step) {
            line.classList.add('completed');
        } else {
            line.classList.remove('completed');
        }
    });

    state.currentStep = step;

    // Step-specific actions
    if (step === 3) {
        renderShiftDelaysStep();
    }
    if (step === 4) {
        renderConstraintBuilder();
    }
    // Note: Step 5 rendering is handled by generateAndShowCalendar directly
}

// ============================================
// Step 2: People Management
// ============================================
function addPerson() {
    const input = document.getElementById('personName');
    const name = input.value.trim();

    if (!name) return;

    if (state.people.includes(name)) {
        Toast.warning('Bu kişi zaten ekli!');
        return;
    }

    // Check plan personnel limit
    const usage = AuthState.usage;
    if (usage && usage.limits && usage.limits.peopleLimit) {
        const limit = usage.limits.peopleLimit;
        if (state.people.length >= limit) {
            Toast.error(`Personel limitine ulaştınız! Maksimum ${limit} kişi ekleyebilirsiniz. Daha fazla kişi eklemek için planınızı yükseltin.`);
            return;
        }
    }

    state.people.push(name);
    input.value = '';
    input.focus();

    updatePeopleList();
    updateStep2Button();
    saveToLocalStorage();
}

function removePerson(name) {
    state.people = state.people.filter(p => p !== name);
    updatePeopleList();
    updateStep2Button();

    // Also remove from shift delays
    Object.keys(state.shiftDelays).forEach(date => {
        state.shiftDelays[date] = state.shiftDelays[date].filter(p => p !== name);
        if (state.shiftDelays[date].length === 0) {
            delete state.shiftDelays[date];
        }
    });

    saveToLocalStorage();
}

function updatePeopleList() {
    const list = document.getElementById('peopleList');
    const count = document.getElementById('totalPeople');

    if (!list) return;

    if (state.people.length === 0) {
        list.innerHTML = '<span style="color: rgba(255,255,255,0.4); font-style: italic;">Henüz kişi eklenmedi...</span>';
    } else {
        list.innerHTML = state.people.map(name => `
            <div class="person-tag">
                ${name}
                <span class="remove" onclick="removePerson('${name}')">✕</span>
            </div>
        `).join('');
    }

    if (count) count.textContent = state.people.length;
}

function updateStep2Button() {
    const btn = document.getElementById('step2Next');
    if (btn) btn.disabled = state.people.length === 0;
}

// ============================================
// Step 2: Schedule Title
// ============================================
function updateScheduleTitle() {
    const input = document.getElementById('scheduleTitle');
    if (input) {
        state.scheduleTitle = input.value.trim();
        updatePageTitleDisplay();
        saveToLocalStorage();
    }
}

// ============================================
// Step 2: Work Areas Management
// ============================================
function addWorkAreaStep2() {
    const input = document.getElementById('workAreaName');
    const name = input.value.trim();

    if (!name) return;

    // Check if already exists
    if (state.workAreas.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        Toast.warning('Bu çalışma alanı zaten ekli!');
        return;
    }

    state.workAreas.push({
        id: state.nextWorkAreaId++,
        name: name
    });

    input.value = '';
    input.focus();

    updateWorkAreaListStep2();
    updatePreviewTable();
    saveToLocalStorage();
}

function removeWorkAreaStep2(id) {
    if (state.workAreas.length <= 1) {
        Toast.warning('En az bir çalışma alanı olmalıdır!');
        return;
    }

    state.workAreas = state.workAreas.filter(a => a.id !== id);
    updateWorkAreaListStep2();
    updatePreviewTable();
    saveToLocalStorage();
}

function updateWorkAreaListStep2() {
    const list = document.getElementById('workAreaListStep2');
    const count = document.getElementById('totalWorkAreas');

    if (!list) return;

    if (state.workAreas.length === 0) {
        list.innerHTML = '<span style="color: rgba(255,255,255,0.4); font-style: italic;">Henüz alan eklenmedi...</span>';
    } else {
        list.innerHTML = state.workAreas.map(area => `
            <div class="tag-item work-area-tag">
                ${area.name}
                ${state.workAreas.length > 1 ? `<span class="remove-tag" onclick="removeWorkAreaStep2(${area.id})">✕</span>` : ''}
            </div>
        `).join('');
    }

    if (count) count.textContent = state.workAreas.length;
}

// ============================================
// Step 2: Nöbet Ertesi Toggle
// ============================================
function toggleNobetErtesiCheckbox() {
    const checkbox = document.getElementById('nobetErtesiCheckbox');
    if (checkbox) {
        // Toggle is handled by the click on wrapper, so we just read current state
        state.showNobetErtesi = checkbox.checked;
        updatePreviewTable();
        saveToLocalStorage();
    }
}

function syncNobetErtesiCheckbox() {
    const checkbox = document.getElementById('nobetErtesiCheckbox');
    if (checkbox) {
        checkbox.checked = state.showNobetErtesi;
    }
}

// ============================================
// Step 2: Live Preview Table
// ============================================
function updatePreviewTable() {
    const head = document.getElementById('previewHead');
    const body = document.getElementById('previewBody');
    const empty = document.getElementById('previewEmpty');
    const table = document.getElementById('previewTable');

    if (!head || !body) return;

    if (state.workAreas.length === 0) {
        if (table) table.style.display = 'none';
        if (empty) empty.style.display = 'block';
        return;
    }

    if (table) table.style.display = 'table';
    if (empty) empty.style.display = 'none';

    // Build header
    let headerHtml = '<tr><th>Gün / Tarih</th>';
    state.workAreas.forEach(area => {
        headerHtml += `<th>${area.name}</th>`;
    });
    if (state.showNobetErtesi) {
        headerHtml += '<th style="background: rgba(239,68,68,0.1);">Nöbet Ertesi</th>';
    }
    headerHtml += '</tr>';
    head.innerHTML = headerHtml;

    // Build sample rows (3 days)
    const sampleDays = ['Pazartesi', 'Salı', 'Çarşamba'];
    const sampleDates = ['01.02.2026', '02.02.2026', '03.02.2026'];

    let bodyHtml = '';
    sampleDays.forEach((day, i) => {
        bodyHtml += `<tr><td>${day}<br><small>${sampleDates[i]}</small></td>`;
        state.workAreas.forEach(() => {
            bodyHtml += '<td>—</td>';
        });
        if (state.showNobetErtesi) {
            bodyHtml += '<td style="background: rgba(239,68,68,0.05);">—</td>';
        }
        bodyHtml += '</tr>';
    });
    body.innerHTML = bodyHtml;
}

// ============================================
// Step 4: Personnel List for Guidelines
// ============================================
function renderStep4PersonnelList() {
    const container = document.getElementById('step4PersonnelList');
    if (!container) return;

    if (state.people.length === 0) {
        container.innerHTML = '<span style="color: rgba(255,255,255,0.6); font-style: italic; font-size: 0.8rem;">Henüz personel eklenmedi.</span>';
    } else {
        // Render names vertically for the right-side column
        // flex-shrink: 0 prevents compression when many items are added
        container.innerHTML = state.people.map(name => `
            <div style="background: rgba(99, 102, 241, 0.4); padding: 0.4rem 0.6rem; border-radius: 6px; font-size: 0.85rem; color: #fff; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; min-height: 28px; display: flex; align-items: center;">
                ${name}
            </div>
        `).join('');
    }
}

// Render work areas list for Step 4
function renderStep4WorkAreasList() {
    const container = document.getElementById('step4WorkAreasList');
    if (!container) return;

    if (state.workAreas.length === 0) {
        container.innerHTML = '<span style="color: rgba(255,255,255,0.6); font-style: italic; font-size: 0.8rem;">Henüz çalışma alanı eklenmedi.</span>';
    } else {
        container.innerHTML = state.workAreas.map(area => `
            <div style="background: rgba(16, 185, 129, 0.4); padding: 0.4rem 0.6rem; border-radius: 6px; font-size: 0.85rem; color: #fff; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; min-height: 28px; display: flex; align-items: center;">
                ${area.name}
            </div>
        `).join('');
    }
}

// Toggle conditions help section in Step 4
function toggleConditionsHelp() {
    const content = document.getElementById('conditionsHelpContent');
    const icon = document.getElementById('conditionsHelpIcon');
    if (!content) return;
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    if (icon) icon.textContent = isHidden ? '▼' : '▶';
}

// Render clickable constraint suggestion chips for Step 4
function renderConstraintSuggestions() {
    const container = document.getElementById('constraintSuggestions');
    if (!container) return;

    const suggestions = [];

    // Get first person and first work area for examples
    const examplePerson = state.people[0] || 'Ahmet';
    const examplePerson2 = state.people[1] || 'Fatma';
    const exampleArea = state.workAreas[0]?.name || 'Acil';
    const exampleArea2 = state.workAreas[1]?.name || 'Poliklinik';

    // Get a sample date from the selected month
    const sampleDate = new Date(state.selectedYear, state.selectedMonth, 10);
    const dateStr = sampleDate.getDate().toString().padStart(2, '0') + '.' +
        (sampleDate.getMonth() + 1).toString().padStart(2, '0') + '.' +
        sampleDate.getFullYear();

    // Week-based positive
    suggestions.push({
        text: `1. Hafta ${examplePerson} ${exampleArea}'de çalışsın`,
        type: 'positive',
        icon: '📅'
    });

    // Day-based positive
    suggestions.push({
        text: `Pazartesi günleri ${examplePerson} ${exampleArea}'de çalışsın`,
        type: 'positive',
        icon: '📆'
    });

    // Date-based positive
    suggestions.push({
        text: `${dateStr} ${examplePerson2} ${exampleArea2}'de çalışsın`,
        type: 'positive',
        icon: '🎯'
    });

    // Never work in area (negative)
    suggestions.push({
        text: `${examplePerson} hiç ${exampleArea2}'de çalışmasın`,
        type: 'negative',
        icon: '🚫'
    });

    // Day-based negative
    suggestions.push({
        text: `${examplePerson2} Cuma günleri ${exampleArea}'de çalışmasın`,
        type: 'negative',
        icon: '❌'
    });

    // Pair constraint
    if (state.people.length >= 2) {
        suggestions.push({
            text: `${examplePerson} ve ${examplePerson2} aynı gün çalışmasın`,
            type: 'pair',
            icon: '👥'
        });
    }

    // Leave example
    suggestions.push({
        text: `${examplePerson} ${dateStr} tarihinde çalışmasın`,
        type: 'leave',
        icon: '🏖️'
    });

    container.innerHTML = suggestions.map(s => {
        const bgColor = s.type === 'positive' ? 'rgba(16, 185, 129, 0.3)' :
            s.type === 'negative' ? 'rgba(239, 68, 68, 0.3)' :
                s.type === 'pair' ? 'rgba(139, 92, 246, 0.3)' :
                    'rgba(245, 158, 11, 0.3)';
        const borderColor = s.type === 'positive' ? 'rgba(16, 185, 129, 0.5)' :
            s.type === 'negative' ? 'rgba(239, 68, 68, 0.5)' :
                s.type === 'pair' ? 'rgba(139, 92, 246, 0.5)' :
                    'rgba(245, 158, 11, 0.5)';

        return `
            <div class="constraint-chip" 
                 onclick="addConstraintSuggestion('${s.text.replace(/'/g, "\\'")}')"
                 style="background: ${bgColor}; border: 1px solid ${borderColor}; padding: 0.4rem 0.75rem; border-radius: 20px; font-size: 0.75rem; color: #fff; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 0.3rem;"
                 onmouseover="this.style.transform='scale(1.05)'" 
                 onmouseout="this.style.transform='scale(1)'">
                <span>${s.icon}</span>
                <span>${s.text}</span>
            </div>
        `;
    }).join('');
}

// Add a constraint suggestion to the textarea
function addConstraintSuggestion(text) {
    const textarea = document.getElementById('aiConditions');
    if (!textarea) return;

    const currentValue = textarea.value.trim();
    if (currentValue) {
        textarea.value = currentValue + '\n' + text;
    } else {
        textarea.value = text;
    }

    // Save to state
    state.aiConditions = textarea.value;
    saveToLocalStorage();

    Toast.success('Koşul eklendi!');
}

// ============================================
// Step 3: Shift Delays (Off-Days)
// ============================================
function renderShiftDelaysStep() {
    renderDraggablePeople();
    renderShiftCalendar();
}

function renderDraggablePeople() {
    const container = document.getElementById('draggablePeople');
    if (!container) return;

    container.innerHTML = state.people.map(name => `
        <div class="draggable-person ${state.selectedPerson === name ? 'selected' : ''}" 
             draggable="true" 
             data-person="${name}"
             onclick="selectPerson('${name}')"
             ondragstart="handleDragStart(event, '${name}')">
            ${name}
        </div>
    `).join('');
}

function renderShiftCalendar() {
    const month = state.selectedMonth;
    const year = state.selectedYear;
    const grid = document.getElementById('shiftCalendarGrid');

    if (!grid) return;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    let html = '';

    // Day headers
    shortDayNames.forEach(day => {
        html += `<div class="calendar-day-header">${day}</div>`;
    });

    // Empty cells before first day
    for (let i = 0; i < startDayOfWeek; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDateKey(year, month, day);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const dayPeople = state.shiftDelays[dateStr] || [];

        html += `
            <div class="calendar-day ${isWeekend ? 'weekend' : ''}" 
                 data-date="${dateStr}"
                 onclick="handleDayClick('${dateStr}')"
                 ondragover="handleDragOver(event)"
                 ondragleave="handleDragLeave(event)"
                 ondrop="handleDrop(event, '${dateStr}')">
                <div class="day-number">${day}</div>
                <div class="day-name">${shortDayNames[dayOfWeek]}</div>
                <div class="day-people">
                    ${dayPeople.map(p => `
                        <div class="day-person">
                            ${p.length > 6 ? p.substring(0, 6) + '..' : p}
                            <span class="remove-person" onclick="event.stopPropagation(); removeFromDay('${dateStr}', '${p}')">✕</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    grid.innerHTML = html;
}

function formatDateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function selectPerson(name) {
    if (state.selectedPerson === name) {
        state.selectedPerson = null;
        Toast.info('Seçim kaldırıldı');
    } else {
        state.selectedPerson = name;
        Toast.success(`${name} seçildi. Bir güne tıklayın.`);
    }
    renderDraggablePeople();
}

function handleDayClick(dateStr) {
    if (state.selectedPerson) {
        addToDay(dateStr, state.selectedPerson);
    }
}

function handleDragStart(event, personName) {
    event.dataTransfer.setData('text/plain', personName);
    event.dataTransfer.effectAllowed = 'copy';
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    event.currentTarget.classList.add('dragover');
}

function handleDragLeave(event) {
    event.currentTarget.classList.remove('dragover');
}

function handleDrop(event, dateStr) {
    event.preventDefault();
    event.currentTarget.classList.remove('dragover');
    const personName = event.dataTransfer.getData('text/plain');
    if (personName) {
        addToDay(dateStr, personName);
    }
}

function addToDay(dateStr, personName) {
    if (!state.shiftDelays[dateStr]) {
        state.shiftDelays[dateStr] = [];
    }
    if (!state.shiftDelays[dateStr].includes(personName)) {
        state.shiftDelays[dateStr].push(personName);
        renderShiftCalendar();
        const [y, m, d] = dateStr.split('-');
        Toast.success(`${personName} → ${parseInt(d)} ${monthNames[parseInt(m) - 1]}`);
        saveToLocalStorage();
    } else {
        Toast.warning('Bu kişi zaten bu güne ekli!');
    }
}

function removeFromDay(dateStr, personName) {
    if (state.shiftDelays[dateStr]) {
        state.shiftDelays[dateStr] = state.shiftDelays[dateStr].filter(p => p !== personName);
        if (state.shiftDelays[dateStr].length === 0) {
            delete state.shiftDelays[dateStr];
        }
        renderShiftCalendar();
        saveToLocalStorage();
        Toast.info(`${personName} kaldırıldı`);
    }
}

// ============================================
// Step 4 → 5: Calendar Generation
// ============================================
function skipToCalendar() {
    generateAndShowCalendar();
}

function generateCalendar() {
    generateAndShowCalendar();
}

async function generateAndShowCalendar() {
    const year = state.selectedYear;
    const month = state.selectedMonth;

    // Generate workdays
    const days = getWorkDaysInMonth(year, month);

    if (days.length === 0) {
        Toast.warning('Bu ayda çalışma günü bulunamadı!');
        return;
    }

    // Apply shift delays as nobetErtesi
    days.forEach(day => {
        const dateStr = formatDateKey(day.date.getFullYear(), day.date.getMonth(), day.date.getDate());
        if (state.shiftDelays[dateStr]) {
            day.nobetErtesi = state.shiftDelays[dateStr].join(', ');
        }
    });

    state.schedule = days;
    state.updatedAt = new Date().toISOString();

    // Check if this is a NEW calendar (not already saved to backend)
    const isNewCalendar = !state.backendCalendarId;

    // DEBUG LOGGING
    console.log('[Calendar] isNewCalendar:', isNewCalendar, 'backendCalendarId:', state.backendCalendarId);
    console.log('[Calendar] AuthState.token exists:', !!AuthState.token);
    console.log('[Calendar] Will call API:', isNewCalendar && AuthState.token);

    if (isNewCalendar && AuthState.token) {
        // Create calendar title with date prefix
        const today = new Date();
        const datePrefix = today.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
            'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
        const calendarTitle = `${datePrefix} - ${monthNames[month]} ${year} Takvimi`;

        try {
            Toast.info('Takvim oluşturuluyor...');
            console.log('[Calendar] Calling ApiClient.createCalendar...');

            const result = await ApiClient.createCalendar({
                title: calendarTitle,
                month: month,
                year: year,
                people: state.people,
                workAreas: state.workAreas,
                schedule: state.schedule,
                conditions: state.aiConditions || '',
                shiftDelays: state.shiftDelays
            });

            // Save backend calendar ID
            state.backendCalendarId = result.calendar.id;
            state.calendarTitle = calendarTitle;
            state.createdAt = result.calendar.createdAt;

            // Update usage display
            if (result.usage) {
                AuthState.updateUsage(result.usage);
            }

            Toast.success('Takvim oluşturuldu ve kaydedildi!');
        } catch (error) {
            console.error('Calendar creation error:', error);

            // Check if it's a limit error
            if (error.message.includes('limit')) {
                showLimitReachedModal();
                return; // Don't proceed to step 5
            }

            // For other errors, show warning but continue locally
            Toast.warning('Sunucuya kaydedilemedi, yerel olarak devam ediliyor.');
        }
    }

    // Generate local ID if not set
    state.calendarId = state.calendarId || generateUUID();
    state.createdAt = state.createdAt || new Date().toISOString();

    // Transition to Step 5
    goToStep(5);

    // Render calendar components
    renderTableHeader();
    renderScheduleTable();
    renderWorkAreas();
    renderInlineWorkAreas();
    updateStats();
    renderDetailedStats();
    renderActiveConstraints();
    renderVersionTabs();
    updatePageTitleDisplay();

    saveToLocalStorage();
}

function showLimitReachedModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'limitReachedModal';
    modal.innerHTML = `
        <div class="modal" style="max-width: 450px;">
            <div class="modal-header">
                <h3 style="color: #ff6b6b;">⚠️ Limit Aşıldı</h3>
            </div>
            <div class="modal-body" style="text-align: center; padding: 2rem;">
                <p style="font-size: 1.1rem; margin-bottom: 1.5rem;">
                    Takvim oluşturma limitinize ulaştınız.
                </p>
                <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">
                    Daha fazla takvim oluşturmak için planınızı yükseltin.
                </p>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button onclick="document.getElementById('limitReachedModal').remove()" 
                            class="btn btn-secondary">Kapat</button>
                    <a href="/pricing" class="btn btn-primary">Planları İncele</a>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function getWorkDaysInMonth(year, month) {
    const days = [];
    const date = new Date(year, month, 1);
    let weekNumber = 1;
    let lastWeekStart = null;

    while (date.getMonth() === month) {
        const dayOfWeek = date.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

        // Include day if it's a weekday, or if weekends are included
        if (!isWeekend || state.includeWeekends) {
            if (dayOfWeek === 1 || lastWeekStart === null) {
                if (lastWeekStart !== null) weekNumber++;
                lastWeekStart = new Date(date);
            }

            const dayObj = {
                date: new Date(date),
                dayName: dayNames[dayOfWeek],
                weekNumber: weekNumber,
                nobetErtesi: '',
                isWeekend: isWeekend,
            };

            // Add work area fields
            state.workAreas.forEach(area => {
                dayObj[`workArea${area.id}`] = '';
            });

            days.push(dayObj);
        }

        date.setDate(date.getDate() + 1);
    }

    return days;
}

function toggleWeekendMode(includeWeekends) {
    state.includeWeekends = includeWeekends;
    const btn1 = document.getElementById('weekdaysOnlyBtn');
    const btn2 = document.getElementById('weekendsIncludeBtn');
    if (btn1 && btn2) {
        btn1.classList.toggle('active', !includeWeekends);
        btn2.classList.toggle('active', includeWeekends);
    }
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================
// Step 5: Calendar Table
// ============================================
function renderTableHeader() {
    const head = document.getElementById('scheduleHead');
    if (!head) return;

    let html = `
        <tr>
            <th>Gün / Tarih</th>
            ${state.workAreas.map(area => `<th>${area.name}</th>`).join('')}`;

    if (state.showNobetErtesi) {
        html += `<th style="background: rgba(239,68,68,0.2);">Nöbet Ertesi</th>`;
    }
    html += `</tr>`;
    head.innerHTML = html;

    // Setup wide mode and scroll handling
    setupTableLayout();
}

// Setup wide mode for many work areas and scroll detection
function setupTableLayout() {
    const wrapper = document.querySelector('.calendar-wrapper');
    const scrollHint = document.getElementById('scrollHint');
    const tableContainer = document.getElementById('tableContainer');
    const scrollWrapper = document.getElementById('tableScrollWrapper');

    if (!wrapper || !tableContainer) return;

    // Calculate total columns: 1 (date) + workAreas + optional nobetErtesi
    const totalColumns = 1 + state.workAreas.length + (state.showNobetErtesi ? 1 : 0);

    // Auto-enable wide mode if 5+ work areas (6+ total columns)
    if (totalColumns >= 6) {
        wrapper.classList.add('wide-mode');
    } else {
        wrapper.classList.remove('wide-mode');
    }

    // Show scroll hint if table is wider than container
    setTimeout(() => {
        if (tableContainer.scrollWidth > tableContainer.clientWidth) {
            if (scrollHint) scrollHint.classList.add('visible');
            setupScrollShadows(tableContainer, scrollWrapper);
        } else {
            if (scrollHint) scrollHint.classList.remove('visible');
            if (scrollWrapper) {
                scrollWrapper.classList.remove('scroll-left', 'scroll-right');
            }
        }
    }, 100);
}

// Setup scroll shadow indicators
function setupScrollShadows(container, wrapper) {
    if (!container || !wrapper) return;

    const updateShadows = () => {
        const scrollLeft = container.scrollLeft;
        const maxScroll = container.scrollWidth - container.clientWidth;

        // Show left shadow if scrolled right
        if (scrollLeft > 10) {
            wrapper.classList.add('scroll-left');
        } else {
            wrapper.classList.remove('scroll-left');
        }

        // Show right shadow if more content to scroll
        if (scrollLeft < maxScroll - 10) {
            wrapper.classList.add('scroll-right');
        } else {
            wrapper.classList.remove('scroll-right');
        }
    };

    // Initial check
    updateShadows();

    // Listen to scroll
    container.removeEventListener('scroll', updateShadows);
    container.addEventListener('scroll', updateShadows);
}

function renderScheduleTable() {
    const body = document.getElementById('scheduleBody');
    if (!body) return;

    // Ensure table header is always rendered
    renderTableHeader();

    body.innerHTML = '';

    state.schedule.forEach((day, index) => {
        const row = document.createElement('tr');
        row.className = `week-${day.weekNumber}`;

        const dateStr = formatDisplayDate(day.date);

        // Work area columns
        const workAreaCells = state.workAreas.map(area => {
            const fieldName = `workArea${area.id}`;
            const value = day[fieldName] || '';
            return `
                <td>
                    <select data-field="${fieldName}" data-index="${index}" 
                            onchange="handleFieldChange(this)" 
                            class="${value ? 'assigned' : ''}">
                        <option value="">Seçiniz...</option>
                        ${state.people.map(p => `<option value="${p}" ${value === p ? 'selected' : ''}>${p}</option>`).join('')}
                    </select>
                </td>
            `;
        }).join('');

        row.innerHTML = `
            <td>
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 600;">${day.dayName}</span>
                    <span style="font-size: 0.8rem; opacity: 0.7;">${dateStr}</span>
                </div>
            </td>
            ${workAreaCells}
            ${state.showNobetErtesi ? `
            <td style="background: rgba(239,68,68,0.1);">
                <select data-field="nobetErtesi" data-index="${index}" 
                        onchange="handleFieldChange(this)"
                        class="${day.nobetErtesi ? 'assigned' : ''}">
                    <option value="">Seçiniz...</option>
                    ${state.people.map(p => `<option value="${p}" ${day.nobetErtesi === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select>
            </td>` : ''}
        `;

        body.appendChild(row);
    });
}

function handleFieldChange(select) {
    const index = parseInt(select.dataset.index);
    const field = select.dataset.field;
    const value = select.value.trim();

    // Check for duplicate on same day
    if (value && field.startsWith('workArea')) {
        const day = state.schedule[index];
        const otherFields = state.workAreas.map(a => `workArea${a.id}`).filter(f => f !== field);
        const isDuplicate = otherFields.some(f => day[f] === value);

        if (isDuplicate) {
            Toast.warning(`${value} aynı gün içinde zaten başka bir alanda atanmış!`);
            select.value = state.schedule[index][field] || '';
            return;
        }
    }

    state.schedule[index][field] = value;
    select.classList.toggle('assigned', value !== '');

    markUnsaved();
    updateStats();
    renderDetailedStats();
    saveToLocalStorage();
}

function markUnsaved() {
    state.hasUnsavedChanges = true;
}

function formatDisplayDate(date) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

// ============================================
// Work Area Management
// ============================================
function renderWorkAreas() {
    const list = document.getElementById('workAreaList');
    if (!list) return;

    list.innerHTML = state.workAreas.map((area, index) => `
        <div class="work-area-item">
            <input type="text" value="${area.name}" 
                   onchange="renameWorkArea(${area.id}, this.value)"
                   style="flex: 1;">
            ${state.workAreas.length > 1 ?
            `<button class="btn btn-sm" onclick="removeWorkArea(${area.id})" 
                         style="background: rgba(239,68,68,0.2); color: var(--danger);">✕</button>` :
            ''}
        </div>
    `).join('');
}

function addWorkArea() {
    const newArea = {
        id: state.nextWorkAreaId++,
        name: `Çalışma Alanı ${state.workAreas.length + 1}`
    };

    state.workAreas.push(newArea);

    // Add field to existing schedule
    state.schedule.forEach(day => {
        day[`workArea${newArea.id}`] = '';
    });

    renderWorkAreas();
    renderTableHeader();
    renderScheduleTable();
    saveToLocalStorage();
    Toast.success('Çalışma alanı eklendi');
}

function removeWorkArea(id) {
    if (state.workAreas.length <= 1) {
        Toast.warning('En az bir çalışma alanı olmalıdır!');
        return;
    }

    state.workAreas = state.workAreas.filter(a => a.id !== id);

    state.schedule.forEach(day => {
        delete day[`workArea${id}`];
    });

    renderWorkAreas();
    renderTableHeader();
    renderScheduleTable();
    saveToLocalStorage();
}

function renameWorkArea(id, newName) {
    const area = state.workAreas.find(a => a.id === id);
    if (area) {
        area.name = newName.trim() || `Çalışma Alanı ${state.workAreas.indexOf(area) + 1}`;
        renderTableHeader();
        saveToLocalStorage();
    }
}

// ============================================
// Statistics
// ============================================
function updateStats() {
    const grid = document.getElementById('statsGrid');
    if (!grid) return;

    const stats = {};
    state.people.forEach(p => { stats[p] = 0; });

    state.schedule.forEach(day => {
        state.workAreas.forEach(area => {
            const field = `workArea${area.id}`;
            if (day[field] && stats[day[field]] !== undefined) {
                stats[day[field]]++;
            }
        });
    });

    const hasAssignments = Object.values(stats).some(v => v > 0);

    if (!hasAssignments) {
        grid.innerHTML = '<p style="color: rgba(255,255,255,0.4);">Henüz atama yok</p>';
        return;
    }

    const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);

    grid.innerHTML = sorted.map(([name, count]) => `
        <div class="stat-item">
            <span class="stat-name">${name}</span>
            <span class="stat-value">${count} gün</span>
        </div>
    `).join('');

    // Also update area stats in sidebar
    updateAreaStats();
}

// ============================================
// Update Area Statistics (sidebar)
// ============================================
function updateAreaStats() {
    const grid = document.getElementById('areaStatsGrid');
    if (!grid) return;

    if (state.schedule.length === 0 || state.workAreas.length === 0) {
        grid.innerHTML = '<p style="color: rgba(255,255,255,0.4);">Henüz veri yok</p>';
        return;
    }

    const totalDays = state.schedule.length;
    const areaStats = state.workAreas.map(area => {
        const field = `workArea${area.id}`;
        let filledDays = 0;
        state.schedule.forEach(day => {
            if (day[field] && day[field].trim() !== '') {
                filledDays++;
            }
        });
        const rate = totalDays > 0 ? Math.round((filledDays / totalDays) * 100) : 0;
        return { name: area.name, filledDays, totalDays, rate };
    });

    grid.innerHTML = areaStats.map(stat => `
        <div class="stat-item">
            <span class="stat-name">${stat.name}</span>
            <span class="stat-value ${stat.rate === 100 ? 'stat-cell-highlight' : ''}">${stat.rate}%</span>
        </div>
    `).join('');
}

// ============================================
// Scroll to Detailed Stats
// ============================================
function scrollToStats() {
    const statsSection = document.getElementById('detailedStatsSection');
    if (statsSection) {
        statsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ============================================
// Auto Assignment - Adaletli Dağıtım Algoritması
// ============================================
async function startAssignment() {
    if (state.people.length < 3) {
        Toast.warning('En az 3 kişi eklemeniz gerekiyor!');
        return;
    }

    if (state.schedule.length === 0) {
        Toast.warning('Önce takvimi oluşturun!');
        return;
    }

    // === STEP 1: Collect constraints from Visual Builder ===
    let parsedConstraints = collectVisualConstraints();

    const totalVisualRules = parsedConstraints.personAreaRules.length +
        parsedConstraints.dayOffRules.length +
        parsedConstraints.pairRules.length;

    // If visual builder has rules, use them. Otherwise fallback to text parser.
    if (totalVisualRules > 0) {
        console.log(`✅ ${totalVisualRules} görsel koşul uygulanıyor`);
        console.log('Visual constraints:', parsedConstraints);
        Toast.success(`${totalVisualRules} koşul uygulandı!`, 5000);
    } else {
        // Legacy: Parse from text if visual builder is empty
        const conditionsText = state.aiConditions || '';
        if (conditionsText.trim()) {
            Toast.info('📝 Koşullar analiz ediliyor...', 3000);
            const parser = new SimpleConstraintParser(state.people, state.workAreas);
            const result = parser.parse(conditionsText);
            parsedConstraints = result.constraints;
            const parseErrors = result.errors;

            const totalRules = parsedConstraints.personAreaRules.length +
                parsedConstraints.dayOffRules.length +
                parsedConstraints.pairRules.length;

            if (totalRules > 0) {
                console.log(`✅ ${totalRules} koşul başarıyla parse edildi`);
                Toast.success(`${totalRules} koşul uygulandı!`, 5000);
            }
            if (parseErrors.length > 0) {
                console.warn(`⚠️ ${parseErrors.length} koşul parse edilemedi:`, parseErrors);
                Toast.warning(`${parseErrors.length} koşul anlaşılamadı.`, 7000);
            }
        }
    }

    // Store parsed constraints in state
    state.constraints = parsedConstraints;

    // Track constraint summary for success message
    const summary = {
        total: parsedConstraints.personAreaRules.length +
            parsedConstraints.dayOffRules.length +
            parsedConstraints.pairRules.length,
        aiSummary: null
    };

    const numPeople = state.people.length;
    const numDays = state.schedule.length;
    const numAreas = state.workAreas.length;

    // Kişi ve alan bazlı sayaçlar
    const perPersonPerArea = {};  // person -> areaId -> count
    const totalPerPerson = {};     // person -> total count

    state.people.forEach(person => {
        perPersonPerArea[person] = {};
        state.workAreas.forEach(area => {
            perPersonPerArea[person][area.id] = 0;
        });
        totalPerPerson[person] = 0;
    });

    /**
     * Helper: Check if person can work in area based on constraints
     */
    function canWorkInArea(person, areaId) {
        const rule = parsedConstraints.personAreaRules.find(r => r.person === person);
        if (!rule) return true; // No rule = allowed

        // Convert areaId to string for comparison (Object.entries stores keys as strings)
        const areaIdStr = String(areaId);

        // Check if blocked (HARD CONSTRAINT: Çalışmaz)
        if (rule.blocked && rule.blocked.map(String).includes(areaIdStr)) {
            return false;
        }

        // Check if only allowed in specific areas
        if (rule.allowed && rule.allowed.length > 0) {
            return rule.allowed.map(String).includes(areaIdStr);
        }

        return true;
    }

    /**
     * Helper: Get area priority for a person
     * Returns: 'allowed' (Çalışır), 'preferred' (Boş kalırsa), 'blocked' (Çalışmaz), 'default' (no rule)
     */
    function getAreaPriority(person, areaId) {
        const rule = parsedConstraints.personAreaRules.find(r => r.person === person);
        if (!rule) return 'default'; // No rule = anyone can work here

        const areaIdStr = String(areaId);

        if (rule.blocked && rule.blocked.map(String).includes(areaIdStr)) return 'blocked';
        if (rule.preferred && rule.preferred.map(String).includes(areaIdStr)) return 'preferred';
        if (rule.allowed && rule.allowed.length > 0 && rule.allowed.map(String).includes(areaIdStr)) return 'allowed';
        // If there's a rule object for this person but this area is not in any list,
        // treat as default
        return 'default';
    }

    /**
     * Helper: Check if person is on day-off
     */
    function isOnDayOff(person, day) {
        // Check date-based rules (from visual constraint builder)
        for (const rule of parsedConstraints.dayOffRules) {
            if (rule.person !== person) continue;

            // Check specific dates
            if (rule.dates && rule.dates.length > 0) {
                const dateStr = formatDateKey(day.date.getFullYear(), day.date.getMonth(), day.date.getDate());
                if (rule.dates.includes(dateStr)) {
                    return true;
                }
            }

            // Check weekday (legacy support)
            if (rule.weekdays && rule.weekdays.length > 0) {
                const dayOfWeek = day.date.getDay();
                if (rule.weekdays.includes(dayOfWeek)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Helper: Check if two people can work on same day (pair constraints)
     */
    function canWorkTogether(person1, person2) {
        const pairRule = parsedConstraints.pairRules.find(r =>
            (r.person1 === person1 && r.person2 === person2) ||
            (r.person1 === person2 && r.person2 === person1)
        );

        if (pairRule && pairRule.type === 'never_same_day') {
            return false;
        }

        return true;
    }

    /**
     * Puanlama fonksiyonu - DÜŞÜK puan = DAHA ÖNCELİKLİ
     * Tamamen deterministik, rastgelelik yok
     * 
     * Öncelik sırası (güçlüden zayıfa):
     * 1. Toplam gün dengesi (en az çalışan kişi önce)
     * 2. Alan dengesi (bu alanda en az çalışan kişi önce)
     * 3. Kıdem sırası (tie-breaker)
     * 4. Haftalık alan önceliği (en zayıf tercih bonusu)
     */
    let currentWeekIdx = -1; // set per-day in the loop

    function getAssignmentScore(person, areaId) {
        const areaCount = perPersonPerArea[person][areaId];
        const totalCount = totalPerPerson[person];

        // Birincil kriter: Toplamda en az çalışan kişi (gün dengesi)
        let score = totalCount * 1000;

        // İkincil kriter: Bu alanda en az çalışan kişi (alan dengesi)
        score += areaCount * 10;

        // Üçüncül kriter: Kıdem sırası (deterministik tie-breaker)
        // seniorityOrder: [az çalışan ... çok çalışan]
        // Yüksek index = daha kıdemli = daha çok çalışmalı = daha DÜŞÜK skor = daha yüksek öncelik
        const seniorityOrder = visualConstraints.seniorityOrder;
        if (seniorityOrder.length > 0) {
            const seniorityIdx = seniorityOrder.indexOf(person);
            if (seniorityIdx !== -1) {
                score -= seniorityIdx * 0.1;
            }
        } else {
            score += state.people.indexOf(person) * 0.01;
        }

        // Not: Haftalık alan önceliği artık hard constraint olarak uygulanıyor (scoring'den kaldırıldı)

        return score;
    }

    /**
     * Müsait kişilerden en uygun olanı seç
     */
    function selectBestCandidate(candidates, areaId) {
        if (candidates.length === 0) return null;

        let bestPerson = candidates[0];
        let bestScore = getAssignmentScore(bestPerson, areaId);

        for (let i = 1; i < candidates.length; i++) {
            const person = candidates[i];
            const score = getAssignmentScore(person, areaId);
            if (score < bestScore) {
                bestScore = score;
                bestPerson = person;
            }
        }

        return bestPerson;
    }

    // === STEP 2: Process each day ===
    state.schedule.forEach((day) => {
        // Nöbet ertesi kişileri çıkar (case-insensitive)
        const nobetErtesiPeople = (day.nobetErtesi || '')
            .split(',')
            .map(p => p.trim().toLowerCase())
            .filter(Boolean);

        // Bugün atanan kişiler (aynı gün birden fazla alanda çalışmamak için)
        const usedToday = new Set();

        // Set current week index for scoring function
        currentWeekIdx = getWeekIndexForDay(day.date.getDate());

        // === STEP 2: Fill slots with 3-tier constraints + weekly priority as HARD constraint ===
        state.workAreas.forEach((area) => {
            const field = `workArea${area.id}`;

            /**
             * Filter base availability (excluding area rules - those are handled in tiers)
             * Öncelik sırası (kesin kurallar - ASLA es geçilmez):
             * 1. Nöbet ertesi → çalışamaz
             * 2. İzin günleri → çalışamaz
             * 3. Çalışabilir/Çalışamaz (blocked areas) → çalışamaz
             * 4. Pair constraints → aynı gün çalışamaz
             */
            function getBaseAvailable(relaxPairConstraints) {
                return state.people.filter(p => {
                    // Skip if already used today
                    if (usedToday.has(p)) return false;

                    // HARD CONSTRAINT 1: Skip if on nöbet ertesi (ASLA es geçilmez)
                    if (nobetErtesiPeople.includes(p.toLowerCase())) return false;

                    // HARD CONSTRAINT 2: Check constraint: is on day-off? (ASLA es geçilmez)
                    if (isOnDayOff(p, day)) return false;

                    // HARD CONSTRAINT 3: Check constraint: blocked from this area? (ASLA es geçilmez)
                    if (!canWorkInArea(p, area.id)) return false;

                    // HARD CONSTRAINT 4: Check pair constraints (unless relaxed)
                    if (!relaxPairConstraints) {
                        for (const otherPerson of usedToday) {
                            if (!canWorkTogether(p, otherPerson)) return false;
                        }
                    }

                    return true;
                });
            }

            // === WEEKLY PRIORITY: Hard constraint — directly assign if person is available ===
            const weeklyPerson = parsedConstraints.weeklyPriority?.[currentWeekIdx]?.[area.id];
            if (weeklyPerson && !usedToday.has(weeklyPerson)) {
                // Check if the weekly priority person passes ALL hard constraints
                const isNobetErtesi = nobetErtesiPeople.includes(weeklyPerson.toLowerCase());
                const isDayOff = isOnDayOff(weeklyPerson, day);
                const isBlocked = !canWorkInArea(weeklyPerson, area.id);
                let pairConflict = false;
                for (const otherPerson of usedToday) {
                    if (!canWorkTogether(weeklyPerson, otherPerson)) {
                        pairConflict = true;
                        break;
                    }
                }

                if (!isNobetErtesi && !isDayOff && !isBlocked && !pairConflict) {
                    // Weekly priority person is fully available — hard assign
                    day[field] = weeklyPerson;
                    usedToday.add(weeklyPerson);
                    perPersonPerArea[weeklyPerson][area.id]++;
                    totalPerPerson[weeklyPerson]++;
                    console.log(`📆 Weekly priority HARD assign: ${weeklyPerson} → ${area.name} (Week ${currentWeekIdx + 1})`);
                    return; // Skip scoring for this area
                } else {
                    console.log(`⚠️ Weekly priority person ${weeklyPerson} not available for ${area.name} (nöbet:${isNobetErtesi}, izin:${isDayOff}, blocked:${isBlocked}, pair:${pairConflict})`);
                }
            }

            const availablePeople = getBaseAvailable(false);

            /**
             * 3-Tier candidate selection:
             * Tier 1: "Çalışır" (allowed) - always preferred for this area
             * Tier 2: "Boş kalırsa" (preferred) - backup when Tier 1 is empty
             * Tier 3: No rule (default) - fallback when Tiers 1 & 2 are empty
             */
            const tier1 = []; // Çalışır
            const tier2 = []; // Boş kalırsa
            const tier3 = []; // Default (no rule for this area)

            availablePeople.forEach(p => {
                const priority = getAreaPriority(p, area.id);
                if (priority === 'allowed') tier1.push(p);
                else if (priority === 'preferred') tier2.push(p);
                else if (priority === 'default') tier3.push(p);
                // 'blocked' is already filtered out by canWorkInArea
            });

            // Try tiers in order
            let candidates = tier1.length > 0 ? tier1 : (tier2.length > 0 ? tier2 : tier3);

            if (candidates.length === 0) {
                // No one available with constraints - try relaxing pair constraints
                const relaxedAvailable = getBaseAvailable(true);
                const rTier1 = [], rTier2 = [], rTier3 = [];
                relaxedAvailable.forEach(p => {
                    const priority = getAreaPriority(p, area.id);
                    if (priority === 'allowed') rTier1.push(p);
                    else if (priority === 'preferred') rTier2.push(p);
                    else if (priority === 'default') rTier3.push(p);
                });
                candidates = rTier1.length > 0 ? rTier1 : (rTier2.length > 0 ? rTier2 : rTier3);

                if (candidates.length > 0) {
                    const person = selectBestCandidate(candidates, area.id);
                    day[field] = person;
                    usedToday.add(person);
                    perPersonPerArea[person][area.id]++;
                    totalPerPerson[person]++;
                    console.log(`⚠️ Relaxed pair constraint for ${person} in ${area.name}`);
                } else {
                    console.warn(`❌ No one available for ${area.name} on ${day.date.toLocaleDateString()}`);
                }
                return;
            }

            // Normal case: Select best candidate from prioritized tier
            const person = selectBestCandidate(candidates, area.id);
            if (person) {
                day[field] = person;
                usedToday.add(person);
                perPersonPerArea[person][area.id]++;
                totalPerPerson[person]++;
            }
        }); // end workAreas.forEach
    }); // end schedule.forEach

    // === STEP 3: Enforce neverEmptyAreas ===
    if (ConstraintEngine.constraints.neverEmptyAreas.length > 0) {
        state.schedule.forEach((day) => {
            const nobetErtesiPeople = (day.nobetErtesi || '')
                .split(',')
                .map(p => p.trim().toLowerCase())
                .filter(Boolean);

            for (const rule of ConstraintEngine.constraints.neverEmptyAreas) {
                const field = `workArea${rule.areaId}`;
                if (day[field]) continue; // Already filled

                // Collect who's assigned today for other totals
                const usedToday = new Set();
                state.workAreas.forEach(a => {
                    const f = `workArea${a.id}`;
                    if (day[f]) usedToday.add(day[f]);
                });

                // Try to find anyone available (relaxing pair constraints)
                const candidate = state.people.find(p => {
                    if (usedToday.has(p)) return false;
                    if (nobetErtesiPeople.includes(p.toLowerCase())) return false;
                    if (!ConstraintEngine.isAvailable(p, day, rule.areaId)) return false;
                    return true;
                });

                if (candidate) {
                    day[field] = candidate;
                    perPersonPerArea[candidate][rule.areaId]++;
                    totalPerPerson[candidate]++;
                }
            }
        });
    }

    renderScheduleTable();
    updateStats();
    renderDetailedStats();
    renderActiveConstraints();
    saveToLocalStorage();
    state.hasUnsavedChanges = false;

    // Show success message with constraint summary
    if (summary.total > 0) {
        const aiNote = summary.aiSummary ? `\n${summary.aiSummary}` : '';
        Toast.success(`Program oluşturuldu! (${summary.total} koşul uygulandı)${aiNote}`, 7000);
    } else {
        Toast.success('Çalışma programı adaletli şekilde oluşturuldu!', 5000);
    }
}

// ============================================
// Generate and Auto-Start (from Step 4) with Loading Animation
// ============================================
async function generateAndAutoStart() {
    const overlay = document.getElementById('loadingOverlay');
    const progressBar = document.getElementById('loadingProgressBar');
    const steps = document.querySelectorAll('#loadingOverlay .loading-step');

    if (!overlay) {
        // Fallback if overlay doesn't exist
        try {
            await generateAndShowCalendar();
            await startAssignment();
        } catch (error) {
            console.error('Calendar generation error:', error);
            Toast.error('Program oluşturulurken bir hata oluştu!');
        }
        return;
    }

    // Show loading overlay
    overlay.classList.add('active');

    // Safety timeout - hide overlay after max 15 seconds to prevent permanent hang
    const safetyTimeout = setTimeout(() => {
        if (overlay.classList.contains('active')) {
            overlay.classList.remove('active');
            Toast.error('İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.');
        }
    }, 15000);

    // Reset progress
    if (progressBar) progressBar.style.width = '0%';
    steps.forEach(step => {
        step.classList.remove('active', 'completed');
        step.querySelector('.loading-step-icon').textContent = '○';
    });

    // Animation timings
    const stepDurations = [400, 500, 600, 800, 500]; // ms per step
    let currentStep = 0;
    let totalDuration = 0;

    // Animate through steps
    const animateStep = (stepIndex) => {
        if (stepIndex >= steps.length) return;

        const step = steps[stepIndex];
        step.classList.add('active');
        step.querySelector('.loading-step-icon').textContent = '◐';

        setTimeout(() => {
            step.classList.remove('active');
            step.classList.add('completed');
            step.querySelector('.loading-step-icon').textContent = '✓';

            // Update progress bar
            const progress = ((stepIndex + 1) / steps.length) * 100;
            if (progressBar) progressBar.style.width = `${progress}%`;

            // Animate next step
            if (stepIndex < steps.length - 1) {
                animateStep(stepIndex + 1);
            }
        }, stepDurations[stepIndex]);
    };

    // Start animation
    animateStep(0);

    // Calculate total animation duration
    totalDuration = stepDurations.reduce((a, b) => a + b, 0);

    // After animation, perform actual operations
    setTimeout(async () => {
        try {
            // Step 1: Create empty schedule (locally only, don't save to backend yet)
            const year = state.selectedYear;
            const month = state.selectedMonth;
            const days = getWorkDaysInMonth(year, month);

            if (days.length === 0) {
                Toast.warning('Bu ayda çalışma günü bulunamadı!');
                return;
            }

            // Apply shift delays
            days.forEach(day => {
                const dateStr = formatDateKey(day.date.getFullYear(), day.date.getMonth(), day.date.getDate());
                if (state.shiftDelays[dateStr]) {
                    day.nobetErtesi = state.shiftDelays[dateStr].join(', ');
                }
            });

            state.schedule = days;
            state.updatedAt = new Date().toISOString();

            // Step 2: Do constraint parsing + assignment
            await startAssignment();

            // Step 3: NOW save to backend with the assigned schedule
            if (AuthState.token) {
                const today = new Date();
                const datePrefix = today.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                const calendarTitle = `${datePrefix} - ${monthNames[month]} ${year} Takvimi`;

                const result = await ApiClient.createCalendar({
                    title: calendarTitle,
                    month: month,
                    year: year,
                    people: state.people,
                    workAreas: state.workAreas,
                    schedule: state.schedule,  // Save the ASSIGNED schedule, not empty
                    conditions: state.aiConditions || '',
                    shiftDelays: state.shiftDelays
                });

                state.backendCalendarId = result.calendar.id;
                state.calendarTitle = calendarTitle;
                state.createdAt = result.calendar.createdAt;

                if (result.usage) {
                    AuthState.updateUsage(result.usage);
                }

                Toast.success('Takvim oluşturuldu ve kaydedildi!');
            }
        } catch (error) {
            console.error('Calendar generation error:', error);
            Toast.error('Program oluşturulurken bir hata oluştu!');
        } finally {
            // Clear safety timeout
            clearTimeout(safetyTimeout);

            // Always hide overlay after a brief moment
            setTimeout(() => {
                overlay.classList.remove('active');
                // Navigate to Step 5 to show the calendar
                goToStep(5);
            }, 300);
        }
    }, totalDuration + 200);
}

// ============================================
// Redistribute Schedule (with save warning)
// Re-runs the full startAssignment algorithm with all constraints
// ============================================
async function redistributeSchedule() {
    if (state.people.length < 3) {
        Toast.warning('En az 3 kişi eklemeniz gerekiyor!');
        return;
    }

    if (state.schedule.length === 0) {
        Toast.warning('Önce takvimi oluşturun!');
        return;
    }

    // Check for unsaved changes
    if (state.hasUnsavedChanges) {
        const saveFirst = await Modal.confirm(
            '⚠️ Kaydedilmemiş değişiklikler var!\n\nYeniden dağıtmadan önce mevcut versiyonu kaydetmek ister misiniz?',
            { confirmText: 'Evet, Kaydet', cancelText: 'Hayır, Devam Et' }
        );
        if (saveFirst) {
            saveCurrentVersion();
        }
    }

    // Clear current assignments (keep nöbet ertesi data intact)
    state.schedule.forEach(day => {
        state.workAreas.forEach(area => {
            day[`workArea${area.id}`] = '';
        });
    });

    // Re-run the full assignment algorithm with ALL constraints
    await startAssignment();

    state.hasUnsavedChanges = true;
    Toast.success('Program yeniden dağıtıldı!');
}

// ============================================
// Render Inline Work Areas (above table)
// ============================================
function renderInlineWorkAreas() {
    const container = document.getElementById('inlineWorkAreas');
    if (!container) return;

    // Only show work area names with edit capability (no add/remove buttons)
    let html = state.workAreas.map(area => `
        <div class="inline-work-area-tag" onclick="promptRenameWorkAreaInline(${area.id})" title="İsmi düzenlemek için tıklayın">
            <span>${area.name}</span>
            <span class="edit-icon">✏️</span>
        </div>
    `).join('');

    container.innerHTML = html;
}

async function promptRenameWorkAreaInline(areaId) {
    const area = state.workAreas.find(a => a.id === areaId);
    if (!area) return;

    const newName = await Modal.prompt(`"${area.name}" alanının yeni adını girin:`, area.name);
    if (newName && newName.trim()) {
        area.name = newName.trim();
        renderInlineWorkAreas();
        renderTableHeader();
        renderWorkAreas();
        renderDetailedStats();
        renderActiveConstraints();
        saveToLocalStorage();
        Toast.info(`Alan adı "${newName.trim()}" olarak güncellendi`);
    }
}

async function removeWorkAreaInline(areaId) {
    if (state.workAreas.length <= 1) {
        Toast.warning('En az bir çalışma alanı olmalı!');
        return;
    }

    const area = state.workAreas.find(a => a.id === areaId);
    if (!area) return;

    const confirmed = await Modal.confirm(`"${area.name}" alanını silmek istediğinize emin misiniz?`);
    if (!confirmed) return;

    state.workAreas = state.workAreas.filter(a => a.id !== areaId);

    // Remove from schedule
    state.schedule.forEach(day => {
        delete day[`workArea${areaId}`];
    });

    state.hasUnsavedChanges = true;
    renderInlineWorkAreas();
    renderTableHeader();
    renderScheduleTable();
    renderWorkAreas();
    renderDetailedStats();
    renderActiveConstraints();
    saveToLocalStorage();
    Toast.info(`"${area.name}" alanı kaldırıldı`);
}

async function addWorkAreaInline() {
    const name = await Modal.prompt('Yeni çalışma alanı adını girin:');
    if (!name || !name.trim()) return;

    const newId = Math.max(...state.workAreas.map(a => a.id), 0) + 1;
    state.workAreas.push({ id: newId, name: name.trim() });

    // Add field to all schedule days
    state.schedule.forEach(day => {
        day[`workArea${newId}`] = '';
    });

    state.hasUnsavedChanges = true;
    renderInlineWorkAreas();
    renderTableHeader();
    renderScheduleTable();
    renderWorkAreas();
    renderDetailedStats();
    renderActiveConstraints();
    updatePreviewTable();
    saveToLocalStorage();
    Toast.success(`"${name.trim()}" alanı eklendi`);
}

// ============================================
// Detailed Statistics (per person per work area)
// ============================================
function renderDetailedStats() {
    const container = document.getElementById('detailedStatsGrid');
    if (!container) return;

    if (state.schedule.length === 0 || state.people.length === 0) {
        container.innerHTML = '<p style="color: rgba(255,255,255,0.4);">Henüz istatistik yok</p>';
        return;
    }

    // Calculate detailed stats: person x work area
    const personAreaStats = {};
    state.people.forEach(person => {
        personAreaStats[person] = {};
        state.workAreas.forEach(area => {
            personAreaStats[person][area.id] = 0;
        });
        personAreaStats[person].total = 0;
    });

    state.schedule.forEach(day => {
        state.workAreas.forEach(area => {
            const field = `workArea${area.id}`;
            const person = day[field];
            if (person && personAreaStats[person]) {
                personAreaStats[person][area.id]++;
                personAreaStats[person].total++;
            }
        });
    });

    // Build the stats table
    let tableHtml = `
        <div class="detailed-stats-card">
            <h4>👥 Kişi Bazlı Çalışma Dağılımı</h4>
            <table class="person-area-stats">
                <thead>
                    <tr>
                        <th>Kişi</th>
                        ${state.workAreas.map(a => `<th>${a.name}</th>`).join('')}
                        <th>Toplam</th>
                    </tr>
                </thead>
                <tbody>
    `;

    const sortedPeople = [...state.people].sort((a, b) =>
        personAreaStats[b].total - personAreaStats[a].total
    );

    sortedPeople.forEach(person => {
        const stats = personAreaStats[person];
        tableHtml += `
            <tr>
                <td>${person}</td>
                ${state.workAreas.map(a => {
            const count = stats[a.id];
            const highlight = count > 0 ? 'stat-cell-highlight' : '';
            return `<td class="${highlight}">${count}</td>`;
        }).join('')}
                <td class="stat-cell-highlight">${stats.total}</td>
            </tr>
        `;
    });

    tableHtml += `
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = tableHtml;

    // Add area summary card into the stats-row-split (alongside person stats)
    const splitRow = document.querySelector('.stats-row-split');
    if (!splitRow) return;

    // Remove any existing area card in split row
    const existingAreaCard = splitRow.querySelector('.area-stats-card-detailed');
    if (existingAreaCard) existingAreaCard.remove();

    const areaTotals = {};
    state.workAreas.forEach(area => {
        areaTotals[area.id] = { name: area.name, count: 0 };
    });

    state.schedule.forEach(day => {
        state.workAreas.forEach(area => {
            if (day[`workArea${area.id}`]) {
                areaTotals[area.id].count++;
            }
        });
    });

    let areaHtml = `
        <div class="stats-card area-stats-card-detailed">
            <h3>🏢 Alan Bazlı Doluluk</h3>
            <table class="person-area-stats">
                <thead>
                    <tr>
                        <th>Çalışma Alanı</th>
                        <th>Dolu Gün</th>
                        <th>Toplam Gün</th>
                        <th>Oran</th>
                    </tr>
                </thead>
                <tbody>
    `;

    state.workAreas.forEach(area => {
        const filled = areaTotals[area.id].count;
        const total = state.schedule.length;
        const percentage = total > 0 ? Math.round((filled / total) * 100) : 0;
        areaHtml += `
            <tr>
                <td>${area.name}</td>
                <td class="stat-cell-highlight">${filled}</td>
                <td>${total}</td>
                <td class="stat-cell-highlight">${percentage}%</td>
            </tr>
        `;
    });

    areaHtml += `
                </tbody>
            </table>
        </div>
    `;

    splitRow.insertAdjacentHTML('beforeend', areaHtml);

    // === NEW: Daily Assignment Heatmap (Person × Day) ===
    const dailyStatsContainer = document.getElementById('dailyStatsGrid');
    if (!dailyStatsContainer) {
        // Create the container if it doesn't exist
        const section = document.getElementById('detailedStatsSection');
        if (section) {
            const existingDaily = section.querySelector('#dailyStatsGrid');
            if (!existingDaily) {
                const div = document.createElement('div');
                div.id = 'dailyStatsGrid';
                div.className = 'detailed-stats-grid';
                div.style.marginTop = '1.5rem';
                section.appendChild(div);
            }
        }
    }

    const dailyGrid = document.getElementById('dailyStatsGrid');
    if (!dailyGrid) return;

    // Calculate person × weekday data
    const weekdayNames = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
    const weekdayShort = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

    const personWeekdayStats = {};
    state.people.forEach(person => {
        personWeekdayStats[person] = [0, 0, 0, 0, 0, 0, 0]; // Mon-Sun
    });

    state.schedule.forEach(day => {
        const d = day.date instanceof Date ? day.date : new Date(day.date);
        // JS getDay(): 0=Sun, 1=Mon ... 6=Sat → convert to 0=Mon ... 6=Sun
        const jsDay = d.getDay();
        const weekdayIdx = jsDay === 0 ? 6 : jsDay - 1;

        state.workAreas.forEach(area => {
            const person = day[`workArea${area.id}`];
            if (person && personWeekdayStats[person]) {
                personWeekdayStats[person][weekdayIdx]++;
            }
        });
    });

    // Build the weekday stats table
    let dailyHtml = `
        <div class="detailed-stats-card">
            <h4>📅 Gün Bazında Görev Dağılımı</h4>
            <table class="person-area-stats">
                <thead>
                    <tr>
                        <th>Kişi</th>
                        ${weekdayNames.map((name, i) => `<th>${weekdayShort[i]}</th>`).join('')}
                        <th>Toplam</th>
                    </tr>
                </thead>
                <tbody>
    `;

    // Sort people by total assignments (descending)
    const sortedByTotal = [...state.people].sort((a, b) => {
        const totalA = personWeekdayStats[a].reduce((s, v) => s + v, 0);
        const totalB = personWeekdayStats[b].reduce((s, v) => s + v, 0);
        return totalB - totalA;
    });

    sortedByTotal.forEach(person => {
        const stats = personWeekdayStats[person];
        const total = stats.reduce((s, v) => s + v, 0);

        dailyHtml += `
            <tr>
                <td>${person}</td>
                ${stats.map(count => {
            let cellClass = count > 0 ? 'stat-cell-highlight' : '';
            return `<td class="${cellClass}">${count}</td>`;
        }).join('')}
                <td class="stat-cell-highlight">${total}</td>
            </tr>
        `;
    });

    dailyHtml += `
                </tbody>
            </table>
        </div>
    `;

    dailyGrid.innerHTML = dailyHtml;
}

// ============================================
// Render Active Constraints in Step 5
// ============================================
function renderActiveConstraints() {
    const container = document.getElementById('activeConstraintsList');
    if (!container) return;

    const items = [];

    // 1. Area rules
    if (visualConstraints.personAreaRules) {
        Object.entries(visualConstraints.personAreaRules).forEach(([person, areas]) => {
            Object.entries(areas).forEach(([areaId, rule]) => {
                if (rule === 'allowed') return;
                const area = state.workAreas.find(a => String(a.id) === String(areaId));
                const areaName = area ? area.name : `Alan ${areaId}`;
                if (rule === 'blocked') {
                    items.push(`<div class="active-constraint-item"><span class="constraint-icon">🚫</span> <strong>${person}</strong> → ${areaName} alanında çalışmasın</div>`);
                } else if (rule === 'preferred') {
                    items.push(`<div class="active-constraint-item"><span class="constraint-icon">⭐</span> <strong>${person}</strong> → ${areaName} alanını tercih eder</div>`);
                }
            });
        });
    }

    // 2. Day-off rules
    if (visualConstraints.dayOffRules) {
        Object.entries(visualConstraints.dayOffRules).forEach(([dateStr, people]) => {
            if (!people || people.length === 0) return;
            const d = new Date(dateStr);
            const dayNum = d.getDate();
            const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            const monthName = monthNames[d.getMonth()];
            people.forEach(person => {
                items.push(`<div class="active-constraint-item"><span class="constraint-icon">📅</span> <strong>${person}</strong> → ${dayNum} ${monthName} izinli</div>`);
            });
        });
    }

    // 3. Pair restrictions
    if (visualConstraints.pairRules && visualConstraints.pairRules.length > 0) {
        visualConstraints.pairRules.forEach(pair => {
            items.push(`<div class="active-constraint-item"><span class="constraint-icon">👥</span> <strong>${pair.person1}</strong> ⟷ <strong>${pair.person2}</strong> aynı gün çalışmasın</div>`);
        });
    }

    // 4. Seniority order
    if (visualConstraints.seniorityOrder && visualConstraints.seniorityOrder.length > 0) {
        const order = visualConstraints.seniorityOrder.join(' → ');
        items.push(`<div class="active-constraint-item"><span class="constraint-icon">📊</span> Kıdem sırası: ${order}</div>`);
    }

    // 5. Weekly priority
    if (visualConstraints.weeklyPriority) {
        Object.entries(visualConstraints.weeklyPriority).forEach(([weekIdx, areas]) => {
            Object.entries(areas).forEach(([areaId, person]) => {
                const area = state.workAreas.find(a => String(a.id) === String(areaId));
                const areaName = area ? area.name : `Alan ${areaId}`;
                items.push(`<div class="active-constraint-item"><span class="constraint-icon">📆</span> <strong>${person}</strong> → ${parseInt(weekIdx) + 1}. Hafta ${areaName} alanında sabit</div>`);
            });
        });
    }

    if (items.length === 0) {
        container.innerHTML = '<div class="cb-empty-state">Herhangi bir koşul uygulanmadı.</div>';
    } else {
        container.innerHTML = items.join('');
    }
}

// ============================================
// Update Page Title (from schedule title)
// ============================================
function updatePageTitleDisplay() {
    const mainTitle = document.getElementById('mainPageTitle');
    const mainSubtitle = document.getElementById('mainPageSubtitle');

    if (state.scheduleTitle && state.scheduleTitle.trim()) {
        if (mainTitle) mainTitle.textContent = `📋 ${state.scheduleTitle}`;
        if (mainSubtitle) mainSubtitle.textContent = `${getMonthName(state.selectedMonth)} ${state.selectedYear} Çalışma Programı`;
    } else {
        if (mainTitle) mainTitle.textContent = '📋 Vardiya Planlama';
        if (mainSubtitle) mainSubtitle.textContent = 'Adım adım çalışma programınızı oluşturun';
    }
}

// ============================================
// Clear All
// ============================================
async function clearAll() {
    const confirmed = await Modal.confirm('Tüm atamalar silinecek. Emin misiniz?');
    if (!confirmed) return;

    state.schedule.forEach(day => {
        state.workAreas.forEach(area => {
            day[`workArea${area.id}`] = '';
        });
    });

    renderScheduleTable();
    updateStats();
    saveToLocalStorage();
    Toast.success('Tümü temizlendi');
}

// Clear and redistribute - combined action
async function clearAndRedistribute() {
    // Re-run full assignment with all constraints
    startAssignment();
}

// Share current version - shows share modal with link and options
async function shareCurrentVersion() {
    if (state.schedule.length === 0) {
        Toast.warning('Önce bir takvim oluşturun!');
        return;
    }

    // Save to localStorage first
    saveToLocalStorage();

    // If not logged in, generate local share link (URL hash-based)
    if (!AuthState.isLoggedIn()) {
        try {
            const shareData = {
                t: state.scheduleTitle || `${monthNames[state.selectedMonth]} ${state.selectedYear}`,
                m: state.selectedMonth,
                y: state.selectedYear,
                p: state.people,
                w: state.workAreas,
                s: state.schedule.map(day => {
                    const d = {};
                    d.dn = day.dayName;
                    d.dt = day.date instanceof Date ? day.date.toISOString() : day.date;
                    state.workAreas.forEach(area => {
                        const val = day[`workArea${area.id}`];
                        if (val) d[`a${area.id}`] = val;
                    });
                    if (day.nobetErtesi) d.ne = day.nobetErtesi;
                    return d;
                }),
                ne: state.showNobetErtesi
            };

            const jsonStr = JSON.stringify(shareData);
            const compressed = btoa(unescape(encodeURIComponent(jsonStr)));
            const shareUrl = `${window.location.origin}/view.html#data=${compressed}`;

            showLocalExportModal(shareUrl);
            Toast.success('Paylaşım linki hazır!');
        } catch (error) {
            console.error('Local share error:', error);
            Toast.error('Paylaşım linki oluşturulamadı: ' + error.message);
            showLocalExportModal(null);
        }
        return;
    }

    // Logged in — determine calendar ID (backendCalendarId or calendarId)
    let calId = state.backendCalendarId || state.calendarId;

    try {
        // If no backend calendar exists yet, save to cloud first
        if (!calId) {
            Toast.info('Takvim buluta kaydediliyor...');
            const saved = await saveToCloud();
            if (!saved) {
                Toast.error('Takvim kaydedilemedi, paylaşım yapılamıyor.');
                return;
            }
            calId = state.backendCalendarId || state.calendarId;
        }

        Toast.info('Takvim kaydediliyor...');

        // Save current schedule to backend (skipCounter: share-triggered saves don't count)
        await ApiClient.request(`/calendars/${calId}?skipCounter=true`, {
            method: 'PUT',
            body: JSON.stringify({
                title: state.scheduleTitle,
                month: state.selectedMonth,
                year: state.selectedYear,
                people: state.people,
                workAreas: state.workAreas,
                schedule: state.schedule,
                conditions: state.conditions,
                shiftDelays: state.shiftDelays
            })
        });

        Toast.info('Paylaşım linki oluşturuluyor...');
        const result = await ApiClient.request(`/calendars/${calId}/share`, {
            method: 'POST'
        });
        // Show share modal with all options
        showShareOptionsModal(result.shareUrl);
        Toast.success('Paylaşım linki hazır!');
    } catch (error) {
        console.error('Share error:', error);
        Toast.error('Paylaşım hatası: ' + error.message);
    }
}

// Show export modal for non-logged-in users (with optional share link)
function showLocalExportModal(shareUrl) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'shareOptionsModal';

    const shareLinkSection = shareUrl ? `
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">🔗 Paylaşım Linki</label>
                    <div style="display: flex; gap: 0.5rem;">
                        <input type="text" id="localShareLinkInput" value="${shareUrl}" readonly 
                               style="flex: 1; padding: 0.6rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05); color: var(--text-primary); font-size: 0.8rem;">
                        <button onclick="copyLocalShareLink()" class="btn btn-primary" style="padding: 0.6rem 1rem; white-space: nowrap;">📋 Kopyala</button>
                    </div>
                    <p style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-secondary);">Bu linki paylaşarak takvimi görüntüleyebilirsiniz.</p>
                </div>
                <hr style="border-color: rgba(255,255,255,0.1); margin: 1rem 0;">` : '';

    modal.innerHTML = `
        <div class="modal" style="max-width: 450px;">
            <div class="modal-header">
                <h3>📤 Paylaş & Dışa Aktar</h3>
            </div>
            <div class="modal-body" style="padding: 1.5rem;">
                ${shareLinkSection}
                <p style="margin-bottom: 1rem; font-size: 0.9rem; color: var(--text-secondary);">
                    Takvimi dışa aktarmak için bir yöntem seçin.
                </p>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem;">
                    <button onclick="closeShareModal(); exportPDF();" class="btn btn-outline" style="padding: 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.5rem;">📄</span>
                        <span>PDF</span>
                    </button>
                    <button onclick="closeShareModal(); captureScreenshot();" class="btn btn-outline" style="padding: 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.5rem;">📸</span>
                        <span>Resim</span>
                    </button>
                    <button onclick="closeShareModal(); window.open('/print', '_blank');" class="btn btn-outline" style="padding: 0.75rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                        <span style="font-size: 1.5rem;">🖨️</span>
                        <span>Yazdır</span>
                    </button>
                </div>
                <div style="margin-top: 1rem; text-align: center;">
                    <button onclick="closeShareModal()" class="btn btn-secondary">Kapat</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Copy local share link to clipboard
function copyLocalShareLink() {
    const input = document.getElementById('localShareLinkInput');
    if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
            Toast.success('Link panoya kopyalandı!');
        }).catch(() => {
            input.select();
            document.execCommand('copy');
            Toast.success('Link panoya kopyalandı!');
        });
    }
}

// Show share modal with multiple export options
function showShareOptionsModal(shareUrl) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'shareOptionsModal';
    modal.innerHTML = `
        <div class="modal" style="max-width: 550px;">
            <div class="modal-header">
                <h3>📤 Paylaş & Dışa Aktar</h3>
            </div>
            <div class="modal-body" style="padding: 1.5rem;">
                <!-- Share Link Section -->
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 600; color: var(--text-primary);">
                        🔗 Paylaşım Linki
                    </label>
                    <p style="margin-bottom: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">
                        Bu link ile herkes takvimi görüntüleyebilir (düzenleyemez).
                    </p>
                    <div style="display: flex; gap: 0.5rem;">
                        <input type="text" value="${shareUrl}" readonly 
                               style="flex: 1; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--background-secondary); font-size: 0.9rem;"
                               id="shareUrlInput">
                        <button onclick="copyShareLink()" class="btn btn-primary" style="padding: 0.75rem 1rem;">
                            📋 Kopyala
                        </button>
                    </div>
                </div>

                <!-- Export Options -->
                <div style="border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
                    <label style="display: block; margin-bottom: 1rem; font-weight: 600; color: var(--text-primary);">
                        📥 Dışa Aktar
                    </label>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem;">
                        <button onclick="openShareLink('${shareUrl}')" class="btn btn-outline" style="padding: 0.75rem;">
                            🌐 Aç
                        </button>
                        <button onclick="closeShareModal(); exportPDF();" class="btn btn-outline" style="padding: 0.75rem;">
                            📄 PDF
                        </button>
                        <button onclick="closeShareModal(); captureScreenshot();" class="btn btn-outline" style="padding: 0.75rem;">
                            📸 Resim
                        </button>
                    </div>
                </div>

                <!-- Close Button -->
                <div style="margin-top: 1.5rem; text-align: center;">
                    <button onclick="closeShareModal()" class="btn btn-secondary">
                        Kapat
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function copyShareLink() {
    const input = document.getElementById('shareUrlInput');
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
        Toast.success('Link kopyalandı!');
    }).catch(() => {
        document.execCommand('copy');
        Toast.success('Link kopyalandı!');
    });
}

function openShareLink(url) {
    window.location.href = url;
}

function closeShareModal() {
    const modal = document.getElementById('shareOptionsModal');
    if (modal) modal.remove();
}

// ============================================
// Export / Print / Share
// ============================================
function exportSchedule() {
    if (state.schedule.length === 0) {
        Toast.warning('Paylaşılacak program yok!');
        return;
    }

    saveToLocalStorage();
    window.open('/print', '_blank');
}

// Share calendar with unique link
async function shareCalendar() {
    if (!state.backendCalendarId) {
        Toast.warning('Önce takvimi kaydedin!');
        return;
    }

    if (!AuthState.isLoggedIn()) {
        Toast.warning('Paylaşmak için giriş yapın!');
        return;
    }

    try {
        Toast.info('Paylaşım linki oluşturuluyor...');

        const result = await ApiClient.request(`/calendars/${state.backendCalendarId}/share`, {
            method: 'POST'
        });

        // Show share modal
        showShareModal(result.shareUrl);
        Toast.success('Paylaşım linki oluşturuldu!');
    } catch (error) {
        console.error('Share error:', error);
        Toast.error('Paylaşım başarısız: ' + error.message);
    }
}

function showShareModal(shareUrl) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'shareModal';
    modal.innerHTML = `
        <div class="modal" style="max-width: 500px;">
            <div class="modal-header">
                <h3>🔗 Paylaşım Linki</h3>
            </div>
            <div class="modal-body" style="padding: 1.5rem;">
                <p style="margin-bottom: 1rem; color: var(--text-secondary);">
                    Bu link ile herkes takvimi görüntüleyebilir (düzenleyemez).
                </p>
                <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem;">
                    <input type="text" value="${shareUrl}" readonly 
                           style="flex: 1; padding: 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); background: var(--background-secondary);"
                           id="shareUrlInput">
                    <button onclick="copyShareUrl()" class="btn btn-primary" style="padding: 0.75rem 1rem;">
                        📋 Kopyala
                    </button>
                </div>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button onclick="document.getElementById('shareModal').remove()" class="btn btn-secondary">
                        Kapat
                    </button>
                    <a href="${shareUrl}" target="_blank" class="btn btn-primary">
                        Linki Aç
                    </a>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function copyShareUrl() {
    const input = document.getElementById('shareUrlInput');
    input.select();
    document.execCommand('copy');
    Toast.success('Link kopyalandı!');
}

// Export as PDF with smart pagination
async function exportPDF() {
    if (state.schedule.length === 0) {
        Toast.warning('Dışa aktarılacak program yok!');
        return;
    }

    // Load jsPDF if not already loaded
    if (!window.jspdf) {
        Toast.info('PDF kütüphanesi yükleniyor...');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }

    Toast.info('PDF oluşturuluyor...');

    try {
        const table = document.querySelector('#scheduleTable');
        if (!table) {
            Toast.error('Tablo bulunamadı!');
            return;
        }

        // Replace <select> elements with styled text spans so html2canvas can render names
        const selectsData = [];
        table.querySelectorAll('select').forEach(sel => {
            const selectedText = sel.options[sel.selectedIndex]?.text || '';
            const span = document.createElement('span');
            span.textContent = selectedText;
            span.style.cssText = 'display:block;padding:4px 8px;font-size:0.85rem;color:#1e293b;font-weight:500;white-space:nowrap;';
            sel.style.display = 'none';
            sel.parentNode.insertBefore(span, sel.nextSibling);
            selectsData.push({ select: sel, span });
        });

        const canvas = await html2canvas(table, {
            scale: 2,
            backgroundColor: '#ffffff',
            logging: false,
            useCORS: true
        });

        // Restore original <select> elements
        selectsData.forEach(({ select, span }) => {
            select.style.display = '';
            span.remove();
        });

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;

        const imgWidth = pageWidth - (margin * 2);
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        if (imgHeight <= pageHeight - (margin * 2)) {
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, imgWidth, imgHeight);
        } else {
            // Multi-page
            const pageImgHeight = pageHeight - (margin * 2);
            let remainingHeight = imgHeight;
            let srcY = 0;
            let pageNum = 0;

            while (remainingHeight > 0) {
                if (pageNum > 0) pdf.addPage();

                const sliceHeight = Math.min(pageImgHeight, remainingHeight);
                const srcHeight = (sliceHeight / imgHeight) * canvas.height;

                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvas.width;
                sliceCanvas.height = srcHeight;
                const ctx = sliceCanvas.getContext('2d');
                ctx.drawImage(canvas, 0, srcY, canvas.width, srcHeight, 0, 0, canvas.width, srcHeight);

                pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, margin, imgWidth, sliceHeight);

                srcY += srcHeight;
                remainingHeight -= pageImgHeight;
                pageNum++;
            }
        }

        const title = state.scheduleTitle || `${monthNames[state.selectedMonth]}_${state.selectedYear}`;
        pdf.save(`${title}.pdf`);
        Toast.success('PDF indirildi!');
    } catch (error) {
        console.error('PDF error:', error);
        Toast.error('PDF oluşturulamadı');
    }
}

// Export as screenshot PNG
async function captureScreenshot() {
    if (state.schedule.length === 0) {
        Toast.warning('Görüntülenecek program yok!');
        return;
    }

    if (!window.html2canvas) {
        Toast.info('Kütüphane yükleniyor...');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }

    Toast.info('Ekran görüntüsü alınıyor...');

    try {
        const table = document.querySelector('#scheduleTable');
        if (!table) {
            Toast.error('Tablo bulunamadı!');
            return;
        }

        // Replace <select> elements with styled text spans so html2canvas can render names
        const selectsData = [];
        table.querySelectorAll('select').forEach(sel => {
            const selectedText = sel.options[sel.selectedIndex]?.text || '';
            const span = document.createElement('span');
            span.textContent = selectedText;
            span.style.cssText = 'display:block;padding:4px 8px;font-size:0.85rem;color:#1e293b;font-weight:500;white-space:nowrap;';
            sel.style.display = 'none';
            sel.parentNode.insertBefore(span, sel.nextSibling);
            selectsData.push({ select: sel, span });
        });

        const canvas = await html2canvas(table, {
            scale: 2,
            backgroundColor: '#ffffff',
            logging: false,
            useCORS: true
        });

        // Restore original <select> elements
        selectsData.forEach(({ select, span }) => {
            select.style.display = '';
            span.remove();
        });

        const link = document.createElement('a');
        const title = state.scheduleTitle || `${monthNames[state.selectedMonth]}_${state.selectedYear}`;
        link.download = `${title}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        Toast.success('Ekran görüntüsü indirildi!');
    } catch (error) {
        console.error('Screenshot error:', error);
        Toast.error('Ekran görüntüsü alınamadı');
    }
}

// Helper to load scripts dynamically
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// ============================================
// Version Management with Tabs
// ============================================
function renderVersionTabs() {
    const tabsList = document.getElementById('versionTabsList');
    if (!tabsList) return;

    const versions = JSON.parse(localStorage.getItem('hospitalScheduleVersions') || '[]');

    tabsList.innerHTML = `
        <div class="version-tab ${state.activeVersionIndex === -1 ? 'active' : ''}" 
             data-version="current" onclick="loadCurrentVersion()">Birinci Versiyon</div>
        ${versions.map((v, i) => `
            <div class="version-tab ${state.activeVersionIndex === i ? 'active' : ''}" 
                 data-version="${i}" onclick="loadVersionTab(${i})">
                ${v.name}
                <span class="delete-tab" onclick="event.stopPropagation(); deleteVersionTab(${i})">✕</span>
            </div>
        `).join('')}
    `;
}

// Save to currently active version (main save button)
async function saveCurrentVersion() {
    if (state.schedule.length === 0) {
        Toast.warning('Önce bir takvim oluşturun!');
        return;
    }

    const versions = JSON.parse(localStorage.getItem('hospitalScheduleVersions') || '[]');

    if (state.activeVersionIndex === -1) {
        // Saving to "Mevcut" - just save to localStorage
        saveToLocalStorage();
        state.hasUnsavedChanges = false;
        Toast.success('Mevcut versiyon kaydedildi!');
    } else {
        // Saving to a specific version
        saveToVersionTab(state.activeVersionIndex);
    }
}

// Save to a specific version tab
function saveToVersionTab(index) {
    const versions = JSON.parse(localStorage.getItem('hospitalScheduleVersions') || '[]');
    if (index < 0 || index >= versions.length) return;

    const versionData = {
        name: versions[index].name,
        date: new Date().toISOString(),
        calendarId: state.calendarId,
        month: state.selectedMonth,
        year: state.selectedYear,
        scheduleTitle: state.scheduleTitle,
        showNobetErtesi: state.showNobetErtesi,
        schedule: state.schedule.map(day => {
            const dayData = {
                date: day.date.toISOString(),
                dayName: day.dayName,
                weekNumber: day.weekNumber,
                nobetErtesi: day.nobetErtesi,
            };
            state.workAreas.forEach(area => {
                dayData[`workArea${area.id}`] = day[`workArea${area.id}`] || '';
            });
            return dayData;
        }),
        workAreas: state.workAreas,
        people: state.people,
        aiConditions: state.aiConditions,
        shiftDelays: state.shiftDelays,
    };

    versions[index] = versionData;
    localStorage.setItem('hospitalScheduleVersions', JSON.stringify(versions));
    state.hasUnsavedChanges = false;
    Toast.success(`"${versionData.name}" güncellendi!`);
}

// Add a new version (prompts for name)
async function addNewVersion() {
    if (state.schedule.length === 0) {
        Toast.warning('Önce bir takvim oluşturun!');
        return;
    }

    // Check version limit via unified checkUserLimits
    if (!checkUserLimits('version')) {
        return;
    }

    const versionName = await Modal.prompt('Versiyon adı girin:', 'örn: Deneme 1, İlk Plan');
    if (!versionName) return;

    const versions = JSON.parse(localStorage.getItem('hospitalScheduleVersions') || '[]');

    const versionData = {
        name: versionName,
        date: new Date().toISOString(),
        calendarId: state.calendarId,
        month: state.selectedMonth,
        year: state.selectedYear,
        scheduleTitle: state.scheduleTitle,
        showNobetErtesi: state.showNobetErtesi,
        schedule: state.schedule.map(day => {
            const dayData = {
                date: day.date.toISOString(),
                dayName: day.dayName,
                weekNumber: day.weekNumber,
                nobetErtesi: day.nobetErtesi,
            };
            state.workAreas.forEach(area => {
                dayData[`workArea${area.id}`] = day[`workArea${area.id}`] || '';
            });
            return dayData;
        }),
        workAreas: state.workAreas,
        people: state.people,
        aiConditions: state.aiConditions,
        shiftDelays: state.shiftDelays,
    };

    // Save to localStorage first
    versions.push(versionData);
    localStorage.setItem('hospitalScheduleVersions', JSON.stringify(versions));

    // If logged in, also save to cloud to track usage
    if (AuthState.isLoggedIn()) {
        try {
            // If no calendarId, create calendar first
            if (!state.calendarId) {
                if (!checkUserLimits('create')) {
                    Toast.warning(`"${versionName}" lokalde kaydedildi ancak buluta kaydedilemedi.`);
                    state.activeVersionIndex = versions.length - 1;
                    state.hasUnsavedChanges = false;
                    renderVersionTabs();
                    return;
                }
                const calendarData = {
                    title: state.scheduleTitle || `${monthNames[state.selectedMonth]} ${state.selectedYear}`,
                    month: state.selectedMonth,
                    year: state.selectedYear,
                    people: state.people,
                    workAreas: state.workAreas,
                    schedule: versionData.schedule,
                    conditions: state.aiConditions,
                    shiftDelays: state.shiftDelays
                };
                const result = await ApiClient.createCalendar(calendarData);
                state.calendarId = result.calendar.id;
            } else {
                // Update existing calendar with new version data
                const calendarData = {
                    title: state.scheduleTitle || `${monthNames[state.selectedMonth]} ${state.selectedYear}`,
                    people: state.people,
                    workAreas: state.workAreas,
                    schedule: versionData.schedule,
                    conditions: state.aiConditions,
                    shiftDelays: state.shiftDelays
                };
                await ApiClient.updateCalendar(state.calendarId, calendarData);
            }

            // Refresh usage from server
            const usageData = await ApiClient.getUsage();
            AuthState.updateUsage(usageData);
            updateUserUI();
        } catch (error) {
            console.error('Cloud save error:', error);
            Toast.warning(`"${versionName}" lokalde kaydedildi. Bulut senkronizasyonu başarısız: ${error.message}`);
        }
    }

    state.activeVersionIndex = versions.length - 1;
    state.hasUnsavedChanges = false;
    renderVersionTabs();
    Toast.success(`"${versionName}" kaydedildi!`);
}

// Check for unsaved changes before switching versions
async function checkUnsavedChanges() {
    if (!state.hasUnsavedChanges) return true;

    const result = await Modal.show({
        type: 'confirm',
        title: 'Kaydedilmemiş Değişiklikler',
        message: 'Kaydedilmemiş değişiklikler var. Kaydetmeden devam etmek istiyor musunuz?',
        icon: '⚠️'
    });

    if (result) {
        // User chose to discard changes
        state.hasUnsavedChanges = false;
        return true;
    }
    return false;
}

async function loadCurrentVersion() {
    const canProceed = await checkUnsavedChanges();
    if (!canProceed) return;

    state.activeVersionIndex = -1;
    state.hasUnsavedChanges = false;
    loadFromLocalStorage();
    renderTableHeader();
    renderScheduleTable();
    updateStats();
    renderVersionTabs();
    Toast.info('Mevcut versiyon yüklendi');
}

async function loadVersionTab(index) {
    const canProceed = await checkUnsavedChanges();
    if (!canProceed) return;

    const versions = JSON.parse(localStorage.getItem('hospitalScheduleVersions') || '[]');
    if (index < 0 || index >= versions.length) return;

    const version = versions[index];

    state.workAreas = version.workAreas || state.workAreas;
    state.people = version.people || state.people;
    state.aiConditions = version.aiConditions || '';
    state.shiftDelays = version.shiftDelays || {};
    state.selectedMonth = version.month ?? state.selectedMonth;
    state.selectedYear = version.year ?? state.selectedYear;
    state.scheduleTitle = version.scheduleTitle || '';
    state.showNobetErtesi = version.showNobetErtesi !== undefined ? version.showNobetErtesi : true;
    state.schedule = version.schedule.map(day => ({
        ...day,
        date: new Date(day.date),
    }));

    state.activeVersionIndex = index;
    state.hasUnsavedChanges = false;

    renderWorkAreas();
    renderTableHeader();
    renderScheduleTable();
    updateStats();
    renderVersionTabs();

    Toast.success(`"${version.name}" yüklendi`);
}

async function deleteVersionTab(index) {
    const confirmed = await Modal.confirm('Bu versiyonu silmek istediğinize emin misiniz?');
    if (!confirmed) return;

    const versions = JSON.parse(localStorage.getItem('hospitalScheduleVersions') || '[]');
    versions.splice(index, 1);
    localStorage.setItem('hospitalScheduleVersions', JSON.stringify(versions));

    if (state.activeVersionIndex === index) {
        state.activeVersionIndex = -1;
    } else if (state.activeVersionIndex > index) {
        state.activeVersionIndex--;
    }

    renderVersionTabs();
    Toast.success('Versiyon silindi');
}

// ============================================
// Stats Toggle
// ============================================
function toggleStats() {
    const sidebar = document.getElementById('statsSidebar');
    const toggle = document.getElementById('statsToggle');
    const main = document.getElementById('calendarMain');

    if (!sidebar) return;

    if (sidebar.classList.contains('hidden')) {
        sidebar.classList.remove('hidden');
        if (toggle) toggle.style.display = 'none';
        if (main) main.classList.remove('full-width');
    } else {
        sidebar.classList.add('hidden');
        if (toggle) toggle.style.display = 'block';
        if (main) main.classList.add('full-width');
    }
}

// ============================================
// AI Conditions (Step 4)
// ============================================
function applyConditions() {
    const textarea = document.getElementById('aiConditions');
    if (textarea) {
        state.aiConditions = textarea.value.trim();
        saveToLocalStorage();
    }
    generateAndShowCalendar();
}

// ============================================
// Local Storage
// ============================================
function saveToLocalStorage() {
    const data = {
        calendarId: state.calendarId,
        createdAt: state.createdAt,
        updatedAt: new Date().toISOString(),
        people: state.people,
        selectedMonth: state.selectedMonth,
        selectedYear: state.selectedYear,
        scheduleTitle: state.scheduleTitle,
        showNobetErtesi: state.showNobetErtesi,
        workAreas: state.workAreas,
        nextWorkAreaId: state.nextWorkAreaId,
        shiftDelays: state.shiftDelays,
        aiConditions: state.aiConditions,
        currentStep: state.currentStep,
        schedule: state.schedule.map(day => {
            const dayData = {
                date: day.date.toISOString(),
                dayName: day.dayName,
                weekNumber: day.weekNumber,
                nobetErtesi: day.nobetErtesi,
            };
            state.workAreas.forEach(area => {
                dayData[`workArea${area.id}`] = day[`workArea${area.id}`] || '';
            });
            return dayData;
        }),
    };
    localStorage.setItem('hospitalScheduleApp', JSON.stringify(data));
}

// Cloud sync functions for authenticated users
async function saveToCloud() {
    if (!AuthState.isLoggedIn()) {
        Toast.info('Buluta kaydetmek için giriş yapın.');
        return false;
    }

    if (!checkUserLimits('version')) return false;

    const calendarData = {
        title: state.scheduleTitle || `${monthNames[state.selectedMonth]} ${state.selectedYear}`,
        month: state.selectedMonth,
        year: state.selectedYear,
        people: state.people,
        workAreas: state.workAreas,
        schedule: state.schedule.map(day => {
            const dayData = {
                date: day.date.toISOString(),
                dayName: day.dayName,
                weekNumber: day.weekNumber,
                nobetErtesi: day.nobetErtesi,
            };
            state.workAreas.forEach(area => {
                dayData[`workArea${area.id}`] = day[`workArea${area.id}`] || '';
            });
            return dayData;
        }),
        conditions: state.aiConditions,
        shiftDelays: state.shiftDelays
    };

    try {
        let result;
        if (state.calendarId) {
            result = await ApiClient.updateCalendar(state.calendarId, calendarData);
            Toast.success('Takvim güncellendi!');
        } else {
            if (!checkUserLimits('create')) return false;
            result = await ApiClient.createCalendar(calendarData);
            state.calendarId = result.calendar.id;
            state.backendCalendarId = result.calendar.id;
            Toast.success('Takvim buluta kaydedildi!');
        }

        // Update usage
        const usageData = await ApiClient.getUsage();
        AuthState.updateUsage(usageData);
        updateUserUI();

        return true;
    } catch (error) {
        Toast.error('Kaydetme başarısız: ' + error.message);
        return false;
    }
}

async function loadFromCloud(calendarId) {
    if (!AuthState.isLoggedIn()) return false;

    try {
        const result = await ApiClient.getCalendar(calendarId);
        const cal = result.calendar;

        // Set backend calendar ID to prevent duplicate creation
        state.backendCalendarId = cal.id;
        state.calendarId = cal.id;
        state.calendarTitle = cal.title;
        state.scheduleTitle = cal.title;
        state.selectedMonth = cal.month;
        state.selectedYear = cal.year;
        state.people = cal.people || [];
        state.workAreas = cal.workAreas || [];
        state.aiConditions = cal.conditions || '';
        state.shiftDelays = cal.shiftDelays || {};
        state.createdAt = cal.createdAt;

        if (cal.schedule && cal.schedule.length > 0) {
            state.schedule = cal.schedule.map(day => ({
                ...day,
                date: new Date(day.date)
            }));
        }

        saveToLocalStorage();

        // Navigate to step 5 and render the calendar
        goToStep(5);
        renderTableHeader();
        renderScheduleTable();
        renderWorkAreas();
        renderInlineWorkAreas();
        updateStats();
        renderDetailedStats();
        renderActiveConstraints();
        renderVersionTabs();
        updatePageTitleDisplay();

        Toast.success('Takvim yüklendi!');
        return true;
    } catch (error) {
        Toast.error('Yükleme başarısız: ' + error.message);
        return false;
    }
}

// Update user UI based on auth state
function updateUserUI() {
    const userArea = document.getElementById('userAuthArea');
    if (!userArea) return;

    if (AuthState.isLoggedIn()) {
        const user = AuthState.user;
        const usage = AuthState.usage;
        const initials = user.name
            ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
            : user.email[0].toUpperCase();

        let usageHtml = '';
        if (usage && usage.remaining) {
            usageHtml = `<span style="font-size: 0.7rem; color: rgba(255,255,255,0.5);">
                ${usage.remaining.calendars} takvim kaldı
            </span>`;
        }

        userArea.innerHTML = `
            <a href="/profile" class="user-badge" title="Profilim">
                <span class="user-avatar">${initials}</span>
                <span class="user-name">${user.name || user.email.split('@')[0]}</span>
            </a>
            ${usageHtml}
            <button onclick="saveToCloud()" class="btn-cloud-save" title="Buluta Kaydet">☁️</button>
        `;
    } else {
        userArea.innerHTML = `
            <a href="/login" class="btn-login">Giriş Yap</a>
        `;
    }
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('hospitalScheduleApp');
    if (!saved) return;

    try {
        const data = JSON.parse(saved);

        state.calendarId = data.calendarId || null;
        state.createdAt = data.createdAt || null;
        state.people = data.people || [];
        state.selectedMonth = data.selectedMonth ?? new Date().getMonth();
        state.selectedYear = data.selectedYear ?? new Date().getFullYear();
        state.scheduleTitle = data.scheduleTitle || '';
        state.showNobetErtesi = data.showNobetErtesi !== undefined ? data.showNobetErtesi : true;
        state.aiConditions = data.aiConditions || '';
        state.shiftDelays = data.shiftDelays || {};

        if (data.workAreas && data.workAreas.length > 0) {
            state.workAreas = data.workAreas;
            state.nextWorkAreaId = data.nextWorkAreaId || (Math.max(...data.workAreas.map(a => a.id)) + 1);
        }

        if (data.schedule && data.schedule.length > 0) {
            state.schedule = data.schedule.map(day => ({
                ...day,
                date: new Date(day.date),
            }));
        }

        // Update month/year selects
        const monthSelect = document.getElementById('monthSelect');
        const yearSelect = document.getElementById('yearSelect');
        if (monthSelect) monthSelect.value = state.selectedMonth;
        if (yearSelect) yearSelect.value = state.selectedYear;

        // Load schedule title
        const titleEl = document.getElementById('scheduleTitle');
        if (titleEl) titleEl.value = state.scheduleTitle;

        // Load conditions textarea
        const conditionsEl = document.getElementById('aiConditions');
        if (conditionsEl) conditionsEl.value = state.aiConditions;

    } catch (e) {
        console.error('Error loading from localStorage:', e);
    }
}

// ============================================
// Visual Constraint Builder (Step 4)
// ============================================

// Internal storage for visual constraints
const visualConstraints = {
    personAreaRules: {}, // person -> { areaId: 'allowed'|'preferred'|'blocked' }
    dayOffRules: {},     // { dateStr: [person1, person2, ...] } (same pattern as shiftDelays)
    pairRules: [],       // [{ person1, person2 }]
    seniorityOrder: [],  // [person names, top=least work, bottom=most work]
    weeklyPriority: {}   // { weekIndex: { areaId: personName } }
};

let dayOffSelectedPerson = null;

function renderConstraintBuilder() {
    renderPersonAreaCards();
    populateDropdowns();
    renderDayOffPeoplePool();
    renderDayOffCalendar();
    renderPairList();
    renderSeniorityList();
    renderWeeklyPriorityTable();
    updateConstraintSummary();
}

function switchConstraintTab(tabName) {
    // Update tabs
    document.querySelectorAll('.cb-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.cb-tab[data-tab="${tabName}"]`).classList.add('active');

    // Update panels
    document.querySelectorAll('.cb-panel').forEach(p => p.classList.remove('active'));
    const panelMap = { area: 'cbPanelArea', dayoff: 'cbPanelDayoff', pairs: 'cbPanelPairs', seniority: 'cbPanelSeniority', weekly: 'cbPanelWeekly' };
    document.getElementById(panelMap[tabName]).classList.add('active');
}

function renderPersonAreaCards() {
    const container = document.getElementById('cbPersonAreaCards');
    if (!container) return;

    container.innerHTML = '';

    if (state.people.length === 0 || state.workAreas.length === 0) {
        container.innerHTML = '<div class="cb-empty-state">Personel ve çalışma alanları eklendikten sonra burada kartlar görünecektir.</div>';
        return;
    }

    state.people.forEach(person => {
        // Initialize rules for this person if not exists
        if (!visualConstraints.personAreaRules[person]) {
            visualConstraints.personAreaRules[person] = {};
        }

        const ruleCount = Object.values(visualConstraints.personAreaRules[person]).filter(v => v !== 'allowed').length;
        const badgeText = ruleCount > 0 ? `${ruleCount} kural` : 'Tüm alanlarda';

        const card = document.createElement('div');
        card.className = 'cb-person-card';
        card.innerHTML = `
            <div class="cb-person-card-header" onclick="togglePersonCard(this)">
                <div class="cb-person-name">
                    <span>👤</span> ${person}
                    <span class="cb-person-badge">${badgeText}</span>
                </div>
                <span class="cb-expand-icon">▶</span>
            </div>
            <div class="cb-person-card-body">
                <div class="cb-area-grid">
                    ${state.workAreas.map(area => {
            const currentState = visualConstraints.personAreaRules[person][area.id] || 'allowed';
            return `
                        <div class="cb-area-row">
                            <span class="cb-area-name">${area.name}</span>
                            <div class="cb-area-toggles">
                                <button class="cb-toggle ${currentState === 'allowed' ? 'allowed' : ''}" 
                                        onclick="togglePersonAreaRule('${person}', '${area.id}', 'allowed')" 
                                        title="Bu alanda çalışıyor">✅ <span class="cb-toggle-label">Çalışır</span></button>
                                <button class="cb-toggle ${currentState === 'preferred' ? 'preferred' : ''}" 
                                        onclick="togglePersonAreaRule('${person}', '${area.id}', 'preferred')" 
                                        title="Bu alan boş kalırsa çalışır">⭐ <span class="cb-toggle-label">Boş kalırsa</span></button>
                                <button class="cb-toggle ${currentState === 'blocked' ? 'blocked' : ''}" 
                                        onclick="togglePersonAreaRule('${person}', '${area.id}', 'blocked')" 
                                        title="Kesinlikle çalışmaz">🚫 <span class="cb-toggle-label">Çalışmaz</span></button>
                            </div>
                        </div>`;
        }).join('')}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function togglePersonCard(headerEl) {
    const card = headerEl.closest('.cb-person-card');
    card.classList.toggle('expanded');
}

function togglePersonAreaRule(person, areaId, newState) {
    if (!visualConstraints.personAreaRules[person]) {
        visualConstraints.personAreaRules[person] = {};
    }

    const current = visualConstraints.personAreaRules[person][areaId] || 'allowed';
    // If clicking the same state, reset to 'allowed'
    if (current === newState) {
        visualConstraints.personAreaRules[person][areaId] = 'allowed';
    } else {
        visualConstraints.personAreaRules[person][areaId] = newState;
    }

    // Remember which cards are expanded, then re-render and restore
    const expandedPeople = new Set();
    document.querySelectorAll('.cb-person-card.expanded').forEach(card => {
        const nameEl = card.querySelector('.cb-person-name');
        if (nameEl) {
            // Extract person name from the textContent (skip the icon and badge)
            const name = nameEl.childNodes[1]?.textContent?.trim();
            if (name) expandedPeople.add(name);
        }
    });

    renderPersonAreaCards();

    // Restore expanded state
    document.querySelectorAll('.cb-person-card').forEach(card => {
        const nameEl = card.querySelector('.cb-person-name');
        if (nameEl) {
            const name = nameEl.childNodes[1]?.textContent?.trim();
            if (name && expandedPeople.has(name)) {
                card.classList.add('expanded');
            }
        }
    });

    updateConstraintSummary();
}

function populateDropdowns() {

    // Pair dropdowns
    ['cbPairPerson1', 'cbPairPerson2'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            const currentVal = select.value;
            const label = id === 'cbPairPerson1' ? '1. Kişi' : '2. Kişi';
            select.innerHTML = `<option value="">${label}</option>`;
            state.people.forEach(p => {
                select.innerHTML += `<option value="${p}">${p}</option>`;
            });
            select.value = currentVal;
        }
    });
}

function toggleWeekdayChip(btn) {
    btn.classList.toggle('active');
}

const dayNamesFull = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function renderDayOffPeoplePool() {
    const container = document.getElementById('cbDayoffPeoplePool');
    if (!container) return;

    container.innerHTML = state.people.map(name => `
        <div class="cb-dayoff-person ${dayOffSelectedPerson === name ? 'selected' : ''}" 
             draggable="true" 
             data-person="${name}"
             onclick="selectDayOffPerson('${name}')"
             ondragstart="dayOffDragStart(event, '${name}')">
            ${name}
        </div>
    `).join('');
}

function renderDayOffCalendar() {
    const grid = document.getElementById('cbDayoffCalendarGrid');
    if (!grid) return;

    const month = state.selectedMonth;
    const year = state.selectedYear;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    let html = '';

    // Day headers
    shortDayNames.forEach(day => {
        html += `<div class="cb-dayoff-day-header">${day}</div>`;
    });

    // Empty cells before first day
    for (let i = 0; i < startDayOfWeek; i++) {
        html += '<div class="cb-dayoff-day empty"></div>';
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDateKey(year, month, day);
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const dayPeople = visualConstraints.dayOffRules[dateStr] || [];

        html += `
            <div class="cb-dayoff-day ${isWeekend ? 'weekend' : ''}" 
                 data-date="${dateStr}"
                 onclick="handleDayOffDayClick('${dateStr}')"
                 ondragover="dayOffDragOver(event)"
                 ondragleave="dayOffDragLeave(event)"
                 ondrop="dayOffDrop(event, '${dateStr}')">
                <div class="cb-dayoff-day-number">${day}</div>
                <div class="cb-dayoff-day-people">
                    ${dayPeople.map(p => `
                        <div class="cb-dayoff-day-person">
                            <span>${p.length > 5 ? p.substring(0, 5) + '..' : p}</span>
                            <button class="cb-dayoff-remove" onclick="event.stopPropagation(); removeDayOff('${dateStr}', '${p}')">✕</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    grid.innerHTML = html;
}

function selectDayOffPerson(name) {
    if (dayOffSelectedPerson === name) {
        dayOffSelectedPerson = null;
        Toast.info('Seçim kaldırıldı');
    } else {
        dayOffSelectedPerson = name;
        Toast.success(`${name} seçildi. Takvimde bir güne tıklayın.`);
    }
    renderDayOffPeoplePool();
}

function handleDayOffDayClick(dateStr) {
    if (dayOffSelectedPerson) {
        addDayOff(dateStr, dayOffSelectedPerson);
    }
}

function dayOffDragStart(event, personName) {
    event.dataTransfer.setData('text/plain', personName);
    event.dataTransfer.effectAllowed = 'copy';
}

function dayOffDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    event.currentTarget.classList.add('dragover');
}

function dayOffDragLeave(event) {
    event.currentTarget.classList.remove('dragover');
}

function dayOffDrop(event, dateStr) {
    event.preventDefault();
    event.currentTarget.classList.remove('dragover');
    const personName = event.dataTransfer.getData('text/plain');
    if (personName) {
        addDayOff(dateStr, personName);
    }
}

function addDayOff(dateStr, personName) {
    if (!visualConstraints.dayOffRules[dateStr]) {
        visualConstraints.dayOffRules[dateStr] = [];
    }
    if (!visualConstraints.dayOffRules[dateStr].includes(personName)) {
        visualConstraints.dayOffRules[dateStr].push(personName);
        renderDayOffCalendar();
        updateConstraintSummary();
        const [y, m, d] = dateStr.split('-');
        Toast.success(`📅 ${personName} → ${parseInt(d)} ${monthNames[parseInt(m) - 1]} izinli`);
    } else {
        Toast.warning('Bu kişi zaten bu güne ekli!');
    }
}

function removeDayOff(dateStr, personName) {
    if (visualConstraints.dayOffRules[dateStr]) {
        visualConstraints.dayOffRules[dateStr] = visualConstraints.dayOffRules[dateStr].filter(p => p !== personName);
        if (visualConstraints.dayOffRules[dateStr].length === 0) {
            delete visualConstraints.dayOffRules[dateStr];
        }
        renderDayOffCalendar();
        updateConstraintSummary();
        Toast.info(`${personName} izin kaldırıldı`);
    }
}

function addPairRule() {
    const p1 = document.getElementById('cbPairPerson1').value;
    const p2 = document.getElementById('cbPairPerson2').value;

    if (!p1 || !p2) {
        Toast.warning('Lütfen her iki kişiyi de seçin!');
        return;
    }

    if (p1 === p2) {
        Toast.warning('Farklı iki kişi seçmelisiniz!');
        return;
    }

    // Check duplicate
    const exists = visualConstraints.pairRules.find(r =>
        (r.person1 === p1 && r.person2 === p2) ||
        (r.person1 === p2 && r.person2 === p1)
    );
    if (exists) {
        Toast.warning('Bu çift zaten ekli!');
        return;
    }

    visualConstraints.pairRules.push({ person1: p1, person2: p2 });

    // Reset form
    document.getElementById('cbPairPerson1').value = '';
    document.getElementById('cbPairPerson2').value = '';

    renderPairList();
    updateConstraintSummary();
    Toast.success(`${p1} ⟷ ${p2} çift kısıtı eklendi!`);
}

function removePairRule(idx) {
    visualConstraints.pairRules.splice(idx, 1);
    renderPairList();
    updateConstraintSummary();
}

function renderPairList() {
    const container = document.getElementById('cbPairList');
    if (!container) return;

    if (visualConstraints.pairRules.length === 0) {
        container.innerHTML = '<div class="cb-empty-state">Henüz çift kısıtı eklenmedi</div>';
        return;
    }

    container.innerHTML = visualConstraints.pairRules.map((rule, idx) => `
        <div class="cb-rule-tag">
            <span class="cb-rule-text">👥 <strong>${rule.person1}</strong> ⟷ <strong>${rule.person2}</strong> — Aynı gün çalışmamalı</span>
            <button class="cb-rule-remove" onclick="removePairRule(${idx})">✕</button>
        </div>
    `).join('');
}

function updateConstraintSummary() {
    const summaryEl = document.getElementById('cbSummary');
    const contentEl = document.getElementById('cbSummaryContent');
    if (!summaryEl || !contentEl) return;

    const items = [];

    // Person-area rules
    Object.entries(visualConstraints.personAreaRules).forEach(([person, areas]) => {
        Object.entries(areas).forEach(([areaId, status]) => {
            if (status === 'blocked') {
                const area = state.workAreas.find(a => a.id === areaId);
                if (area) items.push(`🚫 ${person} → ${area.name}'de çalışmasın`);
            } else if (status === 'preferred') {
                const area = state.workAreas.find(a => a.id === areaId);
                if (area) items.push(`⭐ ${person} → ${area.name}'de tercih`);
            }
        });
    });

    // Day-off rules (date-based)
    const dayOffByPerson = {};
    Object.entries(visualConstraints.dayOffRules).forEach(([dateStr, people]) => {
        people.forEach(person => {
            if (!dayOffByPerson[person]) dayOffByPerson[person] = [];
            const [y, m, d] = dateStr.split('-');
            dayOffByPerson[person].push(`${parseInt(d)} ${monthNames[parseInt(m) - 1]}`);
        });
    });
    Object.entries(dayOffByPerson).forEach(([person, dates]) => {
        items.push(`📅 ${person} → ${dates.join(', ')} izinli`);
    });

    // Pair rules
    visualConstraints.pairRules.forEach(rule => {
        items.push(`👥 ${rule.person1} ⟷ ${rule.person2} aynı gün çalışmasın`);
    });

    // Seniority order
    if (visualConstraints.seniorityOrder.length > 0) {
        const first = visualConstraints.seniorityOrder[0];
        const last = visualConstraints.seniorityOrder[visualConstraints.seniorityOrder.length - 1];
        items.push(`📊 Kıdem sırası: ${first} (en az) → ${last} (en çok)`);
    }

    if (items.length === 0) {
        summaryEl.style.display = 'none';
        return;
    }

    summaryEl.style.display = 'block';
    contentEl.innerHTML = items.map(i => `<div class="cb-summary-item">${i}</div>`).join('');
}

// ============================================
// Weekly Area Priority (Haftalık Alan Önceliği)
// ============================================

/**
 * Calculate weeks of the selected month.
 * Returns array of { weekIndex, label, dateRange, startDay, endDay }
 */
function getWeeksOfMonth() {
    const month = parseInt(document.getElementById('monthSelect')?.value || '0');
    const year = parseInt(document.getElementById('yearSelect')?.value || new Date().getFullYear());

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();

    const weeks = [];
    for (let i = 0; i < totalDays; i += 7) {
        const startDay = i + 1;
        const endDay = Math.min(i + 7, totalDays);
        const weekIdx = Math.floor(i / 7);

        const startDate = new Date(year, month, startDay);
        const endDate = new Date(year, month, endDay);

        const formatDate = (d) => `${d.getDate()} ${d.toLocaleDateString('tr-TR', { month: 'short' })}`;

        weeks.push({
            weekIndex: weekIdx,
            label: `${weekIdx + 1}. Hafta`,
            dateRange: `${formatDate(startDate)} – ${formatDate(endDate)}`,
            startDay,
            endDay
        });
    }

    return weeks;
}

/**
 * Get the week index for a given date (day of month)
 */
function getWeekIndexForDay(dayOfMonth) {
    return Math.floor((dayOfMonth - 1) / 7);
}

/**
 * Render the weekly priority table
 */
function renderWeeklyPriorityTable() {
    const container = document.getElementById('cbWeeklyTable');
    if (!container) return;

    const weeks = getWeeksOfMonth();
    const areas = state.workAreas || [];
    const people = state.people || [];

    if (areas.length === 0 || people.length === 0) {
        container.innerHTML = '<div class="cb-empty-state">Kişiler ve çalışma alanları eklendikten sonra haftalık öncelikler görünecek</div>';
        return;
    }

    let html = '<table class="cb-weekly-table">';

    // Header row
    html += '<thead><tr><th>Hafta</th>';
    areas.forEach(area => {
        html += `<th>${area.name}</th>`;
    });
    html += '</tr></thead>';

    // Body rows - one per week
    html += '<tbody>';
    weeks.forEach(week => {
        html += '<tr>';
        html += `<td class="week-label">${week.label}<span class="week-dates">${week.dateRange}</span></td>`;

        areas.forEach(area => {
            const currentValue = visualConstraints.weeklyPriority[week.weekIndex]?.[area.id] || '';
            const isAssigned = currentValue !== '';

            html += '<td>';
            html += `<select class="cb-weekly-select ${isAssigned ? 'assigned' : ''}" 
                        onchange="setWeeklyPriority(${week.weekIndex}, ${area.id}, this.value, this)">`;
            html += `<option value="">— Seçiniz —</option>`;

            people.forEach(person => {
                const selected = currentValue === person ? 'selected' : '';
                html += `<option value="${person}" ${selected}>${person}</option>`;
            });

            html += '</select>';
            html += '</td>';
        });

        html += '</tr>';
    });
    html += '</tbody></table>';

    container.innerHTML = html;
}

/**
 * Set a weekly priority assignment
 */
function setWeeklyPriority(weekIndex, areaId, person, selectEl) {
    if (!visualConstraints.weeklyPriority[weekIndex]) {
        visualConstraints.weeklyPriority[weekIndex] = {};
    }

    if (person === '') {
        delete visualConstraints.weeklyPriority[weekIndex][areaId];
        // Clean up empty week entry
        if (Object.keys(visualConstraints.weeklyPriority[weekIndex]).length === 0) {
            delete visualConstraints.weeklyPriority[weekIndex];
        }
    } else {
        // Check: same person already assigned in another area this week?
        const weekAssignments = visualConstraints.weeklyPriority[weekIndex];
        for (const [otherAreaId, otherPerson] of Object.entries(weekAssignments)) {
            if (String(otherAreaId) !== String(areaId) && otherPerson === person) {
                const otherArea = state.workAreas.find(a => String(a.id) === String(otherAreaId));
                alert(`⚠️ ${person} bu haftada zaten ${otherArea?.name || 'başka bir alan'}a atanmış. Aynı kişi aynı hafta birden fazla alana atanamaz.`);
                selectEl.value = '';
                selectEl.classList.remove('assigned');
                delete visualConstraints.weeklyPriority[weekIndex][areaId];
                return;
            }
        }
        visualConstraints.weeklyPriority[weekIndex][areaId] = person;
    }

    // Update visual state
    if (selectEl) {
        selectEl.classList.toggle('assigned', person !== '');
    }

    updateConstraintSummary();
    saveToLocalStorage();
}

/**
 * Collect visual constraints into the format expected by startAssignment().
 * Returns { personAreaRules, dayOffRules, pairRules }
 */
function collectVisualConstraints() {
    const personAreaRules = [];
    const dayOffRules = [];
    const pairRules = [];

    // Convert person-area rules
    Object.entries(visualConstraints.personAreaRules).forEach(([person, areas]) => {
        const blocked = [];
        const preferred = [];
        const allowed = [];

        Object.entries(areas).forEach(([areaId, status]) => {
            if (status === 'blocked') blocked.push(areaId);
            else if (status === 'preferred') preferred.push(areaId);
            else allowed.push(areaId);
        });

        if (blocked.length > 0 || preferred.length > 0 || allowed.length > 0) {
            personAreaRules.push({ person, allowed, preferred, blocked });
        }
    });

    // Convert day-off rules (date-based)
    const dayOffByPersonCollect = {};
    Object.entries(visualConstraints.dayOffRules).forEach(([dateStr, people]) => {
        people.forEach(person => {
            if (!dayOffByPersonCollect[person]) dayOffByPersonCollect[person] = [];
            dayOffByPersonCollect[person].push(dateStr);
        });
    });
    Object.entries(dayOffByPersonCollect).forEach(([person, dates]) => {
        dayOffRules.push({
            person,
            dates,
            weekdays: []
        });
    });

    // Convert pair rules
    visualConstraints.pairRules.forEach(rule => {
        pairRules.push({
            person1: rule.person1,
            person2: rule.person2,
            type: 'never_same_day'
        });
    });

    return {
        personAreaRules,
        dayOffRules,
        pairRules,
        seniorityOrder: visualConstraints.seniorityOrder.length > 0
            ? [...visualConstraints.seniorityOrder]
            : [],
        weeklyPriority: { ...visualConstraints.weeklyPriority }
    };
}

// ============================================
// Seniority Order (Kıdem Sırası) - Drag & Drop
// ============================================

let seniorityDragItem = null;

function renderSeniorityList() {
    const container = document.getElementById('cbSeniorityList');
    if (!container) return;

    // Initialize order from state.people if empty or people changed
    if (visualConstraints.seniorityOrder.length === 0 ||
        !arraysMatchContent(visualConstraints.seniorityOrder, state.people)) {
        // Keep existing order for people that still exist, append new ones
        const existing = visualConstraints.seniorityOrder.filter(p => state.people.includes(p));
        const newPeople = state.people.filter(p => !existing.includes(p));
        visualConstraints.seniorityOrder = [...existing, ...newPeople];
    }

    const order = visualConstraints.seniorityOrder;
    if (order.length === 0) {
        container.innerHTML = '<div class="cb-empty-state">Kişi eklendikten sonra kıdem sırası görünecek</div>';
        return;
    }

    container.innerHTML = order.map((person, idx) => {
        let label = '';
        if (order.length > 1) {
            if (idx === 0) label = '<span class="cb-seniority-label">En Az</span>';
            else if (idx === order.length - 1) label = '<span class="cb-seniority-label">En Çok</span>';
        }
        return `
            <li class="cb-seniority-item" draggable="true" data-person="${person}"
                ondragstart="seniorityDragStart(event)"
                ondragover="seniorityDragOver(event)"
                ondragleave="seniorityDragLeave(event)"
                ondrop="seniorityDrop(event)"
                ondragend="seniorityDragEnd(event)">
                <span class="cb-seniority-drag-handle">☰</span>
                <span class="cb-seniority-rank">${idx + 1}</span>
                <span class="cb-seniority-name">${person}</span>
                ${label}
            </li>
        `;
    }).join('');
}

function arraysMatchContent(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((v, i) => v === sorted2[i]);
}

function seniorityDragStart(e) {
    seniorityDragItem = e.target.closest('.cb-seniority-item');
    seniorityDragItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', seniorityDragItem.dataset.person);
}

function seniorityDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const item = e.target.closest('.cb-seniority-item');
    if (item && item !== seniorityDragItem) {
        item.classList.add('drag-over');
    }
}

function seniorityDragLeave(e) {
    const item = e.target.closest('.cb-seniority-item');
    if (item) item.classList.remove('drag-over');
}

function seniorityDrop(e) {
    e.preventDefault();
    const targetItem = e.target.closest('.cb-seniority-item');
    if (!targetItem || !seniorityDragItem || targetItem === seniorityDragItem) return;

    const dragPerson = seniorityDragItem.dataset.person;
    const targetPerson = targetItem.dataset.person;

    const order = visualConstraints.seniorityOrder;
    const fromIdx = order.indexOf(dragPerson);
    const toIdx = order.indexOf(targetPerson);

    // Remove from old position and insert at new position
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, dragPerson);

    renderSeniorityList();
    updateConstraintSummary();
}

function seniorityDragEnd(e) {
    document.querySelectorAll('.cb-seniority-item').forEach(item => {
        item.classList.remove('dragging', 'drag-over');
    });
    seniorityDragItem = null;
}

// ============================================
// Global Exports
// ============================================
window.goToStep = goToStep;
window.addPerson = addPerson;
window.removePerson = removePerson;
window.selectPerson = selectPerson;
window.handleDayClick = handleDayClick;
window.handleDragStart = handleDragStart;
window.handleDragOver = handleDragOver;
window.handleDragLeave = handleDragLeave;
window.handleDrop = handleDrop;
window.removeFromDay = removeFromDay;
window.skipToCalendar = skipToCalendar;
window.generateCalendar = generateCalendar;
window.handleFieldChange = handleFieldChange;
window.addWorkArea = addWorkArea;
window.removeWorkArea = removeWorkArea;
window.renameWorkArea = renameWorkArea;
window.startAssignment = startAssignment;
window.clearAll = clearAll;
window.exportSchedule = exportSchedule;
window.toggleStats = toggleStats;
window.loadCurrentVersion = loadCurrentVersion;
window.loadVersionTab = loadVersionTab;
window.deleteVersionTab = deleteVersionTab;
// New functions
window.updateScheduleTitle = updateScheduleTitle;
window.addWorkAreaStep2 = addWorkAreaStep2;
window.removeWorkAreaStep2 = removeWorkAreaStep2;
window.toggleNobetErtesiCheckbox = toggleNobetErtesiCheckbox;
window.saveCurrentVersion = saveCurrentVersion;
window.saveToVersionTab = saveToVersionTab;
window.addNewVersion = addNewVersion;
// Redistribution and stats functions
window.generateAndAutoStart = generateAndAutoStart;
window.redistributeSchedule = redistributeSchedule;
window.renderInlineWorkAreas = renderInlineWorkAreas;
window.promptRenameWorkAreaInline = promptRenameWorkAreaInline;
window.removeWorkAreaInline = removeWorkAreaInline;
window.addWorkAreaInline = addWorkAreaInline;
window.renderDetailedStats = renderDetailedStats;
window.scrollToStats = scrollToStats;
window.updateAreaStats = updateAreaStats;
// Cloud sync functions
window.saveToCloud = saveToCloud;
window.loadFromCloud = loadFromCloud;
window.updateUserUI = updateUserUI;
// Constraint Builder functions
window.switchConstraintTab = switchConstraintTab;
window.togglePersonCard = togglePersonCard;
window.togglePersonAreaRule = togglePersonAreaRule;
window.selectDayOffPerson = selectDayOffPerson;
window.handleDayOffDayClick = handleDayOffDayClick;
window.dayOffDragStart = dayOffDragStart;
window.dayOffDragOver = dayOffDragOver;
window.dayOffDragLeave = dayOffDragLeave;
window.dayOffDrop = dayOffDrop;
window.addDayOff = addDayOff;
window.removeDayOff = removeDayOff;
window.addPairRule = addPairRule;
window.removePairRule = removePairRule;
window.seniorityDragStart = seniorityDragStart;
window.seniorityDragOver = seniorityDragOver;
window.seniorityDragLeave = seniorityDragLeave;
window.seniorityDrop = seniorityDrop;
window.seniorityDragEnd = seniorityDragEnd;

// ============================================
// Start App
// ============================================
document.addEventListener('DOMContentLoaded', init);
