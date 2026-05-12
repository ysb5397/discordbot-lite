const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const FILE_PATH = path.join(__dirname, 'food_data.json');

// 파일이 없을 때 기본 구조
const defaultData = {
    lastManualSync: "", // 마지막 수동 동기화 날짜 (YYYY-MM-DD)
    lastAutoSync: "",   // 마지막 자동 동기화 날짜 (일주일 단위 체크용)
    menus: {}           // "YYYY-MM-DD": { breakfast: "...", lunch: "...", dinner: "..." }
};

function readData() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('❌ [FoodManager] JSON 읽기 실패:', e);
    }
    return Object.assign({}, defaultData);
}

function saveData(data) {
    try {
        fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('❌ [FoodManager] JSON 저장 실패:', e);
    }
}

function getTodayString() {
    // 한국 시간 기준 YYYY-MM-DD 반환
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    return kst.toISOString().split('T')[0];
}

/**
 * 현재 한국 시간을 기준으로 어떤 식사(조식/중식/석식)를 보여줄지 결정합니다.
 */
function getCurrentMealInfo() {
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    
    const hours = kst.getUTCHours();
    const minutes = kst.getUTCMinutes();
    const time = hours * 100 + minutes; // 예: 08:30 -> 830, 14:45 -> 1445

    let targetDate = kst;
    let type = 'lunch';
    let typeName = '🍴 점심';

    // 시간대 설정 (필요하면 여기서 시간 조정해!)
    if (time < 840) {
        // 08:00 ~ 08:40 아침
        type = 'breakfast';
        typeName = '☀️ 아침';
    } else if (time > 1100 && time < 1300) {
        // 11:00 ~ 13:00 -> 점심
        type = 'lunch';
        typeName = '🍴 점심';
    } else if (time > 1630 && time < 1800) {
        // 16:30 ~ 18:00 -> 저녁
        type = 'dinner';
        typeName = '🌙 저녁';
    } else {
        // 18:00 이후 -> 다음 날 아침을 보여줌!
        targetDate.setDate(targetDate.getDate() + 1);
        type = 'breakfast';
        typeName = '☀️ 내일 아침';
    }

    const dateString = targetDate.toISOString().split('T')[0];
    
    return { dateString, type, typeName };
}

/**
 * html 안의 <br> 태그를 줄바꿈(\n)으로 바꾸고 텍스트를 깔끔하게 추출합니다.
 */
function extractMenuText($, td) {
    let html = $(td).html();
    if (!html) return "등록된 식단이 없습니다.";
    
    // <br> 태그를 실제 줄바꿈 문자로 변경
    html = html.replace(/<br\s*[\/]?>/gi, '\n');
    
    // 나머지 HTML 태그 제거 및 공백 정리
    return cheerio.load(html).text().trim().replace(/\n\s+/g, '\n') || "등록된 식단이 없습니다.";
}

/**
 * 학식을 크롤링해오는 함수
 */
async function crawlFoodData() {
    try {
        const url = 'https://www.kopo.ac.kr/busan/content.do?menu=5609';
        const response = await axios.get(url, {
            headers: {
                // 사이트에서 차단하지 않도록 기본적인 User-Agent 추가
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);

        const newMenus = {};
        const currentYear = new Date().getFullYear();

        // 식단표 table의 <tbody> 안의 모든 줄(<tr>)을 반복
        $('table tbody tr').each((i, el) => {
            const tds = $(el).find('td');
            
            // 날짜, 조식, 중식, 석식 데이터가 있는지 확인 (열이 4개 이상이어야 함)
            if (tds.length >= 4) {
                // 1. 날짜 추출 (예: "05.12(화)")
                const dateText = $(tds[0]).text().trim();
                const match = dateText.match(/(\d{1,2})[.\-](\d{1,2})/); // 월, 일 추출
                
                if (match) {
                    const month = String(match[1]).padStart(2, '0');
                    const day = String(match[2]).padStart(2, '0');
                    const formattedDate = `${currentYear}-${month}-${day}`;

                    // 2. 조식, 중식, 석식 추출 (보통 맨 뒤 3개 열이 식단임)
                    newMenus[formattedDate] = {
                        breakfast: extractMenuText($, tds[tds.length - 3]),
                        lunch: extractMenuText($, tds[tds.length - 2]),
                        dinner: extractMenuText($, tds[tds.length - 1])
                    };
                }
            }
        });

        // 만약 크롤링했는데 데이터가 아예 없다면 에러를 던짐
        if (Object.keys(newMenus).length === 0) {
            throw new Error("크롤링 결과 데이터가 0건입니다. HTML 구조가 변경되었을 수 있습니다.");
        }

        return newMenus;
    } catch (error) {
        console.error('❌ [FoodManager] 크롤링 중 에러 발생:', error);
        throw error;
    }
}

/**
 * 동기화를 수행하는 함수 (수동/자동 여부에 따라 제한 검사)
 * @param {boolean} isManual - 수동 동기화인지 여부
 */
async function syncFoodData(isManual = false) {
    const data = readData();
    const today = getTodayString();

    if (isManual) {
        // 수동 동기화는 하루에 한 번만 허용
        if (data.lastManualSync === today) {
            return { success: false, message: "⚠️ 오늘은 이미 수동 동기화를 완료했습니다. 내일 다시 시도해주세요." };
        }
    } else {
        if (data.lastAutoSync === today) {
            return { success: false, message: "이미 오늘 자동 동기화가 진행되었습니다." };
        }
    }

    // 크롤링 실행
    const crawledMenus = await crawlFoodData();
    
    // 데이터 갱신
    data.menus = Object.assign(data.menus, crawledMenus); // 기존 데이터에 병합
    
    if (isManual) {
        data.lastManualSync = today;
    } else {
        data.lastAutoSync = today;
    }

    saveData(data);
    return { success: true, message: "✅ 최신 식단표 동기화가 완료되었습니다!" };
}

/**
 * 특정 날짜와 타입(아침/점심/저녁)의 메뉴를 가져옵니다.
 */
function getMenu(dateString, type) {
    const data = readData();
    const todayData = data.menus[dateString];

    if (!todayData) return "해당 날짜의 식단 정보가 없습니다.\n(아직 업데이트 전이거나 주말일 수 있어요. `/food refresh`를 시도해보세요!)";
    
    return todayData[type] || "해당 식사 정보가 없습니다.";
}

module.exports = { syncFoodData, getMenu, getTodayString, getCurrentMealInfo };