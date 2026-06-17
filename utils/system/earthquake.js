const { createEarthquakeEmbed } = require('../ui/embed_builder.js');
const { JSDOM } = require('jsdom');
const fs = require('fs'); // [Lite+ 파일시스템] 추가
const path = require('path');
const config = require('../../config/manage_environments.js');

const EQK_AUTH_KEY = config.etc.earthquakeKey;
// 저장할 파일 경로 (현재 파일 위치 기준 data 폴더 또는 루트)
const SAVE_PATH = path.join(__dirname, 'last_eq.txt'); 
const LAST_QUERY_PATH = path.join(__dirname, 'last_eq_query.txt');

// --- 설정 변수 ---
const EQ_API_CONFIG = {
    url: "https://apihub.kma.go.kr/api/typ09/url/eqk/urlNewNotiEqk.do",
    authKey: EQK_AUTH_KEY,
    orderTy: "xml",
    orderCm: "L"
};
const INITIAL_DELAY = 60 * 1000;
const MAX_DELAY = 30 * 60 * 1000;
const BACKOFF_FACTOR = 2;

let currentDelay = INITIAL_DELAY;
let timeoutId = null;
let earthquakeMonitorStatus = '초기화 중...';

// [파일 로직] 마지막 알림 시각 읽기
function getLastNotifiedIssue() {
    try {
        if (fs.existsSync(SAVE_PATH)) {
            return fs.readFileSync(SAVE_PATH, 'utf8').trim();
        }
    } catch (err) {
        console.error('[EQK] 파일을 읽는 중 오류 발생:', err);
    }
    return null;
}

// [파일 로직] 마지막 알림 시각 저장하기
function saveLastNotifiedIssue(tmIssue) {
    try {
        fs.writeFileSync(SAVE_PATH, tmIssue, 'utf8');
    } catch (err) {
        console.error('[EQK] 파일을 저장하는 중 오류 발생:', err);
    }
}

// [파일 로직] 마지막 API 요청 시각 읽기
function getLastQueryTime() {
    try {
        if (fs.existsSync(LAST_QUERY_PATH)) {
            const timeStr = fs.readFileSync(LAST_QUERY_PATH, 'utf8').trim();
            const time = parseInt(timeStr, 10);
            if (!isNaN(time)) return time;
        }
    } catch (err) {
        console.error('[EQK] 마지막 쿼리 시각 파일을 읽는 중 오류 발생:', err);
    }
    return 0;
}

// [파일 로직] 마지막 API 요청 시각 저장하기
function saveLastQueryTime(time) {
    try {
        fs.writeFileSync(LAST_QUERY_PATH, String(time), 'utf8');
    } catch (err) {
        console.error('[EQK] 마지막 쿼리 시각 파일을 저장하는 중 오류 발생:', err);
    }
}

async function checkEarthquakeAndNotify(client) {
    console.log('[EQK] 지진 정보 확인 시작 (로컬 파일 비교 모드)...');

    const url = `${EQ_API_CONFIG.url}?orderTy=${EQ_API_CONFIG.orderTy}&orderCm=${EQ_API_CONFIG.orderCm}&authKey=${EQ_API_CONFIG.authKey}`;

    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`API 응답 에러: ${response.status}`);

        const xmlText = await response.text();
        const dom = new JSDOM(xmlText, { contentType: "application/xml" });
        const eqInfo = dom.window.document.querySelector("info");

        if (!eqInfo) return;

        const tmIssue = eqInfo.querySelector("tmIssue")?.textContent;
        if (!tmIssue) return;

        // [Lite+ 파일비교] 파일에 저장된 값과 비교
        const lastIssue = getLastNotifiedIssue();
        if (lastIssue === tmIssue) {
            console.log(`[EQK] 이미 알린 지진입니다 (${tmIssue}). 건너뜁니다.`);
            return;
        }

        // 알림 전송 로직
        await sendEarthquakeAlert(eqInfo, client);

        // [Lite+ 파일저장] 전송 성공 후 파일에 기록
        saveLastNotifiedIssue(tmIssue);
        console.log(`[EQK] 새 지진 기록 완료: ${tmIssue}`);

    } catch (error) {
        console.error('[EQK] 에러:', error.message);
        throw error;
    }
}

async function scheduleCheck(client) {
    const now = Date.now();
    const lastQuery = getLastQueryTime();
    const elapsed = now - lastQuery;

    // 만약 마지막 호출로부터 INITIAL_DELAY(60초)가 지나지 않았다면, 남은 시간만큼 대기했다가 다시 scheduleCheck 호출
    if (elapsed < INITIAL_DELAY) {
        const waitTime = INITIAL_DELAY - elapsed;
        console.log(`[EQK] 마지막 API 요청으로부터 ${Math.round(elapsed / 1000)}초 경과했습니다. 제재 방지를 위해 ${Math.round(waitTime / 1000)}초 대기 후 검사를 진행합니다!`);
        earthquakeMonitorStatus = '대기 중...';
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => scheduleCheck(client), waitTime);
        return;
    }

    try {
        // API 요청 전 마지막 쿼리 시각 갱신
        saveLastQueryTime(Date.now());
        
        await checkEarthquakeAndNotify(client);
        earthquakeMonitorStatus = '정상';
        currentDelay = INITIAL_DELAY;
    } catch (error) {
        earthquakeMonitorStatus = '오류';
        currentDelay = Math.min(currentDelay * BACKOFF_FACTOR, MAX_DELAY);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => scheduleCheck(client), currentDelay);
    }
}

async function sendEarthquakeAlert(info, client) {
    const targetChannelId = config.channels.earthquakeNotice;
    const embed = createEarthquakeEmbed({
        jdLoc: info.querySelector("jdLoc")?.textContent || "정보 없음",
        eqDate: info.querySelector("eqDate")?.textContent || "정보 없음",
        tmIssue: info.querySelector("tmIssue")?.textContent || "정보 없음",
        msgCode: info.querySelector("msgCode")?.textContent || "알 수 없음",
        magMl: info.querySelector("magMl")?.textContent || "정보 없음",
        eqPt: info.querySelector("eqPt")?.textContent || "정보 없음",
        eqDt: info.querySelector("eqDt")?.textContent || "정보 없음",
        jdLocA: info.querySelector("jdLocA")?.textContent || "영향 지역 없음",
        ReFer: info.querySelector("ReFer")?.textContent || "상세 정보 없음"
    });

    try {
        const channel = await client.channels.fetch(targetChannelId);
        if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('[EQK] 전송 실패:', error);
    }
}

function startEarthquakeMonitor(client) {
    if (!EQK_AUTH_KEY) return;
    console.log('[EQK] 로컬 파일 기반 모니터링 시작!');
    scheduleCheck(client);
}

module.exports = { startEarthquakeMonitor, earthquakeMonitorStatus: () => earthquakeMonitorStatus };