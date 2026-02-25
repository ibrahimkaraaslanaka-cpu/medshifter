/**
 * AI Routes - Gemini Integration
 * POST /api/ai/parse-conditions
 * 
 * Parses natural language scheduling constraints using Gemini API
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * Build the system prompt for Gemini
 */
function buildSystemPrompt(people, workAreas, scheduleDates) {
    const areaList = workAreas.map(a => `  - id: ${a.id}, name: "${a.name}"`).join('\n');
    const peopleList = people.map(p => `"${p}"`).join(', ');

    // Build day info from schedule dates
    const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const dateInfo = scheduleDates.slice(0, 5).map(d => {
        const date = new Date(d);
        return `${date.getDate()}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()} (${dayNames[date.getDay()]})`;
    }).join(', ');

    return `Sen bir hastane/klinik çalışma programı koşul analizcisisin.

BAĞLAM:
- Kişiler: [${peopleList}]
- Çalışma Alanları:
${areaList}
- Takvim günleri (ilk 5): ${dateInfo}... (toplam ${scheduleDates.length} gün)

GÖREV:
Kullanıcının doğal Türkçe ile yazdığı koşulları analiz et. Her koşulu aşağıdaki tiplerden birine çevir.

ÖNEMLİ KURALLAR:
1. Kişi isimlerini bağlamdaki listeden eşleştir (büyük/küçük harf fark etmez, kısaltma olabilir)
2. Çalışma alanı numaraları veya isimleri olabilir (ör. "1'de" = id:1, "Acil'de" = isim eşleştir)
3. Gün isimleri: pazartesi=1, salı=2, çarşamba=3, perşembe=4, cuma=5, cumartesi=6, pazar=0
4. Eğer koşul anlaşılamıyorsa, "unknown" tipinde döndür ve reason alanına neden anlaşılamadığını yaz
5. Bir satırda birden fazla koşul olabilir, her birini ayrı ayrı döndür

DESTEKLENEN TİPLER:

1. "block_person_from_area" - Kişi belirli alanda ASLA çalışmasın
   { "type": "block_person_from_area", "person": "isim", "areaId": number }

2. "prefer_person_in_area" - Kişi mümkünse belirli alanda çalışsın (tercih, zorunlu değil)
   { "type": "prefer_person_in_area", "person": "isim", "areaId": number }

3. "force_person_to_area_on_days" - Kişi belirli günlerde belirli alanda çalışsın (zorunlu)
   { "type": "force_person_to_area_on_days", "person": "isim", "areaId": number, "daysOfWeek": [number] }

4. "person_day_off" - Kişi belirli hafta günlerinde hiç çalışmasın
   { "type": "person_day_off", "person": "isim", "daysOfWeek": [number] }

5. "person_date_off" - Kişi belirli tarihlerde çalışmasın
   { "type": "person_date_off", "person": "isim", "dates": ["YYYY-MM-DD"] }

6. "person_date_range_off" - Kişi tarih aralığında izinli
   { "type": "person_date_range_off", "person": "isim", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }

7. "empty_area_on_days" - Çalışma alanı belirli günlerde boş kalsın (kimse atanmasın)
   { "type": "empty_area_on_days", "areaId": number, "daysOfWeek": [number] }

8. "pair_not_same_day" - İki kişi aynı gün çalışmasın
   { "type": "pair_not_same_day", "person1": "isim", "person2": "isim" }

9. "area_never_empty" - Çalışma alanı asla boş kalmasın
   { "type": "area_never_empty", "areaId": number }

10. "person_only_areas" - Kişi SADECE belirli alanlarda çalışabilir
    { "type": "person_only_areas", "person": "isim", "allowedAreaIds": [number] }

11. "force_person_to_area" - Kişi belirli alanda HER ZAMAN çalışsın
    { "type": "force_person_to_area", "person": "isim", "areaId": number }

12. "unknown" - Anlaşılamayan koşul
    { "type": "unknown", "original": "orijinal metin", "reason": "neden anlaşılamadı" }

ÇIKTI FORMATI:
Sadece JSON döndür, başka hiçbir şey yazma. Format:
{
  "constraints": [ ... ],
  "summary": "Türkçe özet: kaç koşul parse edildi, neler anlaşıldı"
}`;
}

/**
 * POST /api/ai/parse-conditions
 * Parse natural language constraints using Gemini
 */
router.post('/parse-conditions', authMiddleware, async (req, res, next) => {
    try {
        const { conditionsText, people, workAreas, scheduleDates } = req.body;

        // Validate input
        if (!conditionsText || !conditionsText.trim()) {
            return res.json({ constraints: [], summary: 'Koşul girilmedi.' });
        }

        if (!people || !Array.isArray(people) || people.length === 0) {
            return res.status(400).json({ error: 'Kişi listesi gerekli.' });
        }

        if (!workAreas || !Array.isArray(workAreas) || workAreas.length === 0) {
            return res.status(400).json({ error: 'Çalışma alanı listesi gerekli.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Gemini API key yapılandırılmamış.' });
        }

        // Build prompt
        const systemPrompt = buildSystemPrompt(people, workAreas, scheduleDates || []);

        // Call Gemini API
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: conditionsText }]
                    }
                ],
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json'
                }
            })
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('Gemini API error:', geminiResponse.status, errorText);
            return res.status(502).json({
                error: 'AI servisi şu anda yanıt vermiyor.',
                fallback: true
            });
        }

        const geminiData = await geminiResponse.json();

        // Extract the text from Gemini response
        const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!responseText) {
            console.error('Gemini returned empty response:', JSON.stringify(geminiData));
            return res.status(502).json({
                error: 'AI boş yanıt döndürdü.',
                fallback: true
            });
        }

        // Parse JSON from response
        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch (parseError) {
            // Try to extract JSON from markdown code blocks
            const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[1].trim());
            } else {
                console.error('Failed to parse Gemini response:', responseText);
                return res.status(502).json({
                    error: 'AI yanıtı parse edilemedi.',
                    fallback: true
                });
            }
        }

        // Validate structure
        if (!parsed.constraints || !Array.isArray(parsed.constraints)) {
            parsed = { constraints: [], summary: 'Koşullar anlaşılamadı.' };
        }

        // Normalize person names to match the provided list (case-insensitive)
        const peopleLower = people.map(p => p.toLowerCase());
        for (const c of parsed.constraints) {
            if (c.person) {
                const idx = peopleLower.indexOf(c.person.toLowerCase());
                if (idx !== -1) c.person = people[idx]; // Use original casing
            }
            if (c.person1) {
                const idx = peopleLower.indexOf(c.person1.toLowerCase());
                if (idx !== -1) c.person1 = people[idx];
            }
            if (c.person2) {
                const idx = peopleLower.indexOf(c.person2.toLowerCase());
                if (idx !== -1) c.person2 = people[idx];
            }
        }

        res.json(parsed);

    } catch (error) {
        console.error('AI parse error:', error);
        next(error);
    }
});

module.exports = router;
