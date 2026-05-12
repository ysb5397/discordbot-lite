const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../../config/manage_environments.js');

const FILE_PATH = path.join(__dirname, 'food_data.json');
const OWNER_ID = config.discord.ownerId;

const defaultData = {
    lastManualSync: "",      
    lastAdminSyncTime: 0,    
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

function getCurrentMealInfo() {
    const kstDate = getKstDate();
    const hours = kstDate.getHours();
    const minutes = kstDate.getMinutes();
    const time = hours * 100 + minutes;

    let targetDate = kstDate;
    let type = 'lunch';
    let typeName = '🍴 점심';

    if (time < 840) {
        type = 'breakfast';
        typeName = '☀️ 아침';
    } else if (time < 1300) {
        type = 'lunch';
        typeName = '🍴 점심';
    } else if (time < 1800) {
        type = 'dinner';
        typeName = '🌙 저녁';
    } else {
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

// 💡 [새로 추가됨] AI에게 넘겨주기 위해 일주일치 메뉴를 통째로 반환하는 함수!
function getAllMenus() {
    const data = readData();
    return data.menus;
}

async function crawlFoodData() {
    try {
        const url = 'https://www.kopo.ac.kr/busan/content.do?menu=5609';
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const $ = cheerio.load(response.data);

        const newMenus = {};
        const rows = $('table.tbl_table.menu tbody tr');

        if (rows.length === 0) {
            throw new Error("테이블을 찾지 못했습니다. HTML 구조가 변경되었을 수 있습니다.");
        }

        rows.each((i, el) => {
            const tds = $(el).find('td');
            if (tds.length >= 4) {
                const dateText = $(tds[0]).text().trim();
                const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/); 
                
                if (dateMatch) {
                    const formattedDate = dateMatch[1];
                    
                    const breakfastRaw = $(tds[1]).text().trim().replace(/\s+/g, ' ');
                    const lunchRaw = $(tds[2]).text().trim().replace(/\s+/g, ' ');
                    const dinnerRaw = $(tds[3]).text().trim().replace(/\s+/g, ' ');

                    newMenus[formattedDate] = {
                        breakfast: breakfastRaw || "등록된 식단이 없습니다.",
                        lunch: lunchRaw || "등록된 식단이 없습니다.",
                        dinner: dinnerRaw || "등록된 식단이 없습니다."
                    };
                }
            }
        });

        if (Object.keys(newMenus).length === 0) {
            throw new Error("식단표 데이터를 파싱하지 못했습니다. 날짜 형식을 확인하세요.");
        }

        return newMenus;
    } catch (error) {
        console.error('❌ [FoodManager] 크롤링 중 에러 발생:', error);
        throw error;
    }
}

async function syncFoodData(isManual = false, userId = null) {
    const data = readData();
    const today = getTodayString();
    const now = Date.now();

    if (isManual) {
        const isAdmin = userId === OWNER_ID;

        if (isAdmin) {
            const COOLDOWN = 10 * 60 * 1000;
            if (data.lastAdminSyncTime && (now - data.lastAdminSyncTime < COOLDOWN)) {
                const remainingMinutes = Math.ceil((COOLDOWN - (now - data.lastAdminSyncTime)) / 60000);
                return { success: false, message: `👑 관리자님, 아직 쿨타임입니다! ${remainingMinutes}분 후에 다시 시도해주세요.` };
            }
        } else {
            if (data.lastManualSync === today) {
                return { success: false, message: "⚠️ 오늘은 누군가 이미 수동 동기화를 완료했습니다. 내일 다시 시도해주세요. (관리자는 예외)" };
            }
        }
    } else {
        if (data.lastAutoSync === today) {
            return { success: false, message: "이미 오늘 자동 동기화가 진행되었습니다." };
        }
    }

    const crawledMenus = await crawlFoodData();
    data.menus = Object.assign(data.menus, crawledMenus); 
    
    if (isManual) {
        const isAdmin = userId === OWNER_ID;
        if (isAdmin) {
            data.lastAdminSyncTime = now;
            data.lastManualSync = today;
        } else {
            data.lastManualSync = today;
        }
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

// 💡 [수정됨] 모듈 내보내기에 getAllMenus 추가!
module.exports = { syncFoodData, getMenu, getTodayString, getCurrentMealInfo, getAllMenus };