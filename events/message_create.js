const { Events } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getTodayString, getSpecialDaysList } = require('../utils/system/food_manager.js');

const { generateMentionReply } = require('../utils/ai/ai_helper.js'); 
const { getMemberFoodPreference } = require('../utils/system/member_food_reference_manager.js'); 

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        const client = message.client;

        // 봇이 보낸 메시지는 무시
        if (message.author.bot) return;

        // 봇이 멘션되었는지 확인
        if (!message.mentions.has(client.user)) return;

        // 멘션 태그(<@봇ID>)를 지우고 순수 질문 내용만 남기기
        const userQuery = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();

        // 아무 말 없이 멘션만 한 경우
        if (userQuery.length === 0) {
            return message.reply('학식 메뉴가 궁금하면 나를 태그하고 "내일 점심 뭐야?"라고 물어봐줘! 😋');
        }

        // 4. 음식 관련 질문인지 대충 키워드로 검사
        const foodKeywords = ['학식', '밥', '메뉴', '조식', '중식', '석식', '아침', '점심', '저녁', '식단', '면', '고기', '돈까스', '뭐', '나와'];
        const isFoodQuery = foodKeywords.some(keyword => userQuery.includes(keyword));

        // --- 🍔 학식 관련 질문일 때 (AI + 로컬 파일 RAG) ---
        try {
            await message.channel.sendTyping(); // "봇이 입력 중..." 상태 표시

            // 1) 캐싱된 food_data.json 읽어오기
            const filePath = path.join(__dirname, '../utils/system/food_data.json');
            let foodDataStr = "아직 크롤링된 데이터가 없어! /food refresh를 먼저 해줘.";
            
            if (fs.existsSync(filePath)) {
                const rawData = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(rawData);
                
                // AI가 쉽게 읽도록 날짜-메뉴 객체만 예쁘게 문자열로 변환해서 넘김
                foodDataStr = JSON.stringify(parsed.menus, null, 2);
            }

            const today = getTodayString();
            const specialDays = getSpecialDaysList();
            const specialDaysStr = JSON.stringify(specialDays, null, 2);

            // 1.5) 질문한 유저의 선호도 정보 가져오기
            const userId = message.author.id;
            const displayName = message.member?.displayName || message.author.displayName;
            const preference = getMemberFoodPreference(userId);
            
            let preferencePrompt = "";
            if (preference && (preference.favorite.length > 0 || preference.dislike.length > 0)) {
                const favStr = preference.favorite.length > 0 ? preference.favorite.join(', ') : '없음';
                const disStr = preference.dislike.length > 0 ? preference.dislike.join(', ') : '없음';
                preferencePrompt = `
                [질문한 사용자 선호 정보]
                - 이름: ${displayName}
                - 좋아하는 음식: ${favStr}
                - 싫어하는 음식: ${disStr}

                [추가 답변 지시사항]
                질문한 사용자의 식단 선호 정보를 기반으로, 학식 데이터에 사용자가 좋아하는 음식이 포함되어 있다면 적극적으로 반기며 추천(예: "OO님이 좋아하는 제육볶음이 나오네! 😍")해주고, 싫어하는 음식이 포함되어 있다면 다정하게 경고나 주의를 곁들여줘 (예: "다만 OO님이 싫어하는 버섯도 들어가 있으니 조심해! 🥺").
                `;
            } else {
                preferencePrompt = `
                [질문한 사용자 선호 정보]
                - 이름: ${displayName}
                - 식단 선호 정보가 설정되어 있지 않습니다.
                `;
            }

            // 2) AI에게 부여할 강력한 프롬프트 셋팅!
            const systemPrompt = `
                [System]
                너는 폴리텍 부산캠퍼스의 귀엽고 친절한 '학식 알리미 챗봇'이야. 사용자에게 다정하고 편하게 대답해줘.
                오늘 날짜는 ${today}야.
                아래 제공된 [학식 데이터 (저번 주, 이번 주, 다음 주)] 및 [학식 예외 날짜 목록]을 꼼꼼히 읽고, 오늘 날짜를 기준으로 과거와 미래의 식단 및 특이사항을 인지해서 사용자의 질문에 정확하고 센스 있게 답변해줘.

                ${isFoodQuery} 이 값이 동적으로 Boolean 값으로 들어올거야.
                만약 해당 값과 질문 모두 학식 질문과 관련이 없다면 일반 답변 모드로 응답해줘. 

                [답변 규칙]
                1. 데이터에 날짜 자체가 없거나 식단 정보가 없는 날짜(예: 다다음 주처럼 제공되지 않는 날짜)를 물어보면 "아직 그 날짜의 식단은 안 나왔어 ㅠㅠ"라고 안내해.
                2. 특정 메뉴(예: 면요리, 고기)를 물어보면, 데이터 안에서 해당 메뉴가 있는 날짜와 식사(조/중/석식)를 찾아서 알려줘.
                3. 데이터가 비어있거나 "등록된 식단이 없습니다."라고 되어있으면 식사가 없는 걸로(예: 주말) 처리해.
                4. 요약해서 핵심만 말하되, 먹음직스러운 이모티콘을 적극적으로 사용해줘!
                5. 아래 사용자의 질문 내용과 무관한 말은 지어내지 마.
                6. 지금 넘겨주는 학식 데이터는 모두 실시간으로 가져온 데이터니까 신뢰도는 걱정하지 않아도 돼.
                7. 만약 사용자가 물어본 날짜가 [학식 예외 날짜 목록]에 있는 날짜(예: YYYY-MM-DD 또는 YYYYMMDD)에 해당한다면, 식단 데이터에 메뉴가 적혀있더라도 학식이 제공되지 않는 예외 날(휴강, 공휴일 등)이므로, 해당 사유를 알려주며 학교에 오지 않아도 된다고 다정하게 안내해줘. (예: "6월 25일은 개교기념일이라 학식이 없어! 학교에 안 와도 돼~ 😴")

                ${preferencePrompt}

                [학식 예외 날짜 목록 (휴강, 공휴일 등)]
                ${specialDaysStr}

                [학식 데이터 (저번 주, 이번 주, 다음 주)]
                ${foodDataStr}

                [사용자 질문]
                ${userQuery}
            `;

            const reply = await generateMentionReply(null, systemPrompt);
            
            await message.reply(reply);
            return;

        } catch (error) {
            console.error('학식 AI 응답 처리 중 에러:', error);
            
            let errorMessage = '앗! 학식 정보를 AI로 처리하다가 알 수 없는 에러가 났어! 😭';
            const errorStr = error.message || String(error);

            if (errorStr.includes('ECONNREFUSED') || errorStr.includes('503') || errorStr.includes('fetch failed')) {
                errorMessage = '🔌 **[AI 서버 연결 실패]**\n루나(로컬 AI)가 잠들어 있거나 PC와 연결이 끊어졌어! PC의 Ollama 서버가 켜져 있는지, 방화벽이 막고 있지 않은지 확인해 줘! 🥺';
            } else if (errorStr.includes('404') || errorStr.toLowerCase().includes('not found')) {
                errorMessage = '🧠 **[모델 찾기 실패 (404)]**\n지정된 AI 모델(my_luna)을 찾을 수 없대! PC에서 모델 병합 및 등록이 잘 끝났는지 확인해 줘!';
            } else if (errorStr.includes('400') || errorStr.toLowerCase().includes('bad request')) {
                errorMessage = '⚠️ **[잘못된 요청 (400)]**\n질문 내용이나 형식이 조금 이상해서 루나가 이해를 못 한 것 같아. 다시 한번 물어봐 줄래?';
            } else if (errorStr.toLowerCase().includes('timeout') || errorStr.includes('AbortError')) {
                errorMessage = '⏱️ **[시간 초과]**\n루나가 고민하느라 시간이 너무 오래 걸려서 응답을 기다리지 못했어. 잠깐 후에 다시 시도해 줘!';
            } else {
                errorMessage = `앗! 학식 정보를 AI로 처리하다가 에러가 발생했어! 😭\n\n**[상세 에러 로그]**\n\`${errorStr.slice(0, 150)}...\``;
            }

            return message.reply(errorMessage);
        }
    },
};