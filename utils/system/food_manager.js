const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const FILE_PATH = path.join(__dirname, 'food_data.json');

const defaultData = {
    lastManualSync: "", 
    lastAutoSync: "",   
    menus: {}           
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

// 💡 [수정됨] 서버 설정과 상관없이 무조건 정확한 한국 시간(KST) 객체를 반환하는 함수
function getKstDate() {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function getTodayString() {
    const kstDate = getKstDate();
    const year = kstDate.getFullYear();
    const month = String(kstDate.getMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 현재 한국 시간을 기준으로 어떤 식사(조식/중식/석식)를 보여줄지 결정합니다.
 */
function getCurrentMealInfo() {
    const kstDate = getKstDate();
    const hours = kstDate.getHours();
    const minutes = kstDate.getMinutes();
    const time = hours * 100 + minutes; // 예: 08:30 -> 830

    let targetDate = kstDate;
    let type = 'lunch';
    let typeName = '🍴 점심';

    // 💡 [참고] 배식 시간표에 맞게 임계값을 조정했어!
    // 아침: 08:00 ~ 08:40 / 점심: 12:00 ~ 13:10 / 저녁: 17:00 ~ 18:10
    if (time < 850) {
        // 08:50 이전 -> 아침
        type = 'breakfast';
        typeName = '☀️ 아침';
    } else if (time < 1320) {
        // 08:50 ~ 13:20 -> 점심
        type = 'lunch';
        typeName = '🍴 점심';
    } else if (time < 1820) {
        // 13:20 ~ 18:20 -> 저녁
        type = 'dinner';
        typeName = '🌙 저녁';
    } else {
        // 18:20 이후 -> 다음 날 아침
        targetDate.setDate(targetDate.getDate() + 1);
        type = 'breakfast';
        typeName = '☀️ 내일 아침';
    }

    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    return { dateString, type, typeName };
}

/**
 * 💡 [수정됨] HTML에서 메뉴 텍스트를 깔끔하게 추출합니다.
 */
function parseMealText(td) {
    const $ = cheerio;
    // 부산캠퍼스 식단표는 <span> 태그 안에 내용이 콤마(,)와 함께 들어있음
    let text = $(td).find('span').text().trim();
    
    // 예: "백미밥 , 콩나물국 , 고등어구이" -> "백미밥, 콩나물국, 고등어구이"로 보기 좋게 다듬기
    text = text.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ');
    
    return text || "등록된 식단이 없습니다.";
}

/**
 * 💡 [수정됨] 실제로 웹사이트에서 학식을 크롤링해오는 함수 (HTML 구조 완벽 대응)
 */
async function crawlFoodData() {
    try {
        const url = 'https://www.kopo.ac.kr/busan/content.do?menu=5609';
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);

        const newMenus = {};

        // 식단이 들어있는 정확한 테이블 지정: <table class="tbl_table menu">
        $('table.tbl_table.menu tbody tr').each((i, el) => {
            const tds = $(el).find('td');
            
            // 데이터가 있는 줄(<tr>)은 td가 4개 (구분, 조식, 중식, 석식) 임
            if (tds.length >= 4) {
                const dateText = $(tds[0]).text().trim();
                
                // HTML 안의 "2026-05-11" 형태의 날짜 추출
                const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/); 
                
                if (dateMatch) {
                    const formattedDate = dateMatch[1]; // 예: "2026-05-11"

                    // tds[1]: 조식, tds[2]: 중식, tds[3]: 석식
                    newMenus[formattedDate] = {
                        breakfast: parseMealText(tds[1]),
                        lunch: parseMealText(tds[2]),
                        dinner: parseMealText(tds[3])
                    };
                }
            }
        });

        if (Object.keys(newMenus).length === 0) {
            throw new Error("식단표 데이터를 파싱하지 못했습니다. HTML 태그를 다시 확인하세요.");
        }

        return newMenus;
    } catch (error) {
        console.error('❌ [FoodManager] 크롤링 중 에러 발생:', error);
        throw error;
    }
}

async function syncFoodData(isManual = false) {
    const data = readData();
    const today = getTodayString();

    if (isManual) {
        if (data.lastManualSync === today) {
            return { success: false, message: "⚠️ 오늘은 이미 수동 동기화를 완료했습니다. 내일 다시 시도해주세요." };
        }
    } else {
        if (data.lastAutoSync === today) {
            return { success: false, message: "이미 오늘 자동 동기화가 진행되었습니다." };
        }
    }

    const crawledMenus = await crawlFoodData();
    data.menus = Object.assign(data.menus, crawledMenus); 
    
    if (isManual) {
        data.lastManualSync = today;
    } else {
        data.lastAutoSync = today;
    }

    saveData(data);
    return { success: true, message: "✅ 최신 식단표 동기화가 완료되었습니다!" };
}

function getMenu(dateString, type) {
    const data = readData();
    const todayData = data.menus[dateString];

    if (!todayData) return "해당 날짜의 식단 정보가 없습니다.\n(아직 업데이트 전이거나 주말일 수 있어요. `/food refresh`를 시도해보세요!)";
    
    return todayData[type] || "해당 식사 정보가 없습니다.";
}

module.exports = { syncFoodData, getMenu, getTodayString, getCurrentMealInfo };