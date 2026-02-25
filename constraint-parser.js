/**
 * Simple, Bulletproof Constraint Parser
 * No AI, no complex regex - just reliable parsing
 */

class SimpleConstraintParser {
    constructor(people, workAreas) {
        this.people = people;
        this.workAreas = workAreas;
        this.constraints = {
            personAreaRules: [],
            dayOffRules: [],
            pairRules: []
        };
        this.errors = [];
    }

    /**
     * Main parse function
     */
    parse(text) {
        if (!text || !text.trim()) {
            return { constraints: this.constraints, errors: [] };
        }

        const lines = text.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            try {
                this.parseLine(line, lineNum);
            } catch (error) {
                this.errors.push({
                    line: lineNum,
                    text: line,
                    error: error.message
                });
            }
        }

        return {
            constraints: this.constraints,
            errors: this.errors
        };
    }

    /**
     * Parse a single line
     */
    parseLine(line, lineNum) {
        const lower = line.toLowerCase();

        // Pattern 1: "X hiç Y'de çalışmasın" → block from area
        if (lower.includes('hiç') && lower.includes('çalışmasın')) {
            return this.parseBlockFromArea(line, lineNum);
        }

        // Pattern 2: "X sadece Y'de çalışsın" → only in area
        if (lower.includes('sadece') && (lower.includes('çalışsın') || lower.includes('çalışabilir'))) {
            return this.parseOnlyInArea(line, lineNum);
        }

        // Pattern 3: "X Cuma günleri çalışmasın" → day-off rule
        if (lower.includes('günleri') && lower.includes('çalışmasın')) {
            return this.parseDayOffRule(line, lineNum);
        }

        // Pattern 4: "X ve Y aynı gün çalışmasın" → pair rule
        if (lower.includes(' ve ') && lower.includes('aynı gün')) {
            return this.parsePairRule(line, lineNum);
        }

        // If no pattern matched, throw error
        throw new Error(`Tanınmayan koşul formatı. Desteklenen formatlar: "X hiç Y'de çalışmasın", "X sadece Y'de çalışsın", "X Cuma günleri çalışmasın", "X ve Y aynı gün çalışmasın"`);
    }

    /**
     * Parse "X hiç Y'de çalışmasın"
     */
    parseBlockFromArea(line, lineNum) {
        // Extract person (before "hiç")
        const hicIndex = line.toLowerCase().indexOf('hiç');
        const personName = line.substring(0, hicIndex).trim();

        // Extract area (between "hiç" and "'de" or "de")
        const afterHic = line.substring(hicIndex + 3).trim();
        const deMatch = afterHic.match(/(.+?)['']?[dt]e\s/i);

        if (!deMatch) {
            throw new Error(`Alan adı bulunamadı. Format: "İsim hiç Alan'de çalışmasın"`);
        }

        const areaName = deMatch[1].trim();

        // Find person and area
        const person = this.findPerson(personName);
        const area = this.findArea(areaName);

        if (!person) {
            throw new Error(`"${personName}" isimli personel bulunamadı`);
        }
        if (!area) {
            throw new Error(`"${areaName}" isimli çalışma alanı bulunamadı`);
        }

        // Add to constraints
        let rule = this.constraints.personAreaRules.find(r => r.person === person);
        if (!rule) {
            rule = { person, allowed: null, preferred: [], blocked: [] };
            this.constraints.personAreaRules.push(rule);
        }

        if (!rule.blocked.includes(area.id)) {
            rule.blocked.push(area.id);
        }

        console.log(`✅ [${lineNum}] ${person} → Asla ${area.name}'de çalışmasın`);
    }

    /**
     * Parse "X sadece Y'de çalışsın"
     */
    parseOnlyInArea(line, lineNum) {
        // Extract person (before "sadece")
        const sadeceIndex = line.toLowerCase().indexOf('sadece');
        const personName = line.substring(0, sadeceIndex).trim();

        // Extract area (between "sadece" and "'de" or "de")
        const afterSadece = line.substring(sadeceIndex + 6).trim();
        const deMatch = afterSadece.match(/(.+?)['']?[dt]e\s/i);

        if (!deMatch) {
            throw new Error(`Alan adı bulunamadı. Format: "İsim sadece Alan'de çalışsın"`);
        }

        const areaName = deMatch[1].trim();

        // Find person and area
        const person = this.findPerson(personName);
        const area = this.findArea(areaName);

        if (!person) {
            throw new Error(`"${personName}" isimli personel bulunamadı`);
        }
        if (!area) {
            throw new Error(`"${areaName}" isimli çalışma alanı bulunamadı`);
        }

        // Add to constraints
        let rule = this.constraints.personAreaRules.find(r => r.person === person);
        if (!rule) {
            rule = { person, allowed: [], preferred: [], blocked: [] };
            this.constraints.personAreaRules.push(rule);
        }

        // "sadece" means ONLY this area
        rule.allowed = [area.id];

        console.log(`✅ [${lineNum}] ${person} → Sadece ${area.name}'de çalışsın`);
    }

    /**
     * Parse "X Cuma günleri çalışmasın"
     */
    parseDayOffRule(line, lineNum) {
        // Extract person (before day name)
        const dayNames = ['pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar'];
        const dayMap = { pazartesi: 1, salı: 2, çarşamba: 3, perşembe: 4, cuma: 5, cumartesi: 6, pazar: 0 };

        let foundDay = null;
        let dayIndex = -1;

        for (const day of dayNames) {
            const idx = line.toLowerCase().indexOf(day);
            if (idx !== -1) {
                foundDay = day;
                dayIndex = idx;
                break;
            }
        }

        if (!foundDay) {
            throw new Error(`Gün adı bulunamadı. Desteklenen günler: Pazartesi, Salı, Çarşamba, Perşembe, Cuma, Cumartesi, Pazar`);
        }

        const personName = line.substring(0, dayIndex).trim();
        const person = this.findPerson(personName);

        if (!person) {
            throw new Error(`"${personName}" isimli personel bulunamadı`);
        }

        // Add to constraints
        let rule = this.constraints.dayOffRules.find(r => r.person === person);
        if (!rule) {
            rule = { person, dates: [], weekdays: [] };
            this.constraints.dayOffRules.push(rule);
        }

        const weekdayNum = dayMap[foundDay];
        if (!rule.weekdays.includes(weekdayNum)) {
            rule.weekdays.push(weekdayNum);
        }

        console.log(`✅ [${lineNum}] ${person} → ${foundDay.charAt(0).toUpperCase() + foundDay.slice(1)} günleri çalışmasın`);
    }

    /**
     * Parse "X ve Y aynı gün çalışmasın"
     */
    parsePairRule(line, lineNum) {
        const veIndex = line.toLowerCase().indexOf(' ve ');
        const ayniIndex = line.toLowerCase().indexOf('aynı gün');

        if (veIndex === -1 || ayniIndex === -1) {
            throw new Error(`Format hatası. Beklenen: "İsim1 ve İsim2 aynı gün çalışmasın"`);
        }

        const person1Name = line.substring(0, veIndex).trim();
        const person2Name = line.substring(veIndex + 4, ayniIndex).trim();

        const person1 = this.findPerson(person1Name);
        const person2 = this.findPerson(person2Name);

        if (!person1) {
            throw new Error(`"${person1Name}" isimli personel bulunamadı`);
        }
        if (!person2) {
            throw new Error(`"${person2Name}" isimli personel bulunamadı`);
        }

        // Add to constraints
        this.constraints.pairRules.push({
            person1,
            person2,
            type: 'never_same_day'
        });

        console.log(`✅ [${lineNum}] ${person1} ve ${person2} → Aynı gün çalışmasın`);
    }

    /**
     * Find person by name (case-insensitive, partial match)
     */
    findPerson(name) {
        const normalized = name.toLowerCase().trim();
        return this.people.find(p =>
            p.toLowerCase() === normalized ||
            p.toLowerCase().includes(normalized) ||
            normalized.includes(p.toLowerCase())
        );
    }

    /**
     * Find area by name (case-insensitive, partial match)
     */
    findArea(name) {
        const normalized = name.toLowerCase().trim();
        return this.workAreas.find(area => {
            const areaName = area.name.toLowerCase();
            return areaName === normalized ||
                areaName.includes(normalized) ||
                normalized.includes(areaName) ||
                // Also match by ID (e.g., "1" matches "POL1")
                areaName.includes(normalized) ||
                area.id.toString() === normalized;
        });
    }
}

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimpleConstraintParser;
}
