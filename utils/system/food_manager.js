const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const sharp = require('sharp');
const config = require('../../config/manage_environments.js');

const FILE_PATH = path.join(__dirname, 'food_data.json');
const DAYS_FILE_PATH = path.join(__dirname, 'exception_days.json');
const FONT_PATH = path.join(__dirname, 'NanumGothic.ttf');
const OWNER_IDS = config.discord.ownerId.split(',').map(id => id.trim()); // 여러 관리자 ID를 배열로 저장

async function ensureFontExists() {
    if (fs.existsSync(FONT_PATH)) return;
    
    console.log('[FoodManager] 나눔고딕 폰트가 로컬 폴더에 없습니다. 다운로드를 시작합니다...');
    try {
        const response = await axios({
            url: 'https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf',
            method: 'GET',
            responseType: 'arraybuffer'
        });
        fs.writeFileSync(FONT_PATH, response.data);
        console.log('[FoodManager] 나눔고딕 폰트 다운로드 및 로컬 저장 완료!');
    } catch (e) {
        console.error('[FoodManager] 폰트 다운로드 실패:', e);
    }
}


const defaultData = {
    lastManualSync: "",      
    lastAdminSyncTime: 0,    
    lastAutoSync: "",        
    menus: []           
};

function formatToHyphenDate(dateStr) {
    if (!dateStr) return null;
    if (/^\d{8}$/.test(dateStr)) {
        return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return dateStr;
    }
    return dateStr;
}

function getSpecialDayReason(dateString) {
    try {
        if (fs.existsSync(DAYS_FILE_PATH)) {
            const content = fs.readFileSync(DAYS_FILE_PATH, 'utf8').trim();
            if (content) {
                const daysData = JSON.parse(content);
                const formatted = formatToHyphenDate(dateString);
                return daysData[formatted] || null;
            }
        }
    } catch (e) {
        console.error('❌ [FoodManager] exception_days.json 읽기 실패:', e);
    }
    return null;
}

function readData() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            const data = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
            if (data.menus && !Array.isArray(data.menus)) {
                data.menus = [ data.menus ];
            }
            return data;
        }
    } catch (e) {
        console.error('❌ [FoodManager] JSON 읽기 실패:', e);
    }
    return JSON.parse(JSON.stringify(defaultData));
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

