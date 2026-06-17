const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const sharp = require('sharp');
const config = require('../../config/manage_environments.js');

const FILE_PATH = path.join(__dirname, 'food_data.json');
const DAYS_FILE_PATH = path.join(__dirname, 'exception_days.json');
const FONT_PATH = path.join(__dirname, '../../fonts/NanumGothic.ttf');
const OWNER_IDS = config.discord.ownerId.split(',').map(id => id.trim()); // 여러 관리자 ID를 배열로 저장

async function ensureFontExists() {
    if (fs.existsSync(FONT_PATH)) return;
    
    console.log('[FoodManager] 나눔고딕 폰트가 로컬 폴더에 없습니다. 다운로드를 시작합니다...');
    try {
        const dir = path.dirname(FONT_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
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

    const opentype = require('opentype.js');
    const fontBuffer = fs.readFileSync(FONT_PATH);
    const font = opentype.parse(fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength));

    // 유니코드 NFC 정규화로 NFD(자모분리) 현상 방지 및 이모지 공백 제거
    const cleanTypeName = typeName.replace(/[^\w\sㄱ-ㅎㅏ-ㅣ가-힣]/g, '').trim().normalize('NFC');
    const cleanDateString = dateString.normalize('NFC');
    const normalizedMenu = menuString.normalize('NFC');

    const splitTextByLength = (text, maxLength) => {
        const result = [];
        for (let i = 0; i < text.length; i += maxLength) {
            result.push(text.slice(i, i + maxLength));
        }
        return result;
    };

    const rawMenus = normalizedMenu.split(',').map(m => m.trim()).filter(m => m.length > 0);
    const menus = [];
    rawMenus.forEach(item => {
        if (item.length > 22) {
            menus.push(...splitTextByLength(item, 22));
        } else {
            menus.push(item);
        }
    });

    const isNoMenu = menus.length === 0 || normalizedMenu === "등록된 식단이 없습니다." || normalizedMenu.includes("식단 정보가 없습니다") || normalizedMenu.includes("해당 날짜의 식단 정보가 없습니다");

    const getSvgPath = (text, x, y, fontSize, fill = '#3B3A5F', bold = false) => {
        const pathObj = font.getPath(text, x, y, fontSize, { kerning: true });
        const pathData = pathObj.toPathData(2);
        if (bold) {
            const strokeWidth = (fontSize * 0.035).toFixed(2);
            return `<path d="${pathData}" fill="${fill}" stroke="${fill}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />`;
        }
        return `<path d="${pathData}" fill="${fill}" />`;
    };

    const paths = [];

    // [디버깅] 렌더링에 주입되는 데이터 원본 로그 출력
    console.log(`[EQK-DEBUG] normalizedMenu: "${normalizedMenu}"`);
    console.log(`[EQK-DEBUG] menus:`, menus);

    // 1. 제목 그리기 (이모지가 정제된 cleanTypeName 사용)
    const titleText = `학식 안내 (${cleanTypeName})`;
    const titlePath = getSvgPath(titleText, 95, 71, 24, '#3B3A5F', true);
    console.log(`[EQK-DEBUG] 제목 [${titleText}] -> 패스 길이: ${titlePath.length}`);
    paths.push(titlePath);

    // 2. 날짜 그리기 (정밀 정규화된 cleanDateString 사용)
    const dateWidth = font.getAdvanceWidth(cleanDateString, 14);
    const dateLeft = 545 - dateWidth;
    paths.push(getSvgPath(cleanDateString, dateLeft, 68, 14, '#6B698F', true));

    // 3. 메뉴 그리기
    if (isNoMenu) {
        const msg2 = "(학식이 제공되지 않는 날일 수 있어요)";
        const cleanMsg1 = "등록된 식단이 없습니다.";
        
        const w1 = font.getAdvanceWidth(cleanMsg1, 20);
        const w2 = font.getAdvanceWidth(msg2, 14);
        
        paths.push(getSvgPath(cleanMsg1, 300 - w1 / 2, 210, 20, '#6A698F', true));
        paths.push(getSvgPath(msg2, 300 - w2 / 2, 250, 14, '#8A89AB', false));
    } else {
        const lineSpacing = 32;
        const totalHeight = menus.length * lineSpacing - 14;
        const menuAreaTop = 110;
        const menuAreaBottom = 370;
        const menuAreaHeight = menuAreaBottom - menuAreaTop;
        
        const menuTop = menuAreaTop + (menuAreaHeight - totalHeight) / 2 + 18; // 18은 폰트 크기 보정(첫 줄 Y)
        
        menus.forEach((menu, index) => {
            const y = menuTop + index * lineSpacing;
            const menuPath = getSvgPath(`• ${menu}`, 60, y, 18, '#3B3A5F', true);
            console.log(`[EQK-DEBUG] 메뉴 [${menu}] -> 패스 길이: ${menuPath.length}`);
            paths.push(menuPath);
        });
    }

    const svgContent = `
    <svg width="600" height="400" viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pastelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#B3CFFB;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#E3CAFD;stop-opacity:1" />
        </linearGradient>
      </defs>
      <!-- 배경 -->
      <rect width="600" height="400" rx="32" ry="32" fill="url(#pastelGrad)"/>
      <!-- 반투명 카드 -->
      <rect x="25" y="25" width="550" height="350" rx="22" ry="22" fill="#ffffff" fill-opacity="0.6"/>
      <!-- 구분선 -->
      <line x1="50" y1="105" x2="550" y2="105" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity="0.9"/>
      
      <!-- 숟가락 & 포크 데코레이션 아이콘 -->
      <g transform="translate(50, 42) scale(0.95)">
        <circle cx="20" cy="20" r="18" fill="#3B3A5F" opacity="0.1" />
        <path d="M12,9 L12,17 M15,9 L15,17 M18,9 L18,17 M12,17 C12,21 18,21 18,17 L18,17 M15,21 L15,29" stroke="#3B3A5F" stroke-width="2" stroke-linecap="round" fill="none" />
        <path d="M25,11 C22,11 22,21 25,21 C28,21 28,11 25,11 Z M25,21 L25,29" fill="#3B3A5F" stroke="#3B3A5F" stroke-width="0.8" />
      </g>
      
      <!-- 텍스트 Path 목록 -->
      ${paths.join('\n')}
    </svg>
    `;

    const result = await sharp(Buffer.from(svgContent)).png().toBuffer();
    return result;
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