function getNextWeekDateString() {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0(일) ~ 6(토)
    
    const daysUntilNextMonday = (dayOfWeek === 0 ? 1 : 8 - dayOfWeek);
    today.setDate(today.getDate() + daysUntilNextMonday);

    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}${month}${day}`; // 예: '20260525'
}

function getMondayOfDate(dateStr) {
    const formatted = formatToHyphenDate(dateStr);
    if (!formatted) return null;
    
    const d = new Date(formatted);
    const day = d.getDay(); // 0:일, 1:월, ... 6:토
    
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, '0');
    const date = String(monday.getDate()).padStart(2, '0');
    return `${year}${month}${date}`;
}

function getNextActiveSchoolDay(startDate) {
    let checkDate = new Date(startDate);
    for (let i = 0; i < 14; i++) {
        const dayOfWeek = checkDate.getDay();
        const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !getSpecialDayReason(dateStr)) {
            return checkDate;
        }
        checkDate.setDate(checkDate.getDate() + 1);
    }
    return startDate;
}

function getCurrentMealInfo() {
    const kstDate = getKstDate();
    const todayStr = getTodayString();
    
    const dayOfWeek = kstDate.getDay();
    const hours = kstDate.getHours();
    const minutes = kstDate.getMinutes();
    const time = hours * 100 + minutes;

    let targetDate = new Date(kstDate);
    let type = '';
    let typeName = '';
    let isNextWeek = false;

    const isTodayOff = (dayOfWeek === 0 || dayOfWeek === 6 || getSpecialDayReason(todayStr) !== null);

    if (isTodayOff) {
        const nextDay = new Date(kstDate);
        nextDay.setDate(nextDay.getDate() + 1);
        targetDate = getNextActiveSchoolDay(nextDay);
        
        type = 'breakfast';
        typeName = '☀️ 다음 수업일 아침';
        isNextWeek = true;
    } else {
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
            const nextDay = new Date(kstDate);
            nextDay.setDate(nextDay.getDate() + 1);
            targetDate = getNextActiveSchoolDay(nextDay);
            
            type = 'breakfast';
            typeName = '☀️ 다음 수업일 아침';
            isNextWeek = true;
        }
    }

    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    return { dateString, type, typeName, isNextWeek };
}

function getAllMenus() {
    const data = readData();
    return data.menus;
}

async function crawlFoodData(targetDate = null) {
    try {
        let url = 'https://www.kopo.ac.kr/busan/content.do?menu=5609';

        if (targetDate == null) {
            const today = getKstDate();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            targetDate = `${year}${month}${day}`;
        }

        if (targetDate) {
            url += `&day=${targetDate}`; 
        }

        console.log(`[학식 크롤링] 데이터 가져오는 중... URL: ${url}`);

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

async function syncFoodData(isManual = false, userId = null, targetDate = null) {
    const checkDate = targetDate ? formatToHyphenDate(targetDate) : getTodayString();
    const specialReason = getSpecialDayReason(checkDate);
    if (specialReason) {
        return { success: false, message: `⚠️ 오늘은 **${specialReason}**이라 굳이 학교에 올 필요가 없어! 학식도 동기화할 필요가 없겠지? 😉` };
    }

    const data = readData();
    const today = getTodayString();
    const now = Date.now();
    const COOLDOWN = 10 * 60 * 1000;

    if (isManual) {
        const isAdmin = OWNER_IDS.includes(userId);

        if (isAdmin) {
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

    const crawledMenus = await crawlFoodData(targetDate);
    
    if (!Array.isArray(data.menus)) {
        data.menus = [];
    }

    const newWeekMonday = getMondayOfDate(targetDate || getTodayString());

    let existingIndex = -1;
    for (let i = 0; i < data.menus.length; i++) {
        const weekObj = data.menus[i];
        const keys = Object.keys(weekObj);
        if (keys.length > 0) {
            const existingMonday = getMondayOfDate(keys[0]);
            if (existingMonday === newWeekMonday) {
                existingIndex = i;
                break;
            }
        }
    }

    if (existingIndex !== -1) {
        data.menus[existingIndex] = crawledMenus;
    } else {
        data.menus.push(crawledMenus);
    }

    data.menus.sort((a, b) => {
        const keyA = Object.keys(a)[0] || "";
        const keyB = Object.keys(b)[0] || "";
        const mondayA = getMondayOfDate(keyA) || "";
        const mondayB = getMondayOfDate(keyB) || "";
        return mondayA.localeCompare(mondayB);
    });

    while (data.menus.length > 3) {
        data.menus.shift();
    } 

    if (isManual) {
        const isAdmin = OWNER_IDS.includes(userId);
        
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
    const specialReason = getSpecialDayReason(dateString);
    if (specialReason) {
        return `오늘은 **${specialReason}**이라 굳이 학교에 오지 않아도 돼! 학식도 먹으러 안 와도 되겠지? 😉`;
    }

    const data = readData();
    let todayData = null;
    if (Array.isArray(data.menus)) {
        for (const weekData of data.menus) {
            if (weekData && weekData[dateString]) {
                todayData = weekData[dateString];
                break;
            }
        }
    } else {
        todayData = data.menus[dateString];
    }

    if (!todayData) return "해당 날짜의 식단 정보가 없습니다.\n(아직 업데이트 전이거나 주말일 수 있어요. `/food refresh`를 시도해보세요!)";
    
    return todayData[type] || "해당 식사 정보가 없습니다.";
}

async function generateFoodImage(dateString, typeName, menuString) {
    // 폰트 파일 다운로드 및 유무 확인
    await ensureFontExists();

    let fontBase64 = '';
    try {
        if (fs.existsSync(FONT_PATH)) {
            fontBase64 = fs.readFileSync(FONT_PATH).toString('base64');
        }
    } catch (e) {
        console.error('[FoodManager] 폰트 파일 읽기 실패:', e);
    }

    const splitTextByLength = (text, maxLength) => {
        const result = [];
        for (let i = 0; i < text.length; i += maxLength) {
            result.push(text.slice(i, i + maxLength));
        }
        return result;
    };

    const rawMenus = menuString.split(',').map(m => m.trim()).filter(m => m.length > 0);
    const menus = [];
    rawMenus.forEach(item => {
        if (item.length > 22) {
            menus.push(...splitTextByLength(item, 22));
        } else {
            menus.push(item);
        }
    });

    let tspanElements = '';
    const isNoMenu = menus.length === 0 || menuString === "등록된 식단이 없습니다." || menuString.includes("식단 정보가 없습니다") || menuString.includes("해당 날짜의 식단 정보가 없습니다");

    if (isNoMenu) {
        tspanElements = `<tspan x="300" dy="70" font-size="20" font-weight="bold" fill="#6A698F" text-anchor="middle">등록된 식단이 없습니다 😥</tspan>
                         <tspan x="300" dy="45" font-size="14" fill="#8A89AB" text-anchor="middle">(학식이 제공되지 않는 날일 수 있어요)</tspan>`;
    } else {
        menus.forEach((menu, index) => {
            const dy = index === 0 ? 0 : 35;
            tspanElements += `<tspan x="80" dy="${dy}" fill="#3B3A5F">  ${menu}</tspan>`;
        });
    }

    const totalMenuHeight = isNoMenu ? 0 : (menus.length - 1) * 35;
    const startY = isNoMenu ? 160 : Math.max(145, 120 + (255 - totalMenuHeight) / 2);

    const svg = `
    <svg width="600" height="400" viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pastelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#B3CFFB;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#E3CAFD;stop-opacity:1" />
        </linearGradient>
        ${fontBase64 ? `
        <style>
          @font-face {
            font-family: 'NanumGothicEmbed';
            src: url(data:font/ttf;base64,${fontBase64}) format('truetype');
          }
          .custom-text, .custom-text tspan {
            font-family: 'NanumGothicEmbed', sans-serif !important;
          }
        </style>
        ` : `
        <style>
          .custom-text, .custom-text tspan {
            font-family: sans-serif;
          }
        </style>
        `}
      </defs>
      <rect width="600" height="400" rx="32" ry="32" fill="url(#pastelGrad)"/>
      <rect x="25" y="25" width="550" height="350" rx="22" ry="22" fill="#ffffff" fill-opacity="0.6"/>
      <text x="55" y="80" class="custom-text" font-size="24" font-weight="bold" fill="#3B3A5F">🍽️ 학식 안내 (${typeName})</text>
      <text x="545" y="75" class="custom-text" font-size="14" font-weight="bold" fill="#6B698F" text-anchor="end">${dateString}</text>
      <line x1="50" y1="105" x2="550" y2="105" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity="0.9"/>
      <text x="80" y="${startY}" class="custom-text" font-size="18" font-weight="bold" fill="#3B3A5F">
        ${tspanElements}
      </text>
    </svg>
    `;

    return await sharp(Buffer.from(svg)).png().toBuffer();
}

function isAdminUser(userId) {
    return OWNER_IDS.includes(userId);
}

function addSpecialDay(dateStr, reason) {
    const formatted = formatToHyphenDate(dateStr);
    if (!formatted || !/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
        return { success: false, message: "❌ 올바르지 않은 날짜 형식이야! YYYYMMDD 또는 YYYY-MM-DD 형식으로 입력해줘." };
    }
    try {
        let daysData = {};
        if (fs.existsSync(DAYS_FILE_PATH)) {
            const content = fs.readFileSync(DAYS_FILE_PATH, 'utf8').trim();
            if (content) {
                daysData = JSON.parse(content);
            }
        }
        daysData[formatted] = reason;
        fs.writeFileSync(DAYS_FILE_PATH, JSON.stringify(daysData, null, 2), 'utf8');
        return { success: true, message: `✅ **${formatted}** 날짜가 **'${reason}'**(으)로 등록되었어!` };
    } catch (e) {
        console.error('❌ [FoodManager] addSpecialDay 실패:', e);
        return { success: false, message: "❌ 예외 날짜를 저장하는 도중 에러가 발생했어." };
    }
}

function removeSpecialDay(dateStr) {
    const formatted = formatToHyphenDate(dateStr);
    if (!formatted || !/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
        return { success: false, message: "❌ 올바르지 않은 날짜 형식이야! YYYYMMDD 또는 YYYY-MM-DD 형식으로 입력해줘." };
    }
    try {
        let daysData = {};
        if (fs.existsSync(DAYS_FILE_PATH)) {
            const content = fs.readFileSync(DAYS_FILE_PATH, 'utf8').trim();
            if (content) {
                daysData = JSON.parse(content);
            }
        }
        if (!daysData[formatted]) {
            return { success: false, message: `⚠️ **${formatted}** 날짜는 등록된 예외 날짜가 아니야!` };
        }
        delete daysData[formatted];
        fs.writeFileSync(DAYS_FILE_PATH, JSON.stringify(daysData, null, 2), 'utf8');
        return { success: true, message: `✅ **${formatted}** 예외 날짜가 성공적으로 삭제되었어!` };
    } catch (e) {
        console.error('❌ [FoodManager] removeSpecialDay 실패:', e);
        return { success: false, message: "❌ 예외 날짜를 삭제하는 도중 에러가 발생했어." };
    }
}

function getSpecialDaysList() {
    try {
        if (fs.existsSync(DAYS_FILE_PATH)) {
            const content = fs.readFileSync(DAYS_FILE_PATH, 'utf8').trim();
            if (content) {
                return JSON.parse(content);
            }
        }
    } catch (e) {
        console.error('❌ [FoodManager] getSpecialDaysList 실패:', e);
    }
    return {};
}

module.exports = { syncFoodData, getMenu, getTodayString, getNextWeekDateString, getCurrentMealInfo, getAllMenus, getKstDate, getSpecialDayReason, getMondayOfDate, generateFoodImage, isAdminUser, addSpecialDay, removeSpecialDay, getSpecialDaysList